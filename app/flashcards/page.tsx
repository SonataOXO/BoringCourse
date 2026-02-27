"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { appendHistory, getHistoryItemById, readHistory } from "@/lib/client/history";

type Course = {
  id: number;
  name: string;
};

type AssignmentItem = {
  id: number;
  name: string;
  dueAt: string | null;
};

type UploadedMaterial = {
  title: string;
  content: string;
};

type PersistedDashboardState = {
  courses: Course[];
  upcomingWork: AssignmentItem[];
  uploadedMaterials?: UploadedMaterial[];
};

type Flashcard = {
  question: string;
  answer: string;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

type StudyGuideResult = {
  overview?: string;
  topicOutline?: { topic?: string; concepts?: string[] };
  checklist?: string[];
  plan?: Array<{ day?: string; tasks?: string[] }>;
};

const DASHBOARD_STORAGE_KEY = "boringcourse-dashboard-v1";

function buildStudyGuideSourceText(): { text: string; subject: string } | null {
  const latestStudyGuide = readHistory().find((item) => item.type === "study-guide");
  if (!latestStudyGuide?.state) {
    return null;
  }

  const state = latestStudyGuide.state as {
    studyGuide?: StudyGuideResult;
    selectedUnits?: string[];
    selectedAssignments?: Array<{ id: number; name: string }>;
  };

  const guide = state.studyGuide;
  if (!guide) {
    return null;
  }

  const topic = guide.topicOutline?.topic ?? "Study Guide Topic";
  const concepts = Array.isArray(guide.topicOutline?.concepts) ? guide.topicOutline?.concepts ?? [] : [];
  const checklist = Array.isArray(guide.checklist) ? guide.checklist : [];
  const planLines = (guide.plan ?? [])
    .map((item) => `${item.day ?? "Day"}: ${(item.tasks ?? []).join("; ")}`)
    .join("\n");

  return {
    subject: topic,
    text: [
      `Study guide topic: ${topic}`,
      guide.overview ? `Overview: ${guide.overview}` : "",
      concepts.length > 0 ? `Concepts: ${concepts.join("; ")}` : "",
      checklist.length > 0 ? `Checklist: ${checklist.join("; ")}` : "",
      planLines ? `Plan:\n${planLines}` : "",
      state.selectedAssignments?.length ? `Selected assignments: ${state.selectedAssignments.map((a) => a.name).join("; ")}` : "",
      state.selectedUnits?.length ? `Selected units: ${state.selectedUnits.join("; ")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

function buildDashboardSourceText(): { text: string; subject: string } {
  try {
    const raw = window.localStorage.getItem(DASHBOARD_STORAGE_KEY);
    if (!raw) {
      return { text: "Core course topics and upcoming assignments.", subject: "General" };
    }
    const parsed = JSON.parse(raw) as PersistedDashboardState;
    const courseNames = (parsed.courses ?? []).map((course) => course.name).join("; ");
    const upcoming = (parsed.upcomingWork ?? [])
      .slice(0, 15)
      .map((item) => `${item.name}${item.dueAt ? ` (due ${new Date(item.dueAt).toLocaleDateString()})` : ""}`)
      .join("; ");
    const uploads = (parsed.uploadedMaterials ?? [])
      .slice(0, 4)
      .map((item) => `${item.title}: ${item.content.slice(0, 800)}`)
      .join("\n\n");

    return {
      subject: parsed.courses?.[0]?.name ?? "General",
      text: [
        courseNames ? `Courses: ${courseNames}` : "",
        upcoming ? `Upcoming work: ${upcoming}` : "",
        uploads,
      ]
        .filter(Boolean)
        .join("\n\n") || "Core course topics and upcoming assignments.",
    };
  } catch {
    return { text: "Core course topics and upcoming assignments.", subject: "General" };
  }
}

export default function FlashcardsPage() {
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sourceLabel, setSourceLabel] = useState("No deck generated yet.");

  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const activeCard = cards[index] ?? null;

  const generateCards = useCallback(async (options?: { instruction?: string; count?: number; append?: boolean }) => {
    setError("");
    setLoading(true);

    try {
      const studyGuideSource = buildStudyGuideSourceText();
      const fallbackSource = buildDashboardSourceText();
      const source = studyGuideSource ?? fallbackSource;

      const response = await fetch("/api/ai/flashcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: source.subject,
          content: source.text,
          count: options?.count ?? 12,
          instructions: options?.instruction,
          existingQuestions: (options?.append ? cards : []).map((card) => card.question),
        }),
      });

      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.error ?? "Failed to generate flashcards");
      }

      const generated = ((json.flashcards ?? []) as Array<Record<string, unknown>>)
        .map((item) => ({
          question: String(item.question ?? "").trim(),
          answer: String(item.answer ?? "").trim(),
        }))
        .filter((item) => item.question && item.answer);

      if (generated.length === 0) {
        throw new Error("No flashcards were generated.");
      }

      const nextCards = options?.append ? [...cards, ...generated] : generated;
      setCards(nextCards);
      setIndex(options?.append ? cards.length : 0);
      setFlipped(false);
      setSourceLabel(studyGuideSource ? "Generated from latest Study Guide" : "Generated from Canvas context");

      appendHistory({
        type: "flashcards",
        title: options?.append ? "Flashcards expanded" : "Flashcards generated",
        summary: `${nextCards.length} cards • ${source.subject}`,
        path: "/flashcards",
        state: {
          cards: nextCards,
          index: options?.append ? cards.length : 0,
          sourceLabel: studyGuideSource ? "Generated from latest Study Guide" : "Generated from Canvas context",
          chatMessages,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate flashcards");
    } finally {
      setLoading(false);
    }
  }, [cards, chatMessages]);

  async function sendTailorRequest() {
    const prompt = chatInput.trim();
    if (!prompt) {
      return;
    }

    const nextMessages = [...chatMessages, { role: "user" as const, content: prompt, createdAt: Date.now() }];
    setChatMessages(nextMessages);
    setChatInput("");

    await generateCards({ instruction: prompt, count: 8, append: true });

    setChatMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: "Added new tailored cards to your deck.",
        createdAt: Date.now(),
      },
    ]);
  }

  function clearDeck() {
    setCards([]);
    setIndex(0);
    setFlipped(false);
    setChatMessages([]);
    setChatInput("");
    setError("");
    setSourceLabel("No deck generated yet.");
  }

  useEffect(() => {
    const historyId = new URLSearchParams(window.location.search).get("historyId");
    if (!historyId) {
      return;
    }

    const historyItem = getHistoryItemById(historyId);
    if (!historyItem || historyItem.type !== "flashcards" || !historyItem.state) {
      return;
    }

    const state = historyItem.state as {
      cards?: Flashcard[];
      index?: number;
      sourceLabel?: string;
      chatMessages?: ChatMessage[];
    };

    if (Array.isArray(state.cards) && state.cards.length > 0) {
      setCards(state.cards);
      setIndex(Math.max(0, Math.min(state.cards.length - 1, Number(state.index ?? 0))));
      setSourceLabel(typeof state.sourceLabel === "string" ? state.sourceLabel : "Restored flashcards session");
    }

    if (Array.isArray(state.chatMessages)) {
      setChatMessages(state.chatMessages);
    }
  }, []);

  const progressLabel = useMemo(() => {
    if (cards.length === 0) {
      return "0 / 0";
    }
    return `${index + 1} / ${cards.length}`;
  }, [cards.length, index]);

  return (
    <main className="grainy-bg min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-5xl space-y-5">
        <Button asChild variant="ghost" size="sm">
          <Link href="/">
            <ArrowLeft className="size-4" /> Back to Dashboard
          </Link>
        </Button>

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Flashcards</CardTitle>
              <CardDescription>{sourceLabel}</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => void generateCards({ count: 12 })} disabled={loading}>
                <RefreshCw className="size-4" /> {loading ? "Generating..." : cards.length > 0 ? "Regenerate Deck" : "Generate Deck"}
              </Button>
              <Button type="button" variant="secondary" onClick={clearDeck} disabled={cards.length === 0 && chatMessages.length === 0}>
                Clear
              </Button>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-[1.3fr_0.7fr]">
            <div>
              <button
                type="button"
                onClick={() => setFlipped((prev) => !prev)}
                className="h-72 w-full rounded-2xl border bg-background p-6 text-left shadow-sm transition hover:border-accent/50"
                disabled={!activeCard}
              >
                {activeCard ? (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      {flipped ? "Answer" : "Question"}
                    </p>
                    <p className="mt-4 text-xl font-semibold leading-relaxed">
                      {flipped ? activeCard.answer : activeCard.question}
                    </p>
                    <p className="mt-4 text-xs text-muted-foreground">Tap card to flip</p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No cards yet.</p>
                )}
              </button>

              <div className="mt-3 flex items-center justify-between">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setIndex((prev) => Math.max(0, prev - 1));
                    setFlipped(false);
                  }}
                  disabled={index <= 0 || cards.length === 0}
                >
                  Previous
                </Button>
                <p className="text-sm font-semibold">{progressLabel}</p>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setIndex((prev) => Math.min(cards.length - 1, prev + 1));
                    setFlipped(false);
                  }}
                  disabled={cards.length === 0 || index >= cards.length - 1}
                >
                  Next
                </Button>
              </div>
            </div>

            <div className="rounded-2xl border bg-background/70 p-4">
              <p className="text-sm font-semibold">Tailor More Cards</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Ask for a topic focus, difficulty level, or more cards. These requests append new cards.
              </p>
              <div className="mt-3 space-y-2">
                <input
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  placeholder="Example: Add 8 hard factoring quadratics cards"
                  className="h-10 w-full rounded-xl border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <Button type="button" onClick={() => void sendTailorRequest()} disabled={loading || !chatInput.trim()} className="w-full">
                  {loading ? "Generating..." : "Generate Tailored Cards"}
                </Button>
              </div>

              <div className="mt-3 max-h-44 space-y-2 overflow-y-auto text-xs">
                {chatMessages.length > 0 ? (
                  chatMessages.slice(-6).map((message) => (
                    <p key={`${message.createdAt}-${message.role}`} className={message.role === "user" ? "font-semibold" : "text-muted-foreground"}>
                      {message.role === "user" ? "You: " : "AI: "}
                      {message.content}
                    </p>
                  ))
                ) : (
                  <p className="text-muted-foreground">No card-tailoring messages yet.</p>
                )}
              </div>
            </div>
          </div>

          {error ? <p className="mt-3 text-sm font-semibold text-red-600">{error}</p> : null}
        </Card>
      </div>
    </main>
  );
}
