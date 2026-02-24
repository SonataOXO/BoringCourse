import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getCanvasAssignments, getCanvasCourses, resolveCanvasAuth } from "@/lib/server/canvas";

const requestSchema = z.object({
  userQuestion: z.string().min(2),
  userToday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  courseId: z.number().optional(),
});

type CanvasQuiz = {
  id: number;
  title: string;
  description?: string | null;
  due_at?: string | null;
  time_limit?: number | null;
  allowed_attempts?: number | null;
  question_count?: number | null;
};

type CanvasModule = {
  id: number;
  name: string;
};

type CanvasModuleItem = {
  id: number;
  title?: string | null;
  type?: string | null;
  url?: string | null;
  due_at?: string | null;
};

type CanvasAnnouncement = {
  id: number;
  title: string;
  message?: string | null;
  posted_at?: string | null;
};

type CanvasPage = {
  page_id?: number;
  url: string;
  title: string;
  updated_at?: string | null;
};

type CanvasFile = {
  id: number;
  display_name: string;
  updated_at?: string | null;
  url?: string | null;
};

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function extractTopicTokens(question: string): string[] {
  const stopWords = new Set([
    "i",
    "need",
    "help",
    "with",
    "the",
    "a",
    "an",
    "for",
    "to",
    "on",
    "and",
    "of",
    "my",
    "quiz",
    "test",
    "study",
    "guide",
  ]);

  return Array.from(
    new Set(
      question
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((token) => token.length > 2 && !stopWords.has(token)),
    ),
  ).slice(0, 8);
}

function isWeekday(dateStr: string | null | undefined): boolean {
  if (!dateStr) {
    return false;
  }
  const day = new Date(dateStr).getDay();
  return day !== 0 && day !== 6;
}

function parseDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00`);
}

function toIsoEndOfDay(date: Date): string {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end.toISOString();
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function textMatchScore(text: string, tokens: string[]): number {
  const lowered = text.toLowerCase();
  return tokens.reduce((score, token) => (lowered.includes(token) ? score + 1 : score), 0);
}

async function fetchCanvasList<T>(url: string, token: string): Promise<T[]> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Canvas API error ${response.status}`);
  }
  return (await response.json()) as T[];
}

