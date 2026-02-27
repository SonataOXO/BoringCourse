"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  BookOpenCheck,
  Brain,
  CalendarDays,
  ChartNoAxesCombined,
  CheckCircle2,
  CircleHelp,
  FileText,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
  Settings as SettingsIcon,
  User,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { getCanvasAuthHeaders } from "@/lib/client/canvas-auth";
import { HISTORY_EVENT_NAME, appendHistory, readHistory } from "@/lib/client/history";
import { cn } from "@/lib/utils";

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
    computed_current_grade?: string | null;
  }>;
};

type AssignmentItem = {
  id: number;
  name: string;
  dueAt: string | null;
  type: string;
  canvasUrl?: string;
  conceptHint?: string;
  submissionScore?: number | null;
  pointsPossible?: number | null;
};

type UploadedMaterial = {
  title: string;
  content: string;
  preview: string;
  conceptHint: string;
  wordCount: number;
};

type QuizQuestion = {
  prompt: string;
  options: string[];
  answer: string;
  explanation: string;
};

type FocusDisplay = {
  name: string;
  focus: string;
  score: number;
  classGrade: number;
  upcomingAssignments: AssignmentItem[];
  latestUnit: string;
  conceptsToFocus: string[];
  unitAssignments: AssignmentItem[];
};

type AssignmentCache = Record<number, AssignmentItem[]>;

type PersistedDashboardState = {
  courses: Course[];
  focusRecommendations: FocusRecommendation[];
  upcomingWork: AssignmentItem[];
  selectedCourseId: number | null;
  assignmentCache: AssignmentCache;
  uploadedMaterials: UploadedMaterial[];
};

const DASHBOARD_STORAGE_KEY = "boringcourse-dashboard-v1";
const LATEST_STUDY_GUIDE_KEY = "boringcourse-latest-study-guide-v1";
const HIDE_TUTOR_RESUME_KEY = "boringcourse-hide-resume-tutor-v1";
const HIDE_STUDY_GUIDE_RESUME_KEY = "boringcourse-hide-resume-study-guide-v1";

const fallbackUpcoming: AssignmentItem[] = [
  { id: 1, name: "Lab Report Draft", dueAt: null, type: "Assignment" },
  { id: 2, name: "Chapter Quiz", dueAt: null, type: "Quiz" },
  { id: 3, name: "Reading Reflection", dueAt: null, type: "Essay" },
];

