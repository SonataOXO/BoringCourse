"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { ArrowLeft, Brain } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { getCanvasAuthHeaders } from "@/lib/client/canvas-auth";
import { appendHistory, getHistoryItemById } from "@/lib/client/history";

type FocusRecommendation = {
  subject: string;
  priority: "high" | "medium" | "low";
  concept: string;
  why: string;
  suggestedMinutesPerWeek: number;
};

type Course = {
  id: number;
  name: string;
  enrollments?: Array<{
    computed_current_score?: number | null;
  }>;
};

type AssignmentItem = {
  id: number;
  name: string;
  dueAt: string | null;
  conceptHint?: string;
  submissionScore?: number | null;
  pointsPossible?: number | null;
};

type UploadedMaterial = {
  title: string;
  content: string;
  preview: string;
};

type PersistedDashboardState = {
  courses: Course[];
  focusRecommendations: FocusRecommendation[];
  upcomingWork: AssignmentItem[];
  uploadedMaterials: UploadedMaterial[];
  assignmentCache?: Record<number, AssignmentItem[]>;
};

type TutorImage = {
  name: string;
  dataUrl: string;
};

type TutorDocument = {
  title: string;
  content: string;
  preview: string;
  wordCount: number;
};

type AssignmentWithCourse = AssignmentItem & {
  courseId: number;
  courseName: string;
};

type FocusOption = {
  id: string;
  title: string;
  course: string;
  concept: string;
  reason: string;
  priority: "high" | "medium" | "low";
  divePrompt: string;
};

type FocusCoachResult = {
  overview: string;
  options: FocusOption[];
  deepDive?: {
    title: string;
    plan: string[];
    practice: string[];
  };
};

type TutorMcq = {
  question: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  mcq?: TutorMcq;
};

const INITIAL_TUTOR_MESSAGE = "Ask a question to start your tutoring session.";

type CourseFocusContext = {
  courseId: number;
  courseName: string;
  basisType: "unit" | "latest-assignment";
  basisLabel: string;
  assignmentTitles: string[];
};

const DASHBOARD_STORAGE_KEY = "boringcourse-dashboard-v1";

function extractUnitTag(title: string): string | null {
  const match = title.match(/\b(unit\s*\d+|chapter\s*\d+|module\s*\d+|lesson\s*\d+)\b/i);
  if (!match?.[1]) {
    return null;
  }
  return match[1].replace(/\s+/g, " ").trim();
}

function getUnitRank(unit: string): number {
  const numeric = unit.match(/(\d+)/);
  return numeric?.[1] ? Number(numeric[1]) : -1;
}

function readDashboardState(): PersistedDashboardState {
  if (typeof window === "undefined") {
    return { courses: [], focusRecommendations: [], upcomingWork: [], uploadedMaterials: [], assignmentCache: {} };
  }

  try {
    const raw = window.localStorage.getItem(DASHBOARD_STORAGE_KEY);
    if (!raw) {
      return { courses: [], focusRecommendations: [], upcomingWork: [], uploadedMaterials: [], assignmentCache: {} };
    }

    const parsed = JSON.parse(raw) as PersistedDashboardState;
    return {
      courses: parsed.courses ?? [],
      focusRecommendations: parsed.focusRecommendations ?? [],
      upcomingWork: parsed.upcomingWork ?? [],
      uploadedMaterials: parsed.uploadedMaterials ?? [],
      assignmentCache: parsed.assignmentCache ?? {},
    };
  } catch {
    return { courses: [], focusRecommendations: [], upcomingWork: [], uploadedMaterials: [], assignmentCache: {} };
  }
}

