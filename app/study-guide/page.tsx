"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { ArrowLeft, CheckSquare, FileText, SendHorizontal, Sparkles, Upload } from "lucide-react";

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
  enrollments?: Array<{ computed_current_score?: number | null }>;
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
  assignmentCache?: Record<number, AssignmentItem[]>;
  uploadedMaterials?: UploadedMaterial[];
};

type StudyGuideResult = {
  overview: string;
  clarificationQuestion?: string;
  topicOutline?: { topic: string; concepts: string[] };
  plan: Array<{ day: string; tasks: string[]; minutes: number }>;
  priorities: Array<{ subject: string; reason: string; action: string }>;
  checklist: string[];
};

type StudyGuideStructured = {
  tutor_handoff?: {
    context?: {
      course?: { name?: string | null };
      assessment?: { title?: string | null };
      topics?: Array<{ topic?: string; badge?: string }>;
      quiz_style?: { mcq?: string; free_response?: string; graphing?: string };
    };
    brief?: string;
  };
  scope_lock?: {
    topics?: Array<{ topic?: string; badge?: string }>;
  };
};

type LocalDocMaterial = {
  title: string;
  content: string;
  preview: string;
};

type LocalImage = {
  name: string;
  dataUrl: string;
};

type GuideChatMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

const DASHBOARD_STORAGE_KEY = "boringcourse-dashboard-v1";
const CHECKLIST_STORAGE_KEY = "boringcourse-study-checks-v1";
const LATEST_STUDY_GUIDE_KEY = "boringcourse-latest-study-guide-v1";
const TUTOR_HANDOFF_KEY = "boringcourse-tutor-handoff-v1";
const HIDE_STUDY_GUIDE_RESUME_KEY = "boringcourse-hide-resume-study-guide-v1";

function extractUnitTag(title: string): string | null {
  const match = title.match(/\b(unit\s*\d+|chapter\s*\d+|module\s*\d+|lesson\s*\d+)\b/i);
  if (!match?.[1]) {
    return null;
  }

  return match[1].replace(/\s+/g, " ").trim();
}

function summarizeSelectedAssignments(assignments: AssignmentItem[]): string {
  if (assignments.length === 0) {
    return "";
  }

  return assignments
    .map((assignment) => {
      const gradePart =
        typeof assignment.submissionScore === "number"
          ? `score ${assignment.submissionScore}${typeof assignment.pointsPossible === "number" ? `/${assignment.pointsPossible}` : ""}`
          : "score unavailable";
      const conceptPart = assignment.conceptHint ? `concept ${assignment.conceptHint}` : "concept not provided";
      return `${assignment.name} (${gradePart}, ${conceptPart})`;
    })
    .join("; ");
}

