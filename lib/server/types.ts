export type CanvasCourse = {
  id: number;
  name: string;
  course_code?: string;
  workflow_state?: string;
  enrollments?: Array<{
    computed_current_score?: number | null;
    computed_current_grade?: string | null;
  }>;
};

export type CanvasAssignment = {
  id: number;
  course_id: number;
  name: string;
  due_at?: string | null;
  html_url?: string | null;
  points_possible?: number | null;
  submission?: {
    score?: number | null;
    submitted_at?: string | null;
    workflow_state?: string | null;
  } | null;
};

export type GradeSignal = {
  subject: string;
  currentScore: number;
  trend: "improving" | "steady" | "declining";
  reason: string;
};

export type FocusRecommendation = {
  subject: string;
  priority: "high" | "medium" | "low";
  concept: string;
  why: string;
  suggestedMinutesPerWeek: number;
};