export default function TutorPage() {
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const documentInputRef = useRef<HTMLInputElement | null>(null);
  const focusAutoRanRef = useRef(false);

  const [question, setQuestion] = useState("Explain what I should focus on first this week.");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: `assistant-${Date.now()}-init`,
      role: "assistant",
      content: INITIAL_TUTOR_MESSAGE,
      createdAt: Date.now(),
    },
  ]);
  const [mcqSelections, setMcqSelections] = useState<Record<string, number>>({});
  const [images, setImages] = useState<TutorImage[]>([]);
  const [documents, setDocuments] = useState<TutorDocument[]>([]);
  const [uploadMessage, setUploadMessage] = useState("");
  const [selectedCourse, setSelectedCourse] = useState("");
  const [focusLoading, setFocusLoading] = useState(false);
  const [focusCoach, setFocusCoach] = useState<FocusCoachResult | null>(null);
  const [showFocusStrategy, setShowFocusStrategy] = useState(false);
  const [showFocusComposer, setShowFocusComposer] = useState(false);
  const [focusTargetCourse, setFocusTargetCourse] = useState("");
  const [focusTargetUnit, setFocusTargetUnit] = useState("");
  const [focusTargetAssignment, setFocusTargetAssignment] = useState("");
  const [focusTargetNote, setFocusTargetNote] = useState("");
  const [focusTargetAssignmentsLoading, setFocusTargetAssignmentsLoading] = useState(false);
  const [dashboardState, setDashboardState] = useState<PersistedDashboardState>({
    courses: [],
    focusRecommendations: [],
    upcomingWork: [],
    uploadedMaterials: [],
    assignmentCache: {},
  });

  useEffect(() => {
    setDashboardState(readDashboardState());
  }, []);

  const availableSubjects = useMemo(() => {
    const fromCourses = dashboardState.courses.map((course) => course.name);
    const fromFocus = dashboardState.focusRecommendations.map((item) => item.subject);
    return Array.from(new Set([...fromCourses, ...fromFocus])).filter(Boolean);
  }, [dashboardState]);

  const subject = selectedCourse || availableSubjects[0] || "General";

  const assignmentsWithCourse = useMemo<AssignmentWithCourse[]>(
    () =>
      dashboardState.courses.flatMap((course) =>
        (dashboardState.assignmentCache?.[course.id] ?? []).map((item) => ({
          ...item,
          courseId: course.id,
          courseName: course.name,
        })),
      ),
    [dashboardState.assignmentCache, dashboardState.courses],
  );

  const focusTargetCourseId = useMemo(() => {
    if (!focusTargetCourse) {
      return null;
    }
    return dashboardState.courses.find((course) => course.name === focusTargetCourse)?.id ?? null;
  }, [dashboardState.courses, focusTargetCourse]);

  const focusTargetAssignments = useMemo(() => {
    if (!focusTargetCourseId) {
      return assignmentsWithCourse;
    }
    return assignmentsWithCourse.filter((item) => item.courseId === focusTargetCourseId);
  }, [assignmentsWithCourse, focusTargetCourseId]);

  const focusTargetUnits = useMemo(() => {
    return Array.from(
      new Set(focusTargetAssignments.map((item) => extractUnitTag(item.name)).filter(Boolean) as string[]),
    );
  }, [focusTargetAssignments]);

  const focusTargetAssignmentOptions = useMemo(() => {
    const hasDetectedUnits = focusTargetUnits.length > 0;
    if (!hasDetectedUnits || !focusTargetUnit) {
      return focusTargetAssignments;
    }

    return focusTargetAssignments.filter((item) => extractUnitTag(item.name) === focusTargetUnit);
  }, [focusTargetAssignments, focusTargetUnit, focusTargetUnits.length]);

  const loadAssignmentsForFocusCourse = useCallback(
    async (courseId: number) => {
      const existing = dashboardState.assignmentCache?.[courseId] ?? [];
      if (existing.length > 0) {
        return;
      }

      setFocusTargetAssignmentsLoading(true);
      try {
        const response = await fetch(`/api/canvas/courses/${courseId}/assignments`, {
          headers: getCanvasAuthHeaders(),
        });
        const json = await response.json();
        if (!response.ok) {
          throw new Error(json.error ?? "Failed to load assignments");
        }

        const mapped = ((json.assignments ?? []) as Array<Record<string, unknown>>).map((item) => ({
          id: Number(item.id),
          name: String(item.name ?? "Assignment"),
          dueAt: (item.dueAt as string | null | undefined) ?? null,
          conceptHint: (item.conceptHint as string | undefined) ?? undefined,
          submissionScore: (item.submissionScore as number | null | undefined) ?? null,
          pointsPossible: (item.pointsPossible as number | null | undefined) ?? null,
        }));

        setDashboardState((prev) => {
          const next = {
            ...prev,
            assignmentCache: { ...(prev.assignmentCache ?? {}), [courseId]: mapped },
          };
          window.localStorage.setItem(DASHBOARD_STORAGE_KEY, JSON.stringify(next));
          return next;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load course assignments");
      } finally {
        setFocusTargetAssignmentsLoading(false);
      }
    },
    [dashboardState.assignmentCache],
  );

  useEffect(() => {
    if (!focusTargetCourseId) {
      return;
    }
    void loadAssignmentsForFocusCourse(focusTargetCourseId);
  }, [focusTargetCourseId, loadAssignmentsForFocusCourse]);

  const context = useMemo(() => {
    const uploadBlock = dashboardState.uploadedMaterials
      .slice(0, 5)
      .map((material) => `Uploaded material: ${material.title}\n${material.content.slice(0, 2400)}`)
      .join("\n\n");

    const upcomingBlock = dashboardState.upcomingWork
      .slice(0, 20)
      .map((item) => `${item.name}${item.dueAt ? ` (due ${new Date(item.dueAt).toLocaleDateString()})` : ""}`)
      .join("; ");

    const focusBlock = dashboardState.focusRecommendations
      .map((item) => `${item.subject}: ${item.concept} (${item.priority})`)
      .join("; ");

    const documentBlock = documents
      .slice(0, 5)
      .map((doc) => `Tutor document: ${doc.title}\n${doc.content.slice(0, 2400)}`)
      .join("\n\n");

    return [
      focusBlock ? `Focus recommendations: ${focusBlock}` : "",
      upcomingBlock ? `Upcoming Canvas work: ${upcomingBlock}` : "",
      uploadBlock,
      documentBlock,
    ]
      .filter(Boolean)
      .join("\n\n");
  }, [dashboardState, documents]);

  async function askTutor() {
    setError("");
    setLoading(true);

    try {
      const trimmedQuestion = question.trim();
      if (!trimmedQuestion) {
        setError("Enter a question first.");
        return;
      }

      setChatMessages((prev) => [
        ...prev,
        { id: `user-${Date.now()}`, role: "user", content: trimmedQuestion, createdAt: Date.now() },
      ]);

      const response = await fetch("/api/ai/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmedQuestion,
          subject,
          context: context.slice(0, 7000),
          chatHistory: chatMessages.slice(-8).map((message) => ({
            role: message.role,
            content: message.content.slice(0, 500),
          })),
          images: images.map((image) => image.dataUrl),
          focusRecommendations: dashboardState.focusRecommendations,
        }),
      });

      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.error ?? "Tutor request failed");
      }

      const tutorAnswer = String(json.response ?? "No tutor response generated.");
      const candidateMcq = json.mcq as Partial<TutorMcq> | undefined;
      const mcq =
        candidateMcq &&
        Array.isArray(candidateMcq.choices) &&
        candidateMcq.choices.length === 4 &&
        Number.isInteger(candidateMcq.correctIndex)
          ? {
              question: String(candidateMcq.question ?? ""),
              choices: candidateMcq.choices.map((choice) => String(choice)),
              correctIndex: Number(candidateMcq.correctIndex),
              explanation: String(candidateMcq.explanation ?? ""),
            }
          : undefined;

      setChatMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: tutorAnswer,
          createdAt: Date.now(),
          mcq,
        },
      ]);
      setQuestion("");
      appendHistory({
        type: "tutor",
        title: "Tutor response",
        summary: `${subject}: ${trimmedQuestion.slice(0, 80)}`,
        path: "/tutor",
        state: {
          subject,
          chatMessages: [
            { role: "user", content: trimmedQuestion, createdAt: Date.now() - 1 },
            { role: "assistant", content: tutorAnswer, createdAt: Date.now() },
          ],
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tutor request failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleImagePick(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).slice(0, 5);
    if (files.length === 0) {
      return;
    }

    try {
      const loaded = await Promise.all(files.map(fileToDataUrl));
      setImages(loaded);
    } catch {
      setError("Failed to read one or more images.");
    } finally {
      event.target.value = "";
    }
  }

  async function handleDocumentPick(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).slice(0, 5);
    if (files.length === 0) {
      return;
    }

    setError("");
    setUploadMessage("Processing documents...");

    try {
      const parsedDocs: TutorDocument[] = [];

      for (const file of files) {
        const formData = new FormData();
        formData.set("file", file);
        formData.set("assignmentTitle", selectedCourse || "Tutor Upload");

        const response = await fetch("/api/upload/parse", {
          method: "POST",
          body: formData,
        });

        const json = await response.json();
        if (!response.ok) {
          throw new Error(json.error ?? `Failed to parse ${file.name}`);
        }

        parsedDocs.push({
          title: String(json.fileName ?? file.name),
          content: String(json.content ?? ""),
          preview: String(json.preview ?? ""),
          wordCount: Number(json.wordCount ?? 0),
        });
      }

      setDocuments((prev) => [...prev, ...parsedDocs].slice(0, 8));
      setUploadMessage(`Added ${parsedDocs.length} document(s).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Document upload failed");
      setUploadMessage("");
    } finally {
      event.target.value = "";
    }
  }

  const runFocusAnalysis = useCallback(async (selectedOption?: FocusOption) => {
    setError("");
    setFocusLoading(true);

    try {
      const courseFocusContext: CourseFocusContext[] = dashboardState.courses.map((course) => {
        const assignments = (dashboardState.assignmentCache?.[course.id] ?? []).slice();
        const datedAssignments = assignments
          .filter((item) => Boolean(item.dueAt))
          .sort((a, b) => {
            const aTs = a.dueAt ? new Date(a.dueAt).getTime() : 0;
            const bTs = b.dueAt ? new Date(b.dueAt).getTime() : 0;
            return bTs - aTs;
          });

        const latestAssignment = datedAssignments[0] ?? assignments[0] ?? null;
        const latestUnit = latestAssignment ? extractUnitTag(latestAssignment.name) : null;

        if (latestAssignment && latestUnit) {
          const inSameUnit = assignments
            .filter((item) => extractUnitTag(item.name) === latestUnit)
            .map((item) => item.name)
            .slice(0, 6);

          return {
            courseId: course.id,
            courseName: course.name,
            basisType: "unit",
            basisLabel: latestUnit,
            assignmentTitles: inSameUnit.length > 0 ? inSameUnit : [latestAssignment.name],
          };
        }

        if (latestAssignment) {
          return {
            courseId: course.id,
            courseName: course.name,
            basisType: "latest-assignment",
            basisLabel: latestAssignment.name,
            assignmentTitles: datedAssignments.slice(0, 3).map((item) => item.name),
          };
        }

        const knownUnits = Array.from(
          new Set(assignments.map((item) => extractUnitTag(item.name)).filter(Boolean) as string[]),
        ).sort((a, b) => getUnitRank(b) - getUnitRank(a));

        if (knownUnits.length > 0) {
          const selectedUnit = knownUnits[0];
          return {
            courseId: course.id,
            courseName: course.name,
            basisType: "unit",
            basisLabel: selectedUnit,
            assignmentTitles: assignments
              .filter((item) => extractUnitTag(item.name) === selectedUnit)
              .map((item) => item.name)
              .slice(0, 6),
          };
        }

        return {
          courseId: course.id,
          courseName: course.name,
          basisType: "latest-assignment",
          basisLabel: "No assignment detected",
          assignmentTitles: [],
        };
      });

      const assignmentsByCourse = Object.fromEntries(
        Object.entries(dashboardState.assignmentCache ?? {}).map(([courseId, items]) => [
          courseId,
          items.map((item) => ({
            name: item.name,
            conceptHint: item.conceptHint,
            dueAt: item.dueAt ?? null,
            submissionScore: item.submissionScore ?? null,
            pointsPossible: item.pointsPossible ?? null,
          })),
        ]),
      );

      const response = await fetch("/api/ai/focus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courses: dashboardState.courses.map((course) => ({
            id: course.id,
            name: course.name,
            currentScore: course.enrollments?.[0]?.computed_current_score ?? null,
          })),
          courseFocusContext,
          assignmentsByCourse,
          selectedOption: selectedOption
            ? {
                course: selectedOption.course,
                concept: selectedOption.concept,
                reason: selectedOption.reason,
                divePrompt: selectedOption.divePrompt,
              }
            : undefined,
        }),
      });

      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.error ?? "Focus analysis failed");
      }

      setFocusCoach(json as FocusCoachResult);
      setShowFocusStrategy(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Focus analysis failed");
    } finally {
      setFocusLoading(false);
    }
  }, [dashboardState]);

  function runTargetedFocus() {
    const targetedSubject = focusTargetCourse || subject;
    const targetedConcept = [focusTargetUnit, focusTargetAssignment].filter(Boolean).join(" | ") || "Current class focus";
    const targetedReason = focusTargetNote.trim() || "Student requested targeted focus from tutor panel.";

    void runFocusAnalysis({
      id: "focus-targeted",
      title: "Targeted focus request",
      course: targetedSubject,
      concept: targetedConcept,
      reason: targetedReason,
      priority: "high",
      divePrompt: `Focus this guidance on ${targetedSubject}, ${targetedConcept}.`,
    });
    setShowFocusComposer(false);
  }

  function clearTutorChat() {
    setChatMessages([
      {
        id: `assistant-${Date.now()}-reset`,
        role: "assistant",
        content: INITIAL_TUTOR_MESSAGE,
        createdAt: Date.now(),
      },
    ]);
    setMcqSelections({});
    setQuestion("");
    setError("");
  }

  useEffect(() => {
    if (focusAutoRanRef.current) {
      return;
    }

    const query = new URLSearchParams(window.location.search);
    if (query.get("mode") === "focus") {
      focusAutoRanRef.current = true;
      void runFocusAnalysis();
    }
  }, [runFocusAnalysis]);

  useEffect(() => {
    const historyId = new URLSearchParams(window.location.search).get("historyId");
    if (!historyId) {
      return;
    }

    const historyItem = getHistoryItemById(historyId);
    if (!historyItem || historyItem.type !== "tutor" || !historyItem.state) {
      return;
    }

    const state = historyItem.state as {
      subject?: string;
      chatMessages?: Array<{ role: "user" | "assistant"; content: string; createdAt?: number }>;
    };

    if (state.subject) {
      setSelectedCourse(state.subject);
    }

    if (Array.isArray(state.chatMessages) && state.chatMessages.length > 0) {
      setChatMessages(
        state.chatMessages.map((message, index) => ({
          id: `restored-${historyId}-${index}`,
          role: message.role,
          content: message.content,
          createdAt: Number(message.createdAt ?? Date.now()),
        })),
      );
    }
  }, []);

  return (
    <main className="grainy-bg min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-4xl space-y-5">
        <Button asChild variant="ghost" size="sm">
          <Link href="/">
            <ArrowLeft className="size-4" /> Back to Dashboard
          </Link>
        </Button>

        <Card>
          <CardTitle>Tutor Session</CardTitle>
          <CardDescription>
            Chat with your tutor using coursework, uploads, and targeted focus on courses, units, or assignments.
          </CardDescription>

          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleImagePick}
            className="hidden"
          />
          <input
            ref={documentInputRef}
            type="file"
            accept=".txt,.md,.pdf,.docx"
            multiple
            onChange={handleDocumentPick}
            className="hidden"
          />

          <div className="mt-4 rounded-2xl bg-muted p-3 text-sm">
            <p className="text-muted-foreground">Active subject</p>
            <select
              value={selectedCourse}
              onChange={(event) => setSelectedCourse(event.target.value)}
              className="mt-1 h-10 w-full rounded-xl border bg-background px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Auto ({subject})</option>
              {availableSubjects.map((courseName) => (
                <option key={courseName} value={courseName}>
                  {courseName}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-4 flex items-center justify-between rounded-2xl border bg-background/70 p-3">
            <p className="text-sm font-semibold">Focus Strategy</p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  setShowFocusStrategy((prev) => {
                    const next = !prev;
                    setShowFocusComposer(next);
                    return next;
                  })
                }
              >
                {showFocusStrategy ? "Collapse" : "Reopen"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={focusCoach ? "secondary" : "default"}
                onClick={() => void runFocusAnalysis()}
                disabled={focusLoading}
              >
                {focusLoading ? "Analyzing..." : focusCoach ? "Refresh Focus" : "Start Focus"}
              </Button>
            </div>
          </div>

          {showFocusStrategy && focusCoach ? (
            <div className="mt-3 space-y-3 rounded-2xl border bg-background/70 p-4">
              <p className="text-sm">{focusCoach.overview}</p>
              <div className="space-y-2">
                {focusCoach.options.slice(0, 4).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => void runFocusAnalysis(option)}
                    className="w-full rounded-xl border bg-background p-3 text-left text-sm hover:bg-muted"
                  >
                    <p className="font-semibold">{option.title}</p>
                    <p className="text-xs text-muted-foreground">{option.course} • {option.concept}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{option.reason}</p>
                    <p className="mt-1 text-xs font-semibold text-accent">Dive deeper</p>
                  </button>
                ))}
              </div>
              {focusCoach.deepDive ? (
                <div className="rounded-xl border bg-background p-3 text-sm">
                  <p className="font-semibold">{focusCoach.deepDive.title}</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                    {focusCoach.deepDive.plan.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ul>
                  {focusCoach.deepDive.practice.length > 0 ? (
                    <>
                      <p className="mt-2 text-xs font-semibold text-foreground">Practice</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                        {focusCoach.deepDive.practice.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {showFocusStrategy && showFocusComposer ? (
            <div className="mt-3 rounded-2xl border bg-background/70 p-3">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Targeted Focus</p>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <select
                  value={focusTargetCourse}
                  onChange={(event) => {
                    setFocusTargetCourse(event.target.value);
                    setFocusTargetUnit("");
                    setFocusTargetAssignment("");
                  }}
                  className="h-10 rounded-xl border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Course (optional)</option>
                  {availableSubjects.map((courseName) => (
                    <option key={courseName} value={courseName}>
                      {courseName}
                    </option>
                  ))}
                </select>

                <input
                  list="focus-unit-suggestions"
                  value={focusTargetUnit}
                  onChange={(event) => setFocusTargetUnit(event.target.value)}
                  placeholder="Unit (optional) - type your own if needed"
                  className="h-10 rounded-xl border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <datalist id="focus-unit-suggestions">
                  {focusTargetUnits.map((unit) => (
                    <option key={unit} value={unit} />
                  ))}
                </datalist>
                <select
                  value={focusTargetAssignment}
                  onChange={(event) => setFocusTargetAssignment(event.target.value)}
                  className="h-10 rounded-xl border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring md:col-span-2"
                >
                  <option value="">
                    {focusTargetAssignmentsLoading ? "Loading assignments..." : "Assignment (optional)"}
                  </option>
                  {focusTargetAssignmentOptions.map((item) => (
                    <option key={`${item.courseId}-${item.id}-${item.name}`} value={item.name}>
                      {focusTargetCourse ? item.name : `${item.courseName} - ${item.name}`}
                    </option>
                  ))}
                </select>
                <textarea
                  value={focusTargetNote}
                  onChange={(event) => setFocusTargetNote(event.target.value)}
                  placeholder="Optional note for what you want help on."
                  className="h-20 rounded-xl border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring md:col-span-2"
                />
              </div>
              <div className="mt-2 flex gap-2">
                <Button type="button" onClick={runTargetedFocus} disabled={focusLoading}>
                  {focusLoading ? "Analyzing..." : "Run Targeted Focus"}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setShowFocusComposer(false)}>
                  Close
                </Button>
              </div>
            </div>
          ) : null}

          {error ? <p className="mt-3 text-sm font-semibold text-red-600">{error}</p> : null}

          <div className="mt-3 flex justify-end">
            <Button type="button" variant="secondary" size="sm" onClick={clearTutorChat}>
              Clear Chat
            </Button>
          </div>

          <div className="mt-4 h-[380px] overflow-y-auto rounded-2xl border bg-background/70 p-4">
            <div className="space-y-3">
              {chatMessages.map((message) => (
                <div
                  key={message.id}
                  className={message.role === "user" ? "flex justify-end" : "flex justify-start"}
                >
                  <div
                    className={
                      message.role === "user"
                        ? "max-w-[85%] rounded-2xl bg-accent px-3 py-2 text-sm text-accent-foreground"
                        : "max-w-[85%] rounded-2xl border bg-muted px-3 py-2 text-sm"
                    }
                  >
                    {message.role === "assistant" ? renderTutorMessage(message.content) : message.content}
                    {message.role === "assistant" && message.mcq ? (
                      <div className="mt-3 rounded-xl border bg-background p-3 text-xs">
                        <p className="font-semibold">{message.mcq.question}</p>
                        <div className="mt-2 grid gap-2">
                          {message.mcq.choices.map((choice, index) => {
                            const selected = mcqSelections[message.id];
                            const isChosen = selected === index;
                            return (
                              <button
                                key={`${message.id}-choice-${index}`}
                                type="button"
                                className="rounded-lg border bg-muted px-2 py-1 text-left hover:bg-background"
                                onClick={() => setMcqSelections((prev) => ({ ...prev, [message.id]: index }))}
                              >
                                {String.fromCharCode(65 + index)}. {choice}
                                {isChosen ? "  ✓" : ""}
                              </button>
                            );
                          })}
                        </div>
                        {Number.isInteger(mcqSelections[message.id]) ? (
                          <p className="mt-2 text-[11px] text-muted-foreground">
                            {mcqSelections[message.id] === message.mcq.correctIndex ? "Correct." : "Not quite."}{" "}
                            {message.mcq.explanation}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 flex gap-2">
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask your tutor..."
              className="h-24 flex-1 rounded-2xl border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="flex w-40 flex-col gap-2">
              <Button type="button" variant="secondary" onClick={() => imageInputRef.current?.click()}>
                Images
              </Button>
              <Button type="button" variant="secondary" onClick={() => documentInputRef.current?.click()}>
                Documents
              </Button>
              <Button onClick={askTutor} disabled={loading}>
                <Brain className="size-4" /> {loading ? "Thinking..." : "Send"}
              </Button>
            </div>
          </div>

          {uploadMessage ? <p className="mt-2 text-xs text-muted-foreground">{uploadMessage}</p> : null}
        </Card>
      </div>
    </main>
  );
}

function fileToDataUrl(file: File): Promise<TutorImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Invalid file result"));
        return;
      }

      resolve({
        name: file.name,
        dataUrl: reader.result,
      });
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function renderTutorMessage(content: string) {
  const lines = content.split("\n");
  const blocks: Array<{ type: "paragraph"; text: string } | { type: "bullets"; items: string[] }> = [];
  let bulletBuffer: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (bulletBuffer.length > 0) {
        blocks.push({ type: "bullets", items: bulletBuffer });
        bulletBuffer = [];
      }
      continue;
    }

    if (line.startsWith("- ")) {
      bulletBuffer.push(line.slice(2).trim());
      continue;
    }

    if (bulletBuffer.length > 0) {
      blocks.push({ type: "bullets", items: bulletBuffer });
      bulletBuffer = [];
    }
    blocks.push({ type: "paragraph", text: line });
  }

  if (bulletBuffer.length > 0) {
    blocks.push({ type: "bullets", items: bulletBuffer });
  }

  return (
    <div className="space-y-2 whitespace-pre-wrap leading-6">
      {blocks.map((block, index) =>
        block.type === "paragraph" ? (
          <p key={`p-${index}`}>{renderInlineBold(block.text)}</p>
        ) : (
          <ul key={`ul-${index}`} className="list-disc space-y-1 pl-5">
            {block.items.map((item, itemIndex) => (
              <li key={`li-${index}-${itemIndex}`}>{renderInlineBold(item)}</li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

function renderInlineBold(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, index) => {
        const isBold = part.startsWith("**") && part.endsWith("**");
        const value = isBold ? part.slice(2, -2) : part;
        return isBold ? (
          <strong key={`${value}-${index}`}>{renderTextWithLinks(value)}</strong>
        ) : (
          <span key={`${value}-${index}`}>{renderTextWithLinks(value)}</span>
        );
      })}
    </>
  );
}

function renderTextWithLinks(text: string) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  return (
    <>
      {parts.map((part, index) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={`${part}-${index}`}
            href={part}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            {part}
          </a>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        ),
      )}
    </>
  );
}
