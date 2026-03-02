"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { ArrowLeft, RefreshCw, Upload } from "lucide-react";

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

type LocalDocMaterial = {
  title: string;
  content: string;
};

type LocalImage = {
  name: string;
  dataUrl: string;
};

type SourceMode = "custom" | "study-guide";

type StudyGuideResult = {
  overview?: string;
  topicOutline?: { topic?: string; concepts?: string[] };
  checklist?: string[];
  plan?: Array<{ day?: string; tasks?: string[] }>;
};

const DASHBOARD_STORAGE_KEY = "boringcourse-dashboard-v1";
const HIDE_FLASHCARDS_RESUME_KEY = "boringcourse-hide-resume-flashcards-v1";

const SUBSCRIPT_DIGITS: Record<string, string> = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
};

const SUPERSCRIPT_CHARS: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "+": "⁺",
  "-": "⁻",
};

function toSubscript(value: string): string {
  return value
    .split("")
    .map((char) => SUBSCRIPT_DIGITS[char] ?? char)
    .join("");
}

function toSuperscript(value: string): string {
  return value
    .split("")
    .map((char) => SUPERSCRIPT_CHARS[char] ?? char)
    .join("");
}

function formatFlashcardNotation(raw: string): string {
  let text = raw;

  // x^2 -> x², 10^-3 -> 10⁻³
  text = text.replace(/\^([0-9+-]+)/g, (_, exp: string) => toSuperscript(exp));

  // Convert stoichiometric counts after an element or closing paren: H2O, (Ca)2 -> H₂O, (Ca)₂
  text = text.replace(/([A-Za-z\)])(\d+)/g, (_, lead: string, digits: string) => `${lead}${toSubscript(digits)}`);

  // Convert ionic charge at token end: Ca2+, SO4- -> Ca²⁺, SO₄⁻
  text = text.replace(/([A-Za-z0-9\)])(\d*)([+\-])(\b|$)/g, (_, stem: string, chargeDigits: string, sign: string, boundary: string) => {
    return `${stem}${toSuperscript(`${chargeDigits}${sign}`)}${boundary}`;
  });

  return text;
}

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

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Invalid image data"));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.readAsDataURL(file);
  });
}