export default function StudyGuidePage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [dashboardState, setDashboardState] = useState<PersistedDashboardState>({
    courses: [],
    focusRecommendations: [],
    assignmentCache: {},
    uploadedMaterials: [],
  });

  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null);
  const [courseAssignments, setCourseAssignments] = useState<AssignmentItem[]>([]);
  const [assignmentSearch, setAssignmentSearch] = useState("");
  const [selectedAssignments, setSelectedAssignments] = useState<AssignmentItem[]>([]);

  const [selectedUnits, setSelectedUnits] = useState<string[]>([]);
  const [customUnit, setCustomUnit] = useState("");
  const [userInput, setUserInput] = useState("");

  const [docMaterials, setDocMaterials] = useState<LocalDocMaterial[]>([]);
  const [images, setImages] = useState<LocalImage[]>([]);
  const [uploadMessage, setUploadMessage] = useState("No files added yet.");

  const [studyGuide, setStudyGuide] = useState<StudyGuideResult | null>(null);
  const [studyGuideStructured, setStudyGuideStructured] = useState<StudyGuideStructured | null>(null);
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showBuilderDetails, setShowBuilderDetails] = useState(true);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<GuideChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [hasPendingGuideUpdate, setHasPendingGuideUpdate] = useState(false);

  useEffect(() => {
    try {
      const rawDashboard = window.localStorage.getItem(DASHBOARD_STORAGE_KEY);
      if (rawDashboard) {
        const parsed = JSON.parse(rawDashboard) as PersistedDashboardState;
        const normalized: PersistedDashboardState = {
          courses: parsed.courses ?? [],
          focusRecommendations: parsed.focusRecommendations ?? [],
          assignmentCache: parsed.assignmentCache ?? {},
          uploadedMaterials: parsed.uploadedMaterials ?? [],
        };
        setDashboardState(normalized);

        const firstCourseId = normalized.courses[0]?.id ?? null;
        setSelectedCourseId(firstCourseId);
        if (firstCourseId) {
          setCourseAssignments(normalized.assignmentCache?.[firstCourseId] ?? []);
        }
      }

      const rawChecks = window.localStorage.getItem(CHECKLIST_STORAGE_KEY);
      if (rawChecks) {
        setCheckedItems(JSON.parse(rawChecks) as Record<string, boolean>);
      }
    } catch {
      // Ignore malformed local data.
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(CHECKLIST_STORAGE_KEY, JSON.stringify(checkedItems));
  }, [checkedItems]);

  const filteredAssignments = useMemo(() => {
    const query = assignmentSearch.trim().toLowerCase();
    if (!query) {
      return courseAssignments.slice(0, 30);
    }

    return courseAssignments.filter((item) => item.name.toLowerCase().includes(query)).slice(0, 30);
  }, [assignmentSearch, courseAssignments]);

  const availableUnits = useMemo(() => {
    return Array.from(new Set(courseAssignments.map((item) => extractUnitTag(item.name)).filter(Boolean) as string[]));
  }, [courseAssignments]);

  async function loadAssignmentsForCourse(courseId: number) {
    setError("");

    const cached = dashboardState.assignmentCache?.[courseId];
    if (cached && cached.length > 0) {
      setCourseAssignments(cached);
      return;
    }

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

      setCourseAssignments(mapped);
      setDashboardState((prev) => ({
        ...prev,
        assignmentCache: { ...(prev.assignmentCache ?? {}), [courseId]: mapped },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load assignments");
    }
  }

  function addSelectedAssignment() {
    const query = assignmentSearch.trim().toLowerCase();
    const target = filteredAssignments.find((item) => item.name.toLowerCase() === query) ?? filteredAssignments[0];
    if (!target) {
      return;
    }

    setSelectedAssignments((prev) => {
      if (prev.some((item) => item.id === target.id && item.name === target.name)) {
        return prev;
      }
      return [...prev, target];
    });
    setAssignmentSearch("");
  }

  function toggleChecklistItem(item: string) {
    setCheckedItems((prev) => ({ ...prev, [item]: !prev[item] }));
  }

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
        formData.set("assignmentTitle", selectedAssignments[0]?.name ?? file.name);

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
          preview: String(json.preview ?? ""),
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

  async function generateGuide() {
    setError("");
    setLoading(true);

    try {
      const selectedAssignmentsSummary = summarizeSelectedAssignments(selectedAssignments);
      const unitSummary = selectedUnits.length > 0 ? `Selected units: ${selectedUnits.join(", ")}` : "";

      const syntheticMaterial = [selectedAssignmentsSummary ? `Assignments: ${selectedAssignmentsSummary}` : "", unitSummary]
        .filter(Boolean)
        .join("\n");

      const response = await fetch("/api/ai/study-guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goals: ["Raise grade", "Target weak concepts", "Improve assignment performance"],
          userPrompt: userInput.trim(),
          conversationContext: chatMessages
            .map((message) => `${message.role === "user" ? "User" : "AI"}: ${message.content}`)
            .join("\n")
            .slice(0, 2400),
          selectedUnits,
          selectedCourse: selectedCourseId
            ? {
                id: selectedCourseId,
                name: dashboardState.courses.find((course) => course.id === selectedCourseId)?.name ?? "Selected Course",
                currentScore:
                  dashboardState.courses.find((course) => course.id === selectedCourseId)?.enrollments?.[0]
                    ?.computed_current_score ?? null,
              }
            : undefined,
          selectedAssignments: selectedAssignments.map((item) => ({
            name: item.name,
            submissionScore: item.submissionScore ?? null,
            pointsPossible: item.pointsPossible ?? null,
            conceptHint: item.conceptHint,
          })),
          courses: dashboardState.courses.map((course) => ({
            id: course.id,
            name: course.name,
            currentScore: course.enrollments?.[0]?.computed_current_score ?? null,
          })),
          focusRecommendations: dashboardState.focusRecommendations,
          uploadedMaterials: [
            ...((dashboardState.uploadedMaterials ?? []).map((item) => ({ title: item.title, content: item.content.slice(0, 4000) })) || []),
            ...docMaterials.map((item) => ({ title: item.title, content: item.content.slice(0, 4000) })),
            ...(syntheticMaterial ? [{ title: "Selected Coursework Context", content: syntheticMaterial }] : []),
            ...(userInput.trim()
              ? [
                  {
                    title: "Student Input",
                    content: userInput.trim().slice(0, 4000),
                  },
                ]
              : []),
          ],
          images: images.map((image) => image.dataUrl),
        }),
      });

      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.error ?? "Failed to generate study guide");
      }

      const generated = json.studyGuide as StudyGuideResult;
      const structured = (json.studyGuideStructured ?? null) as StudyGuideStructured | null;
      setStudyGuide(generated);
      setStudyGuideStructured(structured);
      setHasPendingGuideUpdate(false);
      window.localStorage.setItem(
        LATEST_STUDY_GUIDE_KEY,
        JSON.stringify({
          plan: generated.plan ?? [],
          updatedAt: new Date().toISOString(),
        }),
      );
      appendHistory({
        type: "study-guide",
        title: "Study guide generated",
        summary: `${selectedCourseId ? "Course selected" : "General"} • ${generated.checklist.length} checklist items`,
        path: "/study-guide",
        state: {
          selectedCourseId,
          selectedUnits,
          selectedAssignments: selectedAssignments.map((item) => ({ id: item.id, name: item.name })),
          userInput,
          studyGuide: generated,
          studyGuideStructured: structured,
        },
      });
      window.localStorage.setItem(HIDE_STUDY_GUIDE_RESUME_KEY, "0");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate study guide");
    } finally {
      setLoading(false);
    }
  }

  async function sendGuideChat() {
    const prompt = chatInput.trim();
    if (!prompt || !studyGuide) {
      return;
    }

    setChatLoading(true);
    setError("");
    const nextMessages: GuideChatMessage[] = [
      ...chatMessages,
      { role: "user", content: prompt, createdAt: Date.now() },
    ];
    setChatMessages(nextMessages);
    setChatInput("");

    try {
      const response = await fetch("/api/ai/study-guide-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: prompt,
          selectedCourse: dashboardState.courses.find((course) => course.id === selectedCourseId)?.name,
          studyGuideOverview: studyGuide.overview,
          topicOutline: studyGuide.topicOutline?.concepts ?? [],
          checklist: studyGuide.checklist,
        }),
      });

      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.error ?? "Failed to send guide message");
      }

      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: String(json.response ?? ""), createdAt: Date.now() },
      ]);
      setHasPendingGuideUpdate(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send guide message");
    } finally {
      setChatLoading(false);
    }
  }

  function clearStudyGuideOutput() {
    setStudyGuide(null);
    setStudyGuideStructured(null);
    setCheckedItems({});
    setChatMessages([]);
    setChatInput("");
    setHasPendingGuideUpdate(false);
    setError("");
    window.localStorage.setItem(HIDE_STUDY_GUIDE_RESUME_KEY, "1");
  }

  useEffect(() => {
    const historyId = new URLSearchParams(window.location.search).get("historyId");
    if (!historyId) {
      return;
    }

    const historyItem = getHistoryItemById(historyId);
    if (!historyItem || historyItem.type !== "study-guide" || !historyItem.state) {
      return;
    }

    const state = historyItem.state as {
      selectedCourseId?: number | null;
      selectedUnits?: string[];
      selectedAssignments?: Array<{ id: number; name: string }>;
      userInput?: string;
      studyGuide?: StudyGuideResult;
      studyGuideStructured?: StudyGuideStructured;
    };

    if (typeof state.selectedCourseId === "number") {
      setSelectedCourseId(state.selectedCourseId);
      const cachedAssignments = dashboardState.assignmentCache?.[state.selectedCourseId] ?? [];
      setCourseAssignments(cachedAssignments);
    }

    if (Array.isArray(state.selectedUnits)) {
      setSelectedUnits(state.selectedUnits);
    }

    if (Array.isArray(state.selectedAssignments) && state.selectedAssignments.length > 0) {
      const allAssignments = Object.values(dashboardState.assignmentCache ?? {}).flat();
      const restoredAssignments = state.selectedAssignments
        .map((saved) => allAssignments.find((item) => item.id === saved.id && item.name === saved.name))
        .filter(Boolean) as AssignmentItem[];
      if (restoredAssignments.length > 0) {
        setSelectedAssignments(restoredAssignments);
      }
    }

    if (typeof state.userInput === "string") {
      setUserInput(state.userInput);
    }

    if (state.studyGuide) {
      setStudyGuide(state.studyGuide);
    }
    if (state.studyGuideStructured) {
      setStudyGuideStructured(state.studyGuideStructured);
    }
  }, [dashboardState.assignmentCache]);

  function openTutorWithGuide() {
    if (!studyGuide) {
      router.push("/tutor");
      return;
    }

    const selectedCourseName =
      dashboardState.courses.find((course) => course.id === selectedCourseId)?.name ??
      studyGuideStructured?.tutor_handoff?.context?.course?.name ??
      "General";
    const structuredTopics = (studyGuideStructured?.scope_lock?.topics ?? [])
      .map((item) => item.topic)
      .filter((item): item is string => typeof item === "string" && item.length > 0);
    const topicList = structuredTopics.length > 0 ? structuredTopics : (studyGuide.topicOutline?.concepts ?? []);
    const assessmentTitle = studyGuideStructured?.tutor_handoff?.context?.assessment?.title ?? "upcoming assessment";
    const brief = studyGuideStructured?.tutor_handoff?.brief ?? "";
    const checklist = studyGuide.checklist.slice(0, 8).join("; ");

    const payload = {
      source: "study-guide",
      subject: selectedCourseName,
      question: `Use my study guide context and tutor me on ${topicList.slice(0, 3).join(", ") || "my current topic"} for ${assessmentTitle}.`,
      context: [
        `Study guide overview: ${studyGuide.overview}`,
        topicList.length > 0 ? `Guide topics: ${topicList.join(", ")}` : "",
        brief ? `Tutor handoff: ${brief}` : "",
        checklist ? `Checklist focus: ${checklist}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    };

    window.localStorage.setItem(TUTOR_HANDOFF_KEY, JSON.stringify(payload));
    router.push("/tutor?from=study-guide&autostart=1");
  }

  return (
    <main className="grainy-bg min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-6xl space-y-5">
        <Button asChild variant="ghost" size="sm">
          <Link href="/">
            <ArrowLeft className="size-4" /> Back to Dashboard
          </Link>
        </Button>

        <Card>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Study Guide Builder</CardTitle>
              <CardDescription>
                Select course + assignments + units, add docs/images, then generate a bullet-based study plan with completion checkboxes.
              </CardDescription>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={() => setShowBuilderDetails((prev) => !prev)}>
              {showBuilderDetails ? "Collapse Details" : "Reopen Details"}
            </Button>
          </div>

          {showBuilderDetails ? (
            <>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <select
                  value={selectedCourseId ?? ""}
                  onChange={(event) => {
                    const raw = event.target.value;
                    if (!raw) {
                      setSelectedCourseId(null);
                      setCourseAssignments([]);
                      return;
                    }

                    const courseId = Number(raw);
                    setSelectedCourseId(courseId);
                    void loadAssignmentsForCourse(courseId);
                  }}
                  className="h-10 rounded-xl border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Select course</option>
                  {dashboardState.courses.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.name}
                    </option>
                  ))}
                </select>

                <div className="flex gap-2">
                  <input
                    value={assignmentSearch}
                    onChange={(event) => setAssignmentSearch(event.target.value)}
                    list="study-assignment-list"
                    placeholder="Search assignment"
                    className="h-10 flex-1 rounded-xl border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                  <Button type="button" variant="secondary" onClick={addSelectedAssignment}>
                    Add
                  </Button>
                  <datalist id="study-assignment-list">
                    {filteredAssignments.map((assignment) => (
                      <option key={assignment.id} value={assignment.name} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Unit Selector</p>
                  <div className="flex gap-2">
                    <select
                      defaultValue=""
                      onChange={(event) => {
                        const value = event.target.value;
                        if (!value) {
                          return;
                        }
                        setSelectedUnits((prev) => (prev.includes(value) ? prev : [...prev, value]));
                        event.currentTarget.value = "";
                      }}
                      className="h-10 flex-1 rounded-xl border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">Choose detected unit</option>
                      {availableUnits.map((unit) => (
                        <option key={unit} value={unit}>
                          {unit}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={customUnit}
                      onChange={(event) => setCustomUnit(event.target.value)}
                      placeholder="Add unit manually"
                      className="h-10 flex-1 rounded-xl border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        const unit = customUnit.trim();
                        if (!unit) {
                          return;
                        }
                        setSelectedUnits((prev) => (prev.includes(unit) ? prev : [...prev, unit]));
                        setCustomUnit("");
                      }}
                    >
                      Add Unit
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Files</p>
                  <input ref={fileInputRef} type="file" multiple accept="image/*,.txt,.md,.pdf,.docx" onChange={handleFiles} className="hidden" />
                  <Button type="button" className="w-full" onClick={() => fileInputRef.current?.click()}>
                    <Upload className="size-4" /> Add Images/Documents
                  </Button>
                  <p className="text-xs text-muted-foreground">{uploadMessage}</p>
                </div>
              </div>
            </>
          ) : null}

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Selected Assignments</p>
              <div className="mt-2 space-y-2">
                {selectedAssignments.length > 0 ? selectedAssignments.map((item) => (
                  <div key={`${item.id}-${item.name}`} className="flex items-center justify-between rounded-xl border bg-background/70 p-2 text-sm">
                    <span className="truncate">{item.name}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedAssignments((prev) =>
                          prev.filter((assignment) => !(assignment.id === item.id && assignment.name === item.name)),
                        )
                      }
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Remove
                    </button>
                  </div>
                )) : <p className="text-sm text-muted-foreground">No assignments selected yet.</p>}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Selected Units</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {selectedUnits.length > 0 ? selectedUnits.map((unit) => (
                  <span key={unit} className="inline-flex items-center gap-2 rounded-full border bg-background/70 px-3 py-1 text-xs">
                    {unit}
                    <button
                      type="button"
                      onClick={() => setSelectedUnits((prev) => prev.filter((item) => item !== unit))}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={`Remove ${unit}`}
                    >
                      x
                    </button>
                  </span>
                )) : <p className="text-sm text-muted-foreground">No units selected yet.</p>}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Your Input</p>
              <textarea
                value={userInput}
                onChange={(event) => setUserInput(event.target.value)}
                placeholder="Add your own notes: goals, weak spots, exam date, preferred study method, time constraints..."
                className="mt-2 h-28 w-full rounded-xl border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">AI Chatbox</p>
              <div className="mt-2 h-28 overflow-y-auto rounded-xl border bg-background p-3 text-sm">
                {studyGuide ? (
                  chatMessages.length > 0 ? (
                    <div className="space-y-2">
                      {chatMessages.slice(-3).map((message, index) => (
                        <p key={`${message.createdAt}-${index}`} className={message.role === "user" ? "font-semibold" : "text-muted-foreground"}>
                          {message.role === "user" ? "You: " : "AI: "}
                          {message.content}
                        </p>
                      ))}
                    </div>
                  ) : studyGuide.clarificationQuestion ? (
                    <>
                      <p className="font-semibold">Clarification Needed</p>
                      <p className="mt-1 text-muted-foreground">{studyGuide.clarificationQuestion}</p>
                    </>
                  ) : (
                    <>
                      <p className="font-semibold">{studyGuide.topicOutline?.topic ?? "Latest guide response"}</p>
                      <p className="mt-1 text-muted-foreground">{studyGuide.overview}</p>
                    </>
                  )
                ) : (
                  <p className="text-muted-foreground">AI response preview appears here after you generate the study guide.</p>
                )}
              </div>
              {studyGuide ? (
                <div className="mt-2 flex gap-2">
                  <input
                    value={chatInput}
                    onChange={(event) => setChatInput(event.target.value)}
                    placeholder="Ask AI to refine this guide..."
                    className="h-10 flex-1 rounded-xl border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                  <Button type="button" onClick={sendGuideChat} disabled={chatLoading || !chatInput.trim()}>
                    <SendHorizontal className="size-4" />
                  </Button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {!studyGuide ? (
              <Button onClick={generateGuide} disabled={loading}>
                <Sparkles className="size-4" /> {loading ? "Generating Study Guide..." : "Generate Study Guide"}
              </Button>
            ) : (
              <Button onClick={generateGuide} disabled={loading || !hasPendingGuideUpdate}>
                <Sparkles className="size-4" /> {loading ? "Regenerating..." : "Regenerate with Context"}
              </Button>
            )}
            <Button type="button" variant="secondary" onClick={clearStudyGuideOutput} disabled={!studyGuide}>
              Clear Chat
            </Button>
          </div>

          {error ? <p className="mt-3 text-sm font-semibold text-red-600">{error}</p> : null}
        </Card>

        {studyGuide ? (
          <div className="grid gap-5 md:grid-cols-2">
            <Card>
              <CardTitle>Study Overview</CardTitle>
              <CardDescription>{studyGuide.overview}</CardDescription>
              {studyGuide.topicOutline ? (
                <div className="mt-3 rounded-xl border bg-background/70 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Topic Outline</p>
                  <p className="mt-1 text-sm font-semibold">{studyGuide.topicOutline.topic}</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {studyGuide.topicOutline.concepts.map((concept) => (
                      <li key={concept}>{concept}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="mt-4 rounded-xl border bg-background/70 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Work Outline</p>
                <div className="mt-2 space-y-2">
                  {studyGuide.priorities.slice(0, 3).map((item, index) => (
                    <div key={`${item.subject}-${index}`} className="rounded-lg border bg-background p-2">
                      <p className="text-sm font-semibold">
                        {index + 1}. {item.subject}
                      </p>
                      <p className="text-xs text-muted-foreground">{item.reason}</p>
                      <p className="mt-1 text-xs">{item.action}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {studyGuide.plan.map((item) => (
                  <div key={item.day} className="rounded-xl border bg-background/70 p-3">
                    <p className="text-sm font-semibold">{item.day} ({item.minutes} min)</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                      {item.tasks.map((task) => (
                        <li key={`${item.day}-${task}`}>{task}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <Button className="mt-4" onClick={openTutorWithGuide}>
                Need more help? Open Tutor
              </Button>
            </Card>

            <Card>
              <CardTitle className="flex items-center gap-2"><CheckSquare className="size-4" /> Study Checklist</CardTitle>
              <CardDescription>Mark each bullet as completed while you study.</CardDescription>
              <div className="mt-4 space-y-2">
                {studyGuide.checklist.map((item) => (
                  <label key={item} className="flex items-start gap-2 rounded-xl border bg-background/70 p-3 text-sm">
                    <input type="checkbox" checked={Boolean(checkedItems[item])} onChange={() => toggleChecklistItem(item)} />
                    <span>{item}</span>
                  </label>
                ))}
              </div>
            </Card>
          </div>
        ) : (
          <Card>
            <CardTitle className="flex items-center gap-2"><FileText className="size-4" /> Generated Guide</CardTitle>
            <CardDescription>Your generated guide and checklist will appear here.</CardDescription>
          </Card>
        )}
      </div>
    </main>
  );
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
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}
