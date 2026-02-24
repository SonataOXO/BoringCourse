import { CanvasAssignment, CanvasCourse, FocusRecommendation, GradeSignal } from "@/lib/server/types";

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "for",
  "to",
  "and",
  "of",
  "in",
  "on",
  "with",
  "unit",
  "chapter",
  "project",
  "assignment",
  "quiz",
  "test",
  "lab",
]);

export function inferConceptFromTitle(title: string): string {
  const tokens = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));

  if (tokens.length === 0) {
    return "Core course concepts";
  }

  return tokens.slice(0, 4).join(" ");
}

export function buildGradeSignals(courses: CanvasCourse[]): GradeSignal[] {
  return courses.map((course) => {
    const score = Number(course.enrollments?.[0]?.computed_current_score ?? 0);

    let trend: GradeSignal["trend"] = "steady";
    if (score < 75) {
      trend = "declining";
    } else if (score >= 88) {
      trend = "improving";
    }

    return {
      subject: course.name,
      currentScore: score,
      trend,
      reason: score < 75 ? "Current score is below target band." : "Performance is stable.",
    };
  });
}

export function buildFocusRecommendations(
  courses: CanvasCourse[],
  assignmentsByCourse: Record<number, CanvasAssignment[]>,
): FocusRecommendation[] {
  return courses
    .map((course) => {
      const score = Number(course.enrollments?.[0]?.computed_current_score ?? 0);
      const assignments = assignmentsByCourse[course.id] ?? [];
      const weakAssignment = assignments
        .filter((assignment) => typeof assignment.submission?.score === "number")
        .sort((a, b) => (a.submission?.score ?? 0) - (b.submission?.score ?? 0))[0];

      const concept = weakAssignment ? inferConceptFromTitle(weakAssignment.name) : "Foundational review";

      const priority: FocusRecommendation["priority"] =
        score < 75 ? "high" : score < 88 ? "medium" : "low";

      const suggestedMinutesPerWeek = priority === "high" ? 180 : priority === "medium" ? 120 : 75;

      return {
        subject: course.name,
        priority,
        concept,
        why:
          priority === "high"
            ? `Low current score (${score.toFixed(1)}%) and weaker assignment outcomes.`
            : priority === "medium"
              ? `Moderate score (${score.toFixed(1)}%) needs reinforcement.`
              : `Strong score (${score.toFixed(1)}%) - maintain with light review.`,
        suggestedMinutesPerWeek,
      };
    })
    .sort((a, b) => priorityWeight(b.priority) - priorityWeight(a.priority));
}

function priorityWeight(priority: FocusRecommendation["priority"]): number {
  if (priority === "high") {
    return 3;
  }

  if (priority === "medium") {
    return 2;
  }

  return 1;
}