export default function FlashcardsPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [cards, setCards] = useState<Flashcard[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sourceLabel, setSourceLabel] = useState("No deck generated yet.");
  const [sourceMode, setSourceMode] = useState<SourceMode>("custom");

  const [topicInput, setTopicInput] = useState("");
  const [docMaterials, setDocMaterials] = useState<LocalDocMaterial[]>([]);
  const [images, setImages] = useState<LocalImage[]>([]);
  const [uploadMessage, setUploadMessage] = useState("No files added yet.");

  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const activeCard = cards[index] ?? null;

  const generateCards = useCallback(async (options?: { instruction?: string; count?: number; append?: boolean; mode?: SourceMode }) => {
    setError("");
    setLoading(true);

    try {
      const mode = options?.mode ?? sourceMode;
      const fallbackSource = buildDashboardSourceText();

      let source = fallbackSource;
      let nextSourceLabel = "Generated from dashboard context";

      if (mode === "study-guide") {
        const guideSource = buildStudyGuideSourceText();
        if (!guideSource) {
          throw new Error("No study guide found. Generate one first, then click Study Topics.");
        }
        source = guideSource;
        nextSourceLabel = "Generated from latest Study Guide";
      } else {
        const trimmedTopic = topicInput.trim();
        const docsSection = docMaterials
          .slice(0, 8)
          .map((item) => `${item.title}: ${item.content.slice(0, 5000)}`)
          .join("\n\n");
        const imageSection = images.length > 0 ? `Uploaded images: ${images.map((image) => image.name).join("; ")}` : "";

        const customText = [
          trimmedTopic ? `Study topics requested: ${trimmedTopic}` : "",
          docsSection ? `Uploaded documents:\n${docsSection}` : "",
          imageSection,
          fallbackSource.text,
        ]
          .filter(Boolean)
          .join("\n\n");

        source = {
          subject: trimmedTopic.slice(0, 80) || fallbackSource.subject,
          text: customText,
        };
        nextSourceLabel = trimmedTopic || docMaterials.length > 0 || images.length > 0
          ? "Generated from your topics/files"
          : "Generated from dashboard context";
      }

      const response = await fetch("/api/ai/flashcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: source.subject,
          content: source.text,
          count: options?.count ?? 12,
          instructions: options?.instruction,
          existingQuestions: (options?.append ? cards : []).map((card) => card.question),
          images: mode === "custom" ? images.map((image) => image.dataUrl) : [],
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
      const nextIndex = options?.append ? cards.length : 0;
      setCards(nextCards);
      setIndex(nextIndex);
      setFlipped(false);
      setSourceLabel(nextSourceLabel);
      setSourceMode(mode);

      appendHistory({
        type: "flashcards",
        title: options?.append ? "Flashcards expanded" : "Flashcards generated",
        summary: `${nextCards.length} cards • ${source.subject}`,
        path: "/flashcards",
        state: {
          cards: nextCards,
          index: nextIndex,
          sourceLabel: nextSourceLabel,
          sourceMode: mode,
          chatMessages,
          topicInput,
        },
      });
      window.localStorage.setItem(HIDE_FLASHCARDS_RESUME_KEY, "0");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate flashcards");
    } finally {
      setLoading(false);
    }
  }, [cards, chatMessages, docMaterials, images, sourceMode, topicInput]);

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      return;
    }

    setError("");
    setUploadMessage("Processing files...");

    try {
      const docAdds: LocalDocMaterial[] = [];
      const imageAdds: LocalImage[] = [];

      for (const file of files) {
        if (file.type.startsWith("image/")) {
          const dataUrl = await fileToDataUrl(file);
          imageAdds.push({ name: file.name, dataUrl });
          continue;
        }

        const formData = new FormData();
        formData.set("file", file);
        formData.set("assignmentTitle", "Flashcards Upload");

        const response = await fetch("/api/upload/parse", {
          method: "POST",
          body: formData,
        });

        const json = await response.json();
        if (!response.ok) {
          throw new Error(json.error ?? `Failed to parse ${file.name}`);
        }

        docAdds.push({
          title: String(json.fileName ?? file.name),
          content: String(json.content ?? ""),
        });
      }

      if (imageAdds.length > 0) {
        setImages((prev) => [...prev, ...imageAdds].slice(0, 5));
      }
      if (docAdds.length > 0) {
        setDocMaterials((prev) => [...prev, ...docAdds].slice(0, 8));
      }

      setUploadMessage(`Added ${docAdds.length} document(s) and ${imageAdds.length} image(s).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process files");
      setUploadMessage("File upload failed.");
    } finally {
      event.target.value = "";
    }
  }

  async function sendTailorRequest() {
    const prompt = chatInput.trim();
    if (!prompt) {
      return;
    }

    const nextMessages = [...chatMessages, { role: "user" as const, content: prompt, createdAt: Date.now() }];
    setChatMessages(nextMessages);
    setChatInput("");

    await generateCards({ instruction: prompt, count: 8, append: true, mode: sourceMode });

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
    setTopicInput("");
    setDocMaterials([]);
    setImages([]);
    setUploadMessage("No files added yet.");
    setError("");
    setSourceLabel("No deck generated yet.");
    setSourceMode("custom");
    window.localStorage.setItem(HIDE_FLASHCARDS_RESUME_KEY, "1");
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
      sourceMode?: SourceMode;
      chatMessages?: ChatMessage[];
      topicInput?: string;
    };

    if (Array.isArray(state.cards) && state.cards.length > 0) {
      setCards(state.cards);
      setIndex(Math.max(0, Math.min(state.cards.length - 1, Number(state.index ?? 0))));
      setSourceLabel(typeof state.sourceLabel === "string" ? state.sourceLabel : "Restored flashcards session");
    }

    if (state.sourceMode === "study-guide" || state.sourceMode === "custom") {
      setSourceMode(state.sourceMode);
    }

    if (typeof state.topicInput === "string") {
      setTopicInput(state.topicInput);
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
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.txt,.md,.pdf,.docx"
              onChange={handleFiles}
              className="hidden"
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={() => void generateCards({ count: 12, mode: "custom" })} disabled={loading}>
                <RefreshCw className="size-4" /> {loading ? "Generating..." : cards.length > 0 ? "Regenerate Deck" : "Generate Deck"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => void generateCards({ count: 12, mode: "study-guide" })} disabled={loading}>
                Study Topics
              </Button>
              <Button type="button" variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={loading}>
                <Upload className="size-4" /> Add Files
              </Button>
              <Button type="button" variant="secondary" onClick={clearDeck} disabled={cards.length === 0 && chatMessages.length === 0 && !topicInput && docMaterials.length === 0 && images.length === 0}>
                Clear
              </Button>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border bg-background/70 p-4">
            <p className="text-sm font-semibold">What should these flashcards cover?</p>
            <p className="mt-1 text-xs text-muted-foreground">Describe topics, chapters, exam style, or difficulty. Upload docs/PDFs/images to add more context.</p>
            <textarea
              value={topicInput}
              onChange={(event) => setTopicInput(event.target.value)}
              placeholder="Example: AP Biology Unit 4 cell communication, emphasize signaling pathways and short-answer style definitions"
              className="mt-3 h-24 w-full rounded-xl border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="mt-2 text-xs text-muted-foreground">{uploadMessage}</p>
            {(docMaterials.length > 0 || images.length > 0) ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Files loaded: {docMaterials.length} document(s), {images.length} image(s)
              </p>
            ) : null}
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-[1.3fr_0.7fr]">
            <div>
              <button
                type="button"
                onClick={() => setFlipped((prev) => !prev)}
                className="h-72 w-full text-left"
                disabled={!activeCard}
              >
                {activeCard ? (
                  <div className="h-full w-full [perspective:1000px]">
                    <div
                      className={`relative h-full w-full rounded-2xl border bg-background p-6 shadow-sm transition-transform duration-500 hover:border-accent/50 [transform-style:preserve-3d] ${
                        flipped ? "[transform:rotateY(180deg)]" : ""
                      }`}
                    >
                      <div className="absolute inset-0 rounded-2xl p-6 [backface-visibility:hidden]">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Question</p>
                        <p className="mt-4 text-xl font-semibold leading-relaxed">{formatFlashcardNotation(activeCard.question)}</p>
                        <p className="mt-4 text-xs text-muted-foreground">Tap card to flip</p>
                      </div>
                      <div className="absolute inset-0 rounded-2xl p-6 [transform:rotateY(180deg)] [backface-visibility:hidden]">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Answer</p>
                        <p className="mt-4 text-xl font-semibold leading-relaxed">{formatFlashcardNotation(activeCard.answer)}</p>
                        <p className="mt-4 text-xs text-muted-foreground">Tap card to flip back</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full w-full items-center rounded-2xl border bg-background p-6 shadow-sm">
                    <p className="text-sm text-muted-foreground">No cards yet.</p>
                  </div>
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