function extractUnitLabel(title: string): string | null {
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

function normalizeTokens(text: string): string[] {
  const stopWords = new Set([
    "unit",
    "chapter",
    "module",
    "lesson",
    "week",
    "current",
    "and",
    "the",
    "for",
    "with",
    "from",
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !stopWords.has(token));
}

function selectUpcomingWindow(assignments: AssignmentItem[], referenceTime: number): AssignmentItem[] {
  const nowDate = new Date(referenceTime);
  const dayOfWeek = nowDate.getDay();
  const daysUntilNextWeekEnd = (14 - dayOfWeek) % 14 || 7;
  const windowEndDate = new Date(nowDate);
  windowEndDate.setDate(nowDate.getDate() + daysUntilNextWeekEnd);
  windowEndDate.setHours(23, 59, 59, 999);
  const windowStart = referenceTime;
  const windowEnd = windowEndDate.getTime();

  const datedSorted = assignments
    .filter((item) => {
      if (!item.dueAt) {
        return false;
      }
      const timestamp = new Date(item.dueAt).getTime();
      return Number.isFinite(timestamp);
    })
    .slice()
    .sort((a, b) => {
      const aTs = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bTs = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      return aTs - bTs;
    });

  const inWindow = datedSorted.filter((item) => {
    const timestamp = item.dueAt ? new Date(item.dueAt).getTime() : Number.NaN;
    return timestamp >= windowStart && timestamp <= windowEnd;
  });

  const source = inWindow;
  const deduped = Array.from(new Map(source.map((item) => [`${item.id}-${item.name}`, item])).values());
  return deduped.slice(0, 8);
}

function isLikelyUnitHeader(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  return /^(unit|chapter|module|lesson)\s*\d+(\b|[:\-\s]).*/.test(normalized);
}

function scoreToLetterGrade(score: number): "A" | "B" | "C" | "D" | "F" {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

function letterToGpaPoints(letter: "A" | "B" | "C" | "D" | "F"): number {
  if (letter === "A") return 4.0;
  if (letter === "B") return 3.0;
  if (letter === "C") return 2.0;
  if (letter === "D") return 1.0;
  return 0.0;
}

function courseTypeAndWeight(courseName: string): { type: "Standard" | "Honors" | "Advanced"; bonus: number } {
  const name = courseName.toLowerCase();
  if (/\b(ap|advanced placement|ib)\b/.test(name)) {
    return { type: "Advanced", bonus: 1.0 };
  }
  if (/\b(honors|dual|concurrent enrollment|college)\b/.test(name)) {
    return { type: "Honors", bonus: 0.5 };
  }
  return { type: "Standard", bonus: 0.0 };
}

function isLikelyNonCreditCourse(courseName: string): boolean {
  const name = courseName.toLowerCase();
  return /\b(advisory|homeroom|study hall|attendance|lunch|office aide|teacher aide|counsel|seminar|support|orientation|survey)\b/.test(
    name,
  );
}

function estimatedCourseCredits(courseName: string): number {
  if (isLikelyNonCreditCourse(courseName)) {
    return 0;
  }
  return 3;
}

export default function Home() {
  const [canvasLoading, setCanvasLoading] = useState(false);
  const [canvasMessage, setCanvasMessage] = useState("Connect Canvas to load real courses, assignments, and grades.");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [accountEmail, setAccountEmail] = useState("Account");

  const [courses, setCourses] = useState<Course[]>([]);
  const [focusRecommendations, setFocusRecommendations] = useState<FocusRecommendation[]>([]);
  const [upcomingWork, setUpcomingWork] = useState<AssignmentItem[]>(fallbackUpcoming);

  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null);
  const [courseAssignments, setCourseAssignments] = useState<AssignmentItem[]>([]);
  const [assignmentCache, setAssignmentCache] = useState<AssignmentCache>({});

  const [uploadedMaterials, setUploadedMaterials] = useState<UploadedMaterial[]>([]);

  const [quiz, setQuiz] = useState<QuizQuestion[]>([]);
  const [quizLoading, setQuizLoading] = useState(false);

  const [globalError, setGlobalError] = useState("");
  const [cacheHydrated, setCacheHydrated] = useState(false);
  const [hoveredSubject, setHoveredSubject] = useState<string | null>(null);
  const [aiUnitConcepts, setAiUnitConcepts] = useState<Record<string, string[]>>({});
  const [aiUnitConceptsLoading, setAiUnitConceptsLoading] = useState<Record<string, boolean>>({});
  const [hasStudyGuideHistory, setHasStudyGuideHistory] = useState(false);
  const [resumeTutorHref, setResumeTutorHref] = useState<string | null>(null);
  const [resumeStudyGuideHref, setResumeStudyGuideHref] = useState<string | null>(null);
  const [latestStudyTimeline, setLatestStudyTimeline] = useState<Array<{ day: string; tasks: string[]; minutes: number }>>([]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DASHBOARD_STORAGE_KEY);
      if (!raw) {
        setCacheHydrated(true);
        return;
      }

      const saved = JSON.parse(raw) as PersistedDashboardState;
      setCourses(saved.courses ?? []);
      setFocusRecommendations(saved.focusRecommendations ?? []);
      setUpcomingWork(saved.upcomingWork?.length ? saved.upcomingWork : fallbackUpcoming);
      setSelectedCourseId(saved.selectedCourseId ?? null);
      setAssignmentCache(saved.assignmentCache ?? {});
      setUploadedMaterials(saved.uploadedMaterials ?? []);
      setCanvasMessage("Loaded saved Canvas data. Sync anytime to refresh.");
    } catch {
      // Ignore malformed saved state.
    } finally {
      setCacheHydrated(true);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/auth/me");
        if (!response.ok) {
          return;
        }

        const json = (await response.json()) as { user?: { email?: string } };
        if (json.user?.email) {
          setAccountEmail(json.user.email);
        }
      } catch {
        // Keep fallback label.
      }
    })();
  }, []);

  useEffect(() => {
    const refreshStudyGuideState = () => {
      const historyItems = readHistory();
      const hasGuide = historyItems.some((item) => item.type === "study-guide");
      const latestTutor = historyItems.find((item) => item.type === "tutor") ?? null;
      const latestStudyGuide = historyItems.find((item) => item.type === "study-guide") ?? null;
      const tutorResumeHidden = window.localStorage.getItem(HIDE_TUTOR_RESUME_KEY) === "1";
      const studyGuideResumeHidden = window.localStorage.getItem(HIDE_STUDY_GUIDE_RESUME_KEY) === "1";
      if (latestTutor && !tutorResumeHidden) {
        const separator = latestTutor.path.includes("?") ? "&" : "?";
        setResumeTutorHref(`${latestTutor.path}${separator}historyId=${encodeURIComponent(latestTutor.id)}`);
      } else {
        setResumeTutorHref(null);
      }
      if (latestStudyGuide && !studyGuideResumeHidden) {
        const separator = latestStudyGuide.path.includes("?") ? "&" : "?";
        setResumeStudyGuideHref(`${latestStudyGuide.path}${separator}historyId=${encodeURIComponent(latestStudyGuide.id)}`);
      } else {
        setResumeStudyGuideHref(null);
      }
      let hasTimeline = false;
      try {
        const raw = window.localStorage.getItem(LATEST_STUDY_GUIDE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as { plan?: Array<{ day?: string; tasks?: string[]; minutes?: number }> };
          const plan = (parsed.plan ?? [])
            .filter((item) => typeof item?.day === "string")
            .map((item) => ({
              day: String(item.day),
              tasks: Array.isArray(item.tasks) ? item.tasks.map((task) => String(task)) : [],
              minutes: Number(item.minutes ?? 45),
            }));
          if (plan.length > 0) {
            hasTimeline = true;
            setLatestStudyTimeline(plan);
          } else {
            setLatestStudyTimeline([]);
          }
        } else {
          setLatestStudyTimeline([]);
        }
      } catch {
        // Ignore malformed local timeline.
      }
      setHasStudyGuideHistory(hasGuide || hasTimeline);
    };

    refreshStudyGuideState();
    window.addEventListener(HISTORY_EVENT_NAME, refreshStudyGuideState);
    window.addEventListener("storage", refreshStudyGuideState);
    return () => {
      window.removeEventListener(HISTORY_EVENT_NAME, refreshStudyGuideState);
      window.removeEventListener("storage", refreshStudyGuideState);
    };
  }, []);

  useEffect(() => {
    if (!cacheHydrated) {
      return;
    }

    const persisted: PersistedDashboardState = {
      courses,
      focusRecommendations,
      upcomingWork,
      selectedCourseId,
      assignmentCache,
      uploadedMaterials,
    };

    window.localStorage.setItem(DASHBOARD_STORAGE_KEY, JSON.stringify(persisted));
  }, [cacheHydrated, courses, focusRecommendations, upcomingWork, selectedCourseId, assignmentCache, uploadedMaterials]);

  useEffect(() => {
    if (!selectedCourseId) {
      return;
    }

    const cached = assignmentCache[selectedCourseId];
    if (cached) {
      setCourseAssignments(cached);
    }
  }, [selectedCourseId, assignmentCache]);

  const selectedCourse = useMemo(
    () => courses.find((course) => course.id === selectedCourseId) ?? null,
    [courses, selectedCourseId],
  );

  const gpaSummary = useMemo(() => {
    const courseStats = courses
      .map((course) => {
        const enrollment = course.enrollments?.[0];
        const score = Number(enrollment?.computed_current_score);
        const rawGrade = typeof enrollment?.computed_current_grade === "string" ? enrollment.computed_current_grade.trim() : "";
        const hasLetterGrade = /^[A-DF][+-]?$/.test(rawGrade.toUpperCase()) || rawGrade.toUpperCase() === "F";
        const normalizedScore = Number.isFinite(score) && score >= 0 && score <= 100 ? score : null;
        const credits = estimatedCourseCredits(course.name);
        const hasScoreEvidence = normalizedScore != null && normalizedScore > 0;
        const hasGradeEvidence = hasLetterGrade || hasScoreEvidence;

        if (!hasGradeEvidence || credits <= 0) {
          return null;
        }

        const letter = hasLetterGrade
          ? ((rawGrade.toUpperCase().replace(/\s+/g, "").charAt(0) || "F") as "A" | "B" | "C" | "D" | "F")
          : scoreToLetterGrade(normalizedScore ?? 0);
        const unweightedPoints = letterToGpaPoints(letter);
        const courseType = courseTypeAndWeight(course.name);
        const weightedPoints = Math.min(5.0, unweightedPoints + courseType.bonus);

        return {
          score: normalizedScore,
          letter,
          credits,
          unweightedPoints,
          weightedPoints,
          courseType: courseType.type,
          hasLetterGrade,
        };
      })
      .filter(
        (
          row,
        ): row is {
          score: number;
          letter: "A" | "B" | "C" | "D" | "F";
          credits: number;
          unweightedPoints: number;
          weightedPoints: number;
          courseType: "Standard" | "Honors" | "Advanced";
          hasLetterGrade: boolean;
        } => Boolean(row),
      );

    const letterGradeCourseStats = courseStats.filter((row) => row.hasLetterGrade);
    const gpaEligibleStats = letterGradeCourseStats.length > 0 ? letterGradeCourseStats : courseStats;

    if (gpaEligibleStats.length === 0) {
      return {
        unweightedGpa: null as number | null,
        weightedGpa: null as number | null,
        averageGrade: null as number | null,
        classCount: 0,
      };
    }

    const scores = gpaEligibleStats.map((row) => row.score);
    const averageGrade = scores.length > 0 ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null;
    const totalCredits = gpaEligibleStats.reduce((sum, row) => sum + row.credits, 0);
    const unweightedGpa =
      totalCredits > 0
        ? gpaEligibleStats.reduce((sum, row) => sum + row.unweightedPoints * row.credits, 0) / totalCredits
        : null;
    const weightedGpa =
      totalCredits > 0
        ? gpaEligibleStats.reduce((sum, row) => sum + row.weightedPoints * row.credits, 0) / totalCredits
        : null;
    return { unweightedGpa, weightedGpa, averageGrade, classCount: gpaEligibleStats.length };
  }, [courses]);

  const focusSubjects = useMemo<FocusDisplay[]>(
    () =>
      focusRecommendations.map((rec) => {
        const matchedCourse = courses.find((course) => course.name === rec.subject);
        const classGrade = Number(matchedCourse?.enrollments?.[0]?.computed_current_score ?? 0);
        const score = Number.isFinite(classGrade) ? Math.max(0, Math.min(100, classGrade)) : 0;
        const assignments = matchedCourse ? assignmentCache[matchedCourse.id] ?? [] : [];

        const now = Date.now();
        const upcomingAssignments = assignments
          .filter((item) => {
            if (!item.dueAt) {
              return false;
            }
            const ts = new Date(item.dueAt).getTime();
            return Number.isFinite(ts) && ts >= now;
          })
          .sort((a, b) => {
            const aTs = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
            const bTs = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
            return aTs - bTs;
          })
          .slice(0, 4);

        const detectedUnits = assignments.map((item) => extractUnitLabel(item.name)).filter(Boolean) as string[];
        const latestUnitFromUpcoming = upcomingAssignments.map((item) => extractUnitLabel(item.name)).find(Boolean) ?? null;
        const latestUnitFromDetected = detectedUnits.sort((a, b) => getUnitRank(b) - getUnitRank(a))[0] ?? null;

        const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
        const latestWeekAssignments = assignments
          .filter((item) => {
            if (!item.dueAt) {
              return false;
            }
            const ts = new Date(item.dueAt).getTime();
            if (!Number.isFinite(ts)) {
              return false;
            }
            return ts >= now - oneWeekMs && ts <= now + oneWeekMs;
          })
          .sort((a, b) => {
            const aTs = a.dueAt ? new Date(a.dueAt).getTime() : 0;
            const bTs = b.dueAt ? new Date(b.dueAt).getTime() : 0;
            return bTs - aTs;
          });

        const latestUnit = latestUnitFromUpcoming ?? latestUnitFromDetected ?? "Latest Week";

        const assignmentsInLatestUnit = assignments.filter((item) => extractUnitLabel(item.name) === latestUnit);

        const sortedByDue = assignments
          .slice()
          .sort((a, b) => {
            const aTs = a.dueAt ? new Date(a.dueAt).getTime() : 0;
            const bTs = b.dueAt ? new Date(b.dueAt).getTime() : 0;
            return bTs - aTs;
          });

        const unitTokens = normalizeTokens(latestUnit);
        const keywordMatchedAssignments =
          unitTokens.length > 0
            ? assignments.filter((item) => {
                const titleTokens = new Set(normalizeTokens(item.name));
                return unitTokens.some((token) => titleTokens.has(token));
              })
            : [];

        const unitAssignments =
          assignmentsInLatestUnit.length > 0
            ? assignmentsInLatestUnit
            : keywordMatchedAssignments.length > 0
              ? keywordMatchedAssignments
              : latestWeekAssignments.length > 0
                ? latestWeekAssignments
                : upcomingAssignments.length > 0
                  ? upcomingAssignments
                : sortedByDue.slice(0, 8);

        const conceptCandidates = unitAssignments
          .slice()
          .sort((a, b) => (a.submissionScore ?? Number.MAX_SAFE_INTEGER) - (b.submissionScore ?? Number.MAX_SAFE_INTEGER))
          .map((item) => item.conceptHint || item.name)
          .filter(Boolean);

        const conceptsToFocus = Array.from(new Set([rec.concept, ...conceptCandidates])).slice(0, 5);

        return {
          name: rec.subject,
          focus: rec.concept,
          score,
          classGrade: score,
          upcomingAssignments,
          latestUnit,
          conceptsToFocus,
          unitAssignments,
        };
      }),
    [focusRecommendations, courses, assignmentCache],
  );

  const displayedUpcomingWork = useMemo(() => {
    return selectUpcomingWindow(
      upcomingWork.filter((item) => Boolean(item.dueAt) && !isLikelyUnitHeader(item.name)),
      Date.now(),
    );
  }, [upcomingWork]);

  const canvasWorkContext = useMemo(() => {
    const selectedCourseBlock = selectedCourse
      ? `Selected course: ${selectedCourse.name}. Assignments: ${courseAssignments
          .slice(0, 30)
          .map((item) => `${item.name}${item.dueAt ? ` (due ${new Date(item.dueAt).toLocaleDateString()})` : ""}`)
          .join("; ")}`
      : "";

    const upcomingBlock =
      displayedUpcomingWork.length > 0
        ? `Upcoming work from Canvas: ${displayedUpcomingWork
            .slice(0, 20)
            .map((item) => `${item.name}${item.dueAt ? ` (due ${new Date(item.dueAt).toLocaleDateString()})` : ""}`)
            .join("; ")}`
        : "";

    return [selectedCourseBlock, upcomingBlock].filter(Boolean).join("\n");
  }, [selectedCourse, courseAssignments, displayedUpcomingWork]);

  const combinedAiContext = useMemo(() => {
    const uploadBlock = uploadedMaterials
      .slice(0, 5)
      .map((material) => `Uploaded material: ${material.title}\n${material.content.slice(0, 2400)}`)
      .join("\n\n");

    return [canvasWorkContext, uploadBlock].filter(Boolean).join("\n\n");
  }, [canvasWorkContext, uploadedMaterials]);

  async function loadAssignmentsForCourse(courseId: number, options?: { preferCache?: boolean }) {
    const preferCache = options?.preferCache ?? true;
    const cached = assignmentCache[courseId];

    if (preferCache && cached && cached.length > 0) {
      setCourseAssignments(cached);
      return;
    }

    setGlobalError("");

    try {
      const assignmentRes = await fetch(`/api/canvas/courses/${courseId}/assignments`, {
        headers: getCanvasAuthHeaders(),
      });
      const assignmentJson = await assignmentRes.json();

      if (!assignmentRes.ok) {
        throw new Error(assignmentJson.error ?? "Failed to load assignments for course");
      }

      const mapped = ((assignmentJson.assignments ?? []) as Array<Record<string, unknown>>).map((item) => ({
        id: Number(item.id),
        name: String(item.name ?? "Assignment"),
        dueAt: (item.dueAt as string | null | undefined) ?? null,
        type: "Assignment",
        canvasUrl: (item.canvasUrl as string | undefined) ?? undefined,
        conceptHint: (item.conceptHint as string | undefined) ?? undefined,
        submissionScore: (item.submissionScore as number | null | undefined) ?? null,
        pointsPossible: (item.pointsPossible as number | null | undefined) ?? null,
      }));

      setCourseAssignments(mapped);
      setAssignmentCache((prev) => ({ ...prev, [courseId]: mapped }));
    } catch (error) {
      setCourseAssignments([]);
      setGlobalError(error instanceof Error ? error.message : "Failed to load assignments");
    }
  }

  async function syncCanvas() {
    setGlobalError("");
    setCanvasLoading(true);

    try {
      const overviewRes = await fetch("/api/canvas/overview", {
        headers: getCanvasAuthHeaders(),
      });
      const overviewJson = await overviewRes.json();

      if (!overviewRes.ok) {
        throw new Error(overviewJson.error ?? "Failed to sync Canvas");
      }

      const fetchedCourses = (overviewJson.courses ?? []) as Course[];
      setCourses(fetchedCourses);
      setFocusRecommendations((overviewJson.focusRecommendations ?? []) as FocusRecommendation[]);
      const overviewUpcoming = ((overviewJson.upcomingAssignments ?? []) as Array<Record<string, unknown>>)
        .map((item) => ({
          id: Number(item.id),
          name: String(item.name ?? "Assignment"),
          dueAt: (item.dueAt as string | null | undefined) ?? null,
          type: String(item.type ?? "Assignment"),
          canvasUrl: (item.canvasUrl as string | undefined) ?? undefined,
          conceptHint: (item.conceptHint as string | undefined) ?? undefined,
          submissionScore: (item.submissionScore as number | null | undefined) ?? null,
          pointsPossible: (item.pointsPossible as number | null | undefined) ?? null,
        }))
        .filter((item) => Boolean(item.dueAt));

      setUpcomingWork(selectUpcomingWindow(overviewUpcoming, Date.now()));

      const firstCourseId = fetchedCourses[0]?.id ?? null;
      setSelectedCourseId(firstCourseId);
      if (firstCourseId) {
        await loadAssignmentsForCourse(firstCourseId, { preferCache: true });
      }

      setCanvasMessage(`Synced ${fetchedCourses.length} course(s).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Canvas sync failed";
      setGlobalError(message);
      setCanvasMessage("Canvas sync failed. Add CANVAS_BASE_URL and CANVAS_API_TOKEN in .env.local.");
    } finally {
      setCanvasLoading(false);
    }
  }

  async function generateQuiz() {
    setGlobalError("");
    setQuizLoading(true);

    try {
      const sourceText = combinedAiContext || "Core concepts and assignment topics.";

      const response = await fetch("/api/ai/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: focusRecommendations[0]?.subject ?? courses[0]?.name ?? "General",
          content: sourceText.slice(0, 6000),
          count: 6,
          difficulty: "medium",
        }),
      });

      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.error ?? "Failed to generate quiz");
      }

      const generated = (json.questions ?? []) as QuizQuestion[];
      setQuiz(generated);
      appendHistory({
        type: "quiz",
        title: "Quiz generated",
        summary: `Created ${generated.length} quiz questions for ${focusRecommendations[0]?.subject ?? courses[0]?.name ?? "General"}.`,
        path: "/",
      });
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : "Quiz generation failed");
    } finally {
      setQuizLoading(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const displayedFocus: FocusDisplay[] = focusSubjects.length > 0
    ? focusSubjects
    : [
        {
          name: "Biology",
          focus: "Upload data to personalize",
          score: 50,
          classGrade: 50,
          upcomingAssignments: [],
          latestUnit: "Current Unit",
          conceptsToFocus: ["Upload Canvas data first"],
          unitAssignments: [],
        },
        {
          name: "Algebra II",
          focus: "Upload data to personalize",
          score: 50,
          classGrade: 50,
          upcomingAssignments: [],
          latestUnit: "Current Unit",
          conceptsToFocus: ["Upload Canvas data first"],
          unitAssignments: [],
        },
      ];

  async function ensureAiUnitConcepts(subject: FocusDisplay) {
    const cacheKey = `${subject.name}::${subject.latestUnit}`;
    if (aiUnitConcepts[cacheKey] || aiUnitConceptsLoading[cacheKey]) {
      return;
    }

    setAiUnitConceptsLoading((prev) => ({ ...prev, [cacheKey]: true }));

    try {
      const response = await fetch("/api/ai/unit-concepts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course: subject.name,
          unit: subject.latestUnit,
          assignments: subject.unitAssignments.map((item) => ({
            name: item.name,
            conceptHint: item.conceptHint,
            submissionScore: item.submissionScore ?? null,
            dueAt: item.dueAt ?? null,
          })),
        }),
      });

      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.error ?? "Failed to infer AI unit concepts");
      }

      const concepts = Array.isArray(json.concepts) ? (json.concepts as string[]) : [];
      if (concepts.length > 0) {
        setAiUnitConcepts((prev) => ({ ...prev, [cacheKey]: concepts }));
      }
    } catch {
      // Use fallback concepts already present in the subject row.
    } finally {
      setAiUnitConceptsLoading((prev) => ({ ...prev, [cacheKey]: false }));
    }
  }

  const displayedTimeline = latestStudyTimeline.length > 0
    ? latestStudyTimeline
    : [
        { day: "Monday", tasks: ["Pick class, unit, and assignments"], minutes: 45 },
        { day: "Wednesday", tasks: ["Upload docs/images and generate checklist"], minutes: 45 },
      ];

  const firstQuiz = quiz[0];

  return (
    <main className="grainy-bg min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 lg:flex-row">
        <div className="min-w-0 flex-1 space-y-7">
          <header className="rounded-3xl border border-border bg-card/80 p-6 shadow-sm backdrop-blur md:p-8">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div className="space-y-3">
              <Badge className="w-fit">BoringCourse AI School Helper</Badge>
              <h1 className="max-w-2xl text-3xl leading-tight font-semibold tracking-tight md:text-5xl">
                Stop guessing what to study. Let your boring course work for you.
              </h1>
              <p className="max-w-2xl text-sm text-muted-foreground md:text-base">
                Connect Canvas, upload text/PDF/DOCX, and get a weekly plan with
                personalized tutoring, flashcards, and quiz practice.
              </p>
              <p className="text-sm text-muted-foreground">{canvasMessage}</p>
              {globalError ? <p className="text-sm font-semibold text-red-600">{globalError}</p> : null}
            </div>
            <div className="w-full rounded-2xl border bg-background/70 p-4 md:w-56">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">GPA Snapshot</p>
              <div className="mt-2 space-y-1">
                <div className="flex items-center justify-between text-base">
                  <span className="text-muted-foreground">Unweighted</span>
                  <span className="text-lg font-semibold">
                    {gpaSummary.unweightedGpa == null ? "--" : gpaSummary.unweightedGpa.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-base">
                  <span className="text-muted-foreground">Weighted</span>
                  <span className="text-lg font-semibold">
                    {gpaSummary.weightedGpa == null ? "--" : gpaSummary.weightedGpa.toFixed(2)}
                  </span>
                </div>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {gpaSummary.classCount > 0
                  ? `${gpaSummary.classCount} classes • ${gpaSummary.averageGrade?.toFixed(1)}% avg`
                  : "Sync Canvas grades to calculate"}
              </p>
            </div>
          </div>
          </header>

          <section className="relative z-10 grid gap-5 md:grid-cols-3">
            <Card className="relative z-30 overflow-visible md:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <CardTitle>Focus Radar</CardTitle>
                <CardDescription>Prioritized by grade trend + assignment performance</CardDescription>
              </div>
              <ChartNoAxesCombined className="size-5 text-accent" />
            </div>
            <div className="space-y-5">
              {displayedFocus.map((subject) => (
                (() => {
                  const cacheKey = `${subject.name}::${subject.latestUnit}`;
                  const hoverConcepts = aiUnitConcepts[cacheKey] ?? subject.conceptsToFocus;
                  const loadingConcepts = Boolean(aiUnitConceptsLoading[cacheKey]);
                  return (
                    <div
                      key={subject.name}
                      className="relative z-0 space-y-2 hover:z-50"
                      onMouseEnter={() => {
                        setHoveredSubject(subject.name);
                        void ensureAiUnitConcepts(subject);
                      }}
                      onMouseLeave={() => setHoveredSubject((current) => (current === subject.name ? null : current))}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold">{subject.name}</p>
                      </div>
                      <Progress value={subject.score} />
                      <p className="text-right text-xs text-muted-foreground">Preparedness: {subject.score}%</p>

                      {hoveredSubject === subject.name ? (
                        <div className="absolute top-0 right-0 z-[120] w-full max-w-md rounded-2xl border bg-background p-3 shadow-xl md:right-2 md:translate-x-[102%]">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Class Hover Insights</p>
                          <p className="mt-1 text-sm font-semibold">Class grade: {subject.classGrade.toFixed(1)}%</p>
                          <p className="mt-2 text-xs font-semibold text-foreground">Upcoming assignments</p>
                          {subject.upcomingAssignments.length > 0 ? (
                            <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                              {subject.upcomingAssignments.map((item) => (
                                <li key={`${subject.name}-${item.id}`}>
                                  {item.name}
                                  {item.dueAt ? ` (due ${new Date(item.dueAt).toLocaleDateString()})` : ""}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="mt-1 text-xs text-muted-foreground">No upcoming assignments detected.</p>
                          )}
                          <p className="mt-2 text-xs font-semibold text-foreground">AI concepts to focus ({subject.latestUnit})</p>
                          {loadingConcepts ? (
                            <p className="mt-1 text-xs text-muted-foreground">Analyzing current unit concepts...</p>
                          ) : (
                            <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                              {hoverConcepts.map((concept) => (
                                <li key={`${subject.name}-${concept}`}>{concept}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })()
              ))}
            </div>
            </Card>

            <Card>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <CardTitle>Smart Tutor</CardTitle>
                <CardDescription>Open a dedicated tutoring session page</CardDescription>
              </div>
              <CircleHelp className="size-5 text-accent" />
            </div>
            <p className="rounded-2xl bg-muted p-3 text-sm text-muted-foreground">
              Start a full tutoring session with assignment uploads + Canvas coursework context on the dedicated page.
            </p>
            <div className="mt-3 flex gap-2">
              <Button asChild variant="secondary" className="flex-1">
                <Link href="/tutor">
                  <Brain className="size-4" /> Start Tutoring Session
                </Link>
              </Button>
              <Button asChild className="flex-1">
                <Link href="/tutor?mode=focus">Focus</Link>
              </Button>
            </div>
            {resumeTutorHref ? (
              <Button asChild variant="secondary" className="mt-2 w-full">
                <Link href={resumeTutorHref}>Jump Back In</Link>
              </Button>
            ) : null}
            </Card>
          </section>

          <section className="grid gap-5 md:grid-cols-2">
            <Card>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <CardTitle>Upcoming Work</CardTitle>
                <CardDescription>Auto-scanned from Canvas + uploads</CardDescription>
              </div>
              <FileText className="size-5 text-accent" />
            </div>
            <div className="space-y-3">
              {displayedUpcomingWork.length > 0 ? (
                displayedUpcomingWork.map((item) =>
                  item.canvasUrl ? (
                    <a
                      key={`${item.id}-${item.name}`}
                      href={item.canvasUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex cursor-pointer items-center justify-between rounded-2xl border bg-background/50 p-3 transition hover:border-accent/50 hover:bg-background"
                    >
                      <div>
                        <p className="text-sm font-semibold">{item.name}</p>
                        <p className="text-xs text-muted-foreground">{item.type}</p>
                      </div>
                      <Badge variant="neutral">Due {new Date(item.dueAt!).toLocaleDateString()}</Badge>
                    </a>
                  ) : (
                    <div key={`${item.id}-${item.name}`} className="flex items-center justify-between rounded-2xl border bg-background/50 p-3">
                      <div>
                        <p className="text-sm font-semibold">{item.name}</p>
                        <p className="text-xs text-muted-foreground">{item.type}</p>
                      </div>
                      <Badge variant="neutral">Due {new Date(item.dueAt!).toLocaleDateString()}</Badge>
                    </div>
                  ),
                )
              ) : (
                <p className="rounded-2xl border bg-background/50 p-3 text-xs text-muted-foreground">
                  No dated assignments found for last week, this week, or next week.
                </p>
              )}
            </div>
            </Card>

            <Card>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <CardTitle>Study Timeline</CardTitle>
                <CardDescription>AI planned schedule for this week</CardDescription>
              </div>
              <BookOpenCheck className="size-5 text-accent" />
            </div>
            <Button asChild>
              <Link href="/study-guide">Generate Study Guide</Link>
            </Button>
            {resumeStudyGuideHref ? (
              <Button asChild variant="secondary" className="mt-2">
                <Link href={resumeStudyGuideHref}>Jump Back In</Link>
              </Button>
            ) : null}
            <p className="mt-3 text-sm text-muted-foreground">
              Opens the dedicated Study Guide page with course/assignment/unit selectors and checklist tracking.
            </p>
            {hasStudyGuideHistory ? (
              <div className="mt-3 space-y-3">
                {displayedTimeline.map((item) => (
                  <div key={item.day} className="flex items-center justify-between rounded-2xl bg-muted p-3">
                    <div>
                      <p className="text-sm font-semibold">{item.day}</p>
                      <p className="text-xs text-muted-foreground">{item.tasks.join(" • ")}</p>
                    </div>
                    <span className="text-xs font-semibold">{item.minutes} min</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 rounded-2xl border bg-background/50 p-3 text-xs text-muted-foreground">
                Generate a study guide first to display the timeline.
              </p>
            )}
            </Card>
          </section>

          <section className="grid gap-5 md:grid-cols-2">
            <Card>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <CardTitle>Flashcards</CardTitle>
                <CardDescription>Open a dedicated flashcards deck</CardDescription>
              </div>
              <Sparkles className="size-5 text-accent" />
            </div>
            <Button asChild variant="secondary">
              <Link href="/flashcards">Open Flashcards</Link>
            </Button>
            <div className="mt-3 rounded-2xl border bg-background/60 p-4">
              <p className="text-sm text-muted-foreground">
                The flashcards page auto-generates from your latest study guide when available, supports card flipping,
                next/back controls, and a chat box to tailor or add more cards.
              </p>
            </div>
            </Card>

            <Card>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <CardTitle>Quiz Mode</CardTitle>
                <CardDescription>Adaptive mixed practice</CardDescription>
              </div>
              <CheckCircle2 className="size-5 text-accent" />
            </div>
            <Button onClick={generateQuiz} disabled={quizLoading}>
              {quizLoading ? "Generating Quiz..." : "Generate Quiz"}
            </Button>
            <div className="mt-3 space-y-3 rounded-2xl border bg-background/60 p-4 text-sm">
              {firstQuiz ? (
                <>
                  <p className="font-semibold">{firstQuiz.prompt}</p>
                  {firstQuiz.options.map((option) => (
                    <div key={option} className="rounded-xl bg-muted p-2">
                      {option}
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">Answer: {firstQuiz.answer}</p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No quiz yet. Generate from your uploaded content.</p>
              )}
            </div>
            </Card>
          </section>
        </div>

        <aside
          className={cn(
            "sticky top-6 self-start rounded-3xl border border-border bg-card/80 p-3 shadow-sm backdrop-blur transition-all duration-300",
            sidebarOpen ? "w-full lg:w-72" : "w-full lg:w-16",
          )}
        >
          <div className="flex items-center justify-between">
            {sidebarOpen ? <p className="text-sm font-semibold">Quick Sidebar</p> : null}
            <button
              type="button"
              onClick={() => setSidebarOpen((prev) => !prev)}
              className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            >
              {sidebarOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
            </button>
          </div>

          {sidebarOpen ? (
            <div className="mt-3 space-y-3">
              <div className="rounded-2xl bg-muted p-3">
                <p className="text-xs text-muted-foreground">Signed in as</p>
                <p className="truncate text-sm font-semibold">{accountEmail}</p>
              </div>

              <Button asChild variant="secondary" className="w-full justify-start">
                <Link href="/account">
                  <User className="size-4" /> Account
                </Link>
              </Button>

              <Button asChild variant="secondary" className="w-full justify-start">
                <Link href="/settings">
                  <SettingsIcon className="size-4" /> Settings
                </Link>
              </Button>

              <Button className="w-full justify-start" onClick={syncCanvas} disabled={canvasLoading}>
                <CalendarDays className="size-4" /> {canvasLoading ? "Syncing..." : "Sync Canvas"}
              </Button>

              <Button asChild variant="secondary" className="w-full justify-start">
                <Link href="/history">History</Link>
              </Button>

              <Button variant="ghost" className="w-full justify-start" onClick={logout}>
                Logout
              </Button>
            </div>
          ) : (
            <div className="mt-3 flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={syncCanvas}
                className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                title={canvasLoading ? "Syncing..." : "Sync Canvas"}
              >
                <CalendarDays className="size-4" />
              </button>
              <Link
                href="/account"
                className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Account"
              >
                <User className="size-4" />
              </Link>
              <Link
                href="/history"
                className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                title="History"
              >
                <FileText className="size-4" />
              </Link>
              <Link
                href="/settings"
                className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Settings"
              >
                <SettingsIcon className="size-4" />
              </Link>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