async function fetchCanvasObject<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Canvas API error ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function POST(request: NextRequest) {
  try {
    const { userQuestion, userToday, courseId } = requestSchema.parse(await request.json());
    const topicTokens = extractTopicTokens(userQuestion);
    const today = parseDate(userToday);
    const windowEnd = addDays(today, 10);
    const auth = resolveCanvasAuth(request.headers);
    const baseUrl = normalizeBaseUrl(auth.baseUrl);

    const courses = await getCanvasCourses(auth);
    const guessedCourse =
      (courseId ? courses.find((course) => course.id === courseId) : null) ??
      courses
        .slice()
        .sort((a, b) => {
          const aScore = textMatchScore(`${a.name} ${a.course_code ?? ""}`, topicTokens);
          const bScore = textMatchScore(`${b.name} ${b.course_code ?? ""}`, topicTokens);
          return bScore - aScore;
        })[0] ??
      null;

    if (!guessedCourse) {
      return NextResponse.json({
        contextSummary: {
          course: null,
          targetAssessment: null,
          whyBestMatch: "No active Canvas course could be identified.",
          likelyScope: [],
          teacherStyleSignals: [],
          constraints: [],
          materialsFound: [],
        },
        uncertainties: ["No active course found."],
        userQuestions: [
          "Which course should be used for this study guide?",
        ],
        planSpec: {
          course_id: null,
          assessment: { type: null, id: null, title: null, due_at: null },
          topic_tokens: topicTokens,
          in_scope_topics: [],
          out_of_scope_topics: [],
          question_style: { mcq: "unknown", free_response: "unknown", graphing: "unknown" },
          materials: { module_items: [], files: [], pages: [], announcements: [] },
          personalization: { weak_areas: [], signals: [] },
          ready_to_generate: false,
        },
      });
    }

    const quizzesUrl = `${baseUrl}/api/v1/courses/${guessedCourse.id}/quizzes?per_page=100`;
    const quizzes = await fetchCanvasList<CanvasQuiz>(quizzesUrl, auth.token);
    const quizCandidates = quizzes
      .filter((quiz) => {
        if (!quiz.due_at || !isWeekday(quiz.due_at)) {
          return false;
        }
        const due = new Date(quiz.due_at);
        return due >= today && due <= windowEnd;
      })
      .map((quiz) => {
        const due = new Date(quiz.due_at!);
        const tokenScore = textMatchScore(`${quiz.title} ${quiz.description ?? ""}`, topicTokens);
        const dueSoonness = Math.abs(due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
        const rankScore = tokenScore * 10 - dueSoonness;
        return { quiz, rankScore };
      })
      .sort((a, b) => b.rankScore - a.rankScore);

    let targetAssessment:
      | { type: "quiz"; id: number; title: string; due_at: string | null; courseId: number; description?: string | null }
      | { type: "assignment"; id: number; title: string; due_at: string | null; courseId: number; description?: string | null }
      | null = null;

    if (quizCandidates.length > 0) {
      const selectedQuiz = quizCandidates[0].quiz;
      targetAssessment = {
        type: "quiz",
        id: selectedQuiz.id,
        title: selectedQuiz.title,
        due_at: selectedQuiz.due_at ?? null,
        courseId: guessedCourse.id,
        description: selectedQuiz.description ?? null,
      };
    } else {
      const assignments = await getCanvasAssignments(auth, guessedCourse.id);
      const assignmentCandidates = assignments
        .filter((assignment) => {
          if (!assignment.due_at || !isWeekday(assignment.due_at)) {
            return false;
          }
          const due = new Date(assignment.due_at);
          return due >= today && due <= windowEnd;
        })
        .map((assignment) => {
          const tokenScore = textMatchScore(assignment.name, topicTokens);
          return { assignment, tokenScore };
        })
        .sort((a, b) => b.tokenScore - a.tokenScore);

      if (assignmentCandidates.length > 0) {
        const selectedAssignment = assignmentCandidates[0].assignment;
        targetAssessment = {
          type: "assignment",
          id: selectedAssignment.id,
          title: selectedAssignment.name,
          due_at: selectedAssignment.due_at ?? null,
          courseId: guessedCourse.id,
        };
      }
    }

    const quizDetails =
      targetAssessment?.type === "quiz"
        ? await fetchCanvasObject<CanvasQuiz>(
            `${baseUrl}/api/v1/courses/${targetAssessment.courseId}/quizzes/${targetAssessment.id}`,
            auth.token,
          )
        : null;

    const modules = await fetchCanvasList<CanvasModule>(`${baseUrl}/api/v1/courses/${guessedCourse.id}/modules?per_page=100`, auth.token);
    const selectedModule =
      modules
        .slice()
        .sort(
          (a, b) => textMatchScore(b.name, topicTokens) - textMatchScore(a.name, topicTokens),
        )[0] ?? null;

    const moduleItems = selectedModule
      ? await fetchCanvasList<CanvasModuleItem>(
          `${baseUrl}/api/v1/courses/${guessedCourse.id}/modules/${selectedModule.id}/items?per_page=100`,
          auth.token,
        )
      : [];

    const announcements = await fetchCanvasList<CanvasAnnouncement>(
      `${baseUrl}/api/v1/announcements?context_codes[]=course_${guessedCourse.id}&start_date=${today.toISOString()}&end_date=${toIsoEndOfDay(windowEnd)}&per_page=50`,
      auth.token,
    );

    const pages = await fetchCanvasList<CanvasPage>(`${baseUrl}/api/v1/courses/${guessedCourse.id}/pages?per_page=100`, auth.token);
    const files = await fetchCanvasList<CanvasFile>(`${baseUrl}/api/v1/courses/${guessedCourse.id}/files?per_page=100`, auth.token);

    const gradeAssignments = await getCanvasAssignments(auth, guessedCourse.id);
    const weakSignals = gradeAssignments
      .filter((item) => typeof item.submission?.score === "number" && typeof item.points_possible === "number" && item.points_possible > 0)
      .map((item) => ({
        item_name: item.name,
        score_pct: Math.round(((item.submission?.score ?? 0) / (item.points_possible ?? 1)) * 100),
      }))
      .filter((item) => item.score_pct < 80)
      .sort((a, b) => a.score_pct - b.score_pct)
      .slice(0, 5);

    const likelyTopics = Array.from(
      new Set(
        [
          ...topicTokens,
          ...moduleItems
            .map((item) => item.title ?? "")
            .filter(Boolean)
            .flatMap((title) => extractTopicTokens(title)),
        ].filter(Boolean),
      ),
    ).slice(0, 10);

    const uncertainties: string[] = [];
    if (!targetAssessment) {
      uncertainties.push("No weekday assessment in the next 10 days was found in the selected course.");
    }
    if (!quizDetails?.time_limit && targetAssessment?.type === "quiz") {
      uncertainties.push("Quiz time limit is not clearly available.");
    }
    if (quizDetails?.allowed_attempts == null && targetAssessment?.type === "quiz") {
      uncertainties.push("Allowed attempts are not clearly available.");
    }

    const userQuestions =
      uncertainties.length > 0
        ? [
            "If multiple assessments appear in your class, should we target the earliest weekday due date? (A) Yes (B) No, I will pick manually",
            "What is the expected format if unclear? (A) Mostly MCQ (B) Mostly free response (C) Mixed",
          ].slice(0, 2)
        : [];

    return NextResponse.json({
      contextSummary: {
        course: {
          id: guessedCourse.id,
          name: guessedCourse.name,
          term: guessedCourse.course_code ?? null,
        },
        targetAssessment: targetAssessment
          ? {
              type: targetAssessment.type,
              id: targetAssessment.id,
              title: targetAssessment.title,
              due_at: targetAssessment.due_at,
            }
          : null,
        whyBestMatch: targetAssessment
          ? "Selected by weekday due date proximity in the 10-day window and topic-token title match."
          : "No valid weekday assessment candidate found in the date window.",
        likelyScope: likelyTopics,
        teacherStyleSignals: [
          ...(quizDetails?.question_count ? [`Quiz has ${quizDetails.question_count} questions.`] : []),
          ...(quizDetails?.description ? ["Quiz description provides teacher expectations."] : []),
          ...announcements
            .filter((a) => textMatchScore(`${a.title} ${a.message ?? ""}`, ["review", "quiz", ...topicTokens]) > 0)
            .slice(0, 2)
            .map((a) => `Announcement cue: ${a.title}`),
        ],
        constraints: [
          ...(quizDetails?.time_limit ? [`Time limit: ${quizDetails.time_limit} minutes`] : []),
          ...(quizDetails?.allowed_attempts != null ? [`Allowed attempts: ${quizDetails.allowed_attempts}`] : []),
          ...(targetAssessment?.due_at ? [`Due at: ${targetAssessment.due_at}`] : []),
        ],
        materialsFound: {
          module_items: moduleItems
            .filter((item) => textMatchScore(item.title ?? "", topicTokens) > 0)
            .slice(0, 8)
            .map((item) => item.title ?? "Untitled"),
          files: files
            .filter((file) => textMatchScore(file.display_name, ["review", "study", ...topicTokens]) > 0)
            .slice(0, 8)
            .map((file) => file.display_name),
          pages: pages
            .filter((page) => textMatchScore(`${page.title} ${page.url}`, ["review", "study", ...topicTokens]) > 0)
            .slice(0, 8)
            .map((page) => page.title),
          announcements: announcements
            .filter((a) => textMatchScore(`${a.title} ${a.message ?? ""}`, ["quiz", "review", ...topicTokens]) > 0)
            .slice(0, 8)
            .map((a) => a.title),
        },
      },
      uncertainties,
      userQuestions,
      planSpec: {
        course_id: guessedCourse.id,
        assessment: targetAssessment
          ? {
              type: targetAssessment.type,
              id: String(targetAssessment.id),
              title: targetAssessment.title,
              due_at: targetAssessment.due_at,
            }
          : { type: null, id: null, title: null, due_at: null },
        topic_tokens: topicTokens,
        in_scope_topics: likelyTopics,
        out_of_scope_topics: [],
        question_style: {
          mcq: targetAssessment?.type === "quiz" ? "unknown" : "unknown",
          free_response: "unknown",
          graphing: "unknown",
        },
        materials: {
          module_items: moduleItems.slice(0, 12).map((i) => i.title ?? "Untitled"),
          files: files.slice(0, 12).map((f) => f.display_name),
          pages: pages.slice(0, 12).map((p) => p.title),
          announcements: announcements.slice(0, 12).map((a) => a.title),
        },
        personalization: {
          weak_areas: weakSignals.map((s) => s.item_name),
          signals: weakSignals.map((s) => `${s.item_name}: ${s.score_pct}%`),
        },
        ready_to_generate: false,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to lock study-guide scope",
      },
      { status: 400 },
    );
  }
}
