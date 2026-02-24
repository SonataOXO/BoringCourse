"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { ArrowLeft, CheckSquare, FileText, Sparkles, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { getCanvasAuthHeaders } from "@/lib/client/canvas-auth";
import { appendHistory } from "@/lib/client/history";

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
  plan: Array<{ day: string; tasks: string[]; minutes: number }>;
  priorities: Array<{ subject: string; reason: string; action: string }>;
  checklist: string[];
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

const DASHBOARD_STORAGE_KEY = "boringcourse-dashboard-v1";
const CHECKLIST_STORAGE_KEY = "boringcourse-study-checks-v1";

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
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
    const target = filteredAssignments.find((item) => item.name.toLowerCase() === assignmentSearch.trim().toLowerCase());
    if (!target) {
      return;
    }

    setSelectedAssignments((prev) => {
      if (prev.some((item) => item.id === target.id)) {
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
      setStudyGuide(generated);
      appendHistory({
        type: "study-guide",
        title: "Study guide generated",
        summary: `${selectedCourseId ? "Course selected" : "General"} • ${generated.checklist.length} checklist items`,
        path: "/study-guide",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate study guide");
    } finally {
      setLoading(false);
    }
  }

  function clearStudyGuideOutput() {
    setStudyGuide(null);
    setCheckedItems({});
    setError("");
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
          <CardTitle>Study Guide Builder</CardTitle>
          <CardDescription>
            Select course + assignments + units, add docs/images, then generate a bullet-based study plan with completion checkboxes.
          </CardDescription>

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

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Selected Assignments</p>
              <div className="mt-2 space-y-2">
                {selectedAssignments.length > 0 ? selectedAssignments.map((item) => (
                  <div key={item.id} className="flex items-center justify-between rounded-xl border bg-background/70 p-2 text-sm">
                    <span className="truncate">{item.name}</span>
                    <button
                      type="button"
                      onClick={() => setSelectedAssignments((prev) => prev.filter((assignment) => assignment.id !== item.id))}
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
                  <span key={unit} className="rounded-full border bg-background/70 px-3 py-1 text-xs">{unit}</span>
                )) : <p className="text-sm text-muted-foreground">No units selected yet.</p>}
              </div>
            </div>
          </div>

          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Your Input</p>
            <textarea
              value={userInput}
              onChange={(event) => setUserInput(event.target.value)}
              placeholder="Add your own notes: goals, weak spots, exam date, preferred study method, time constraints..."
              className="mt-2 h-28 w-full rounded-xl border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={generateGuide} disabled={loading}>
              <Sparkles className="size-4" /> {loading ? "Generating Study Guide..." : "Generate Study Guide"}
            </Button>
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
