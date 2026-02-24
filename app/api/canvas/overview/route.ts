import { NextRequest, NextResponse } from "next/server";

import { getCanvasAssignmentsForCourses, getCanvasCourses, resolveCanvasAuth } from "@/lib/server/canvas";
import { buildFocusRecommendations, buildGradeSignals } from "@/lib/server/insights";

export async function GET(request: NextRequest) {
  try {
    const auth = resolveCanvasAuth(request.headers);
    const normalizedBaseUrl = auth.baseUrl.replace(/\/+$/, "");
    const search = request.nextUrl.searchParams.get("search") ?? undefined;

    const courses = await getCanvasCourses(auth, search);
    const courseIds = courses.map((course) => course.id);
    const assignmentsByCourse = await getCanvasAssignmentsForCourses(auth, courseIds);

    const gradeSignals = buildGradeSignals(courses);
    const focusRecommendations = buildFocusRecommendations(courses, assignmentsByCourse);

    const assignmentSummary = courseIds.map((courseId) => {
      const assignments = assignmentsByCourse[courseId] ?? [];
      const now = Date.now();
      const upcomingCount = assignments.filter((assignment) => {
        if (!assignment.due_at) {
          return false;
        }

        const dueTs = new Date(assignment.due_at).getTime();
        return Number.isFinite(dueTs) && dueTs >= now;
      }).length;

      return {
        courseId,
        totalAssignments: assignments.length,
        upcomingCount,
      };
    });

    const now = Date.now();
    const nowDate = new Date(now);
    const dayOfWeek = nowDate.getDay();
    const daysUntilNextWeekEnd = (14 - dayOfWeek) % 14 || 7;
    const windowEndDate = new Date(nowDate);
    windowEndDate.setDate(nowDate.getDate() + daysUntilNextWeekEnd);
    windowEndDate.setHours(23, 59, 59, 999);
    const windowStart = now;
    const windowEnd = windowEndDate.getTime();

    const upcomingAssignments = courseIds
      .flatMap((courseId) => {
        const course = courses.find((item) => item.id === courseId);
        const assignments = assignmentsByCourse[courseId] ?? [];
        return assignments.map((assignment) => ({
          id: assignment.id,
          courseId,
          courseName: course?.name ?? "Course",
          name: assignment.name,
          dueAt: assignment.due_at,
          canvasUrl:
            assignment.html_url ?? `${normalizedBaseUrl}/courses/${courseId}/assignments/${assignment.id}`,
          conceptHint: assignment.name,
          submissionScore: assignment.submission?.score ?? null,
          pointsPossible: assignment.points_possible ?? null,
          type: "Assignment",
        }));
      })
      .filter((assignment) => {
        if (!assignment.dueAt) {
          return false;
        }
        const ts = new Date(assignment.dueAt).getTime();
        return Number.isFinite(ts) && ts >= windowStart && ts <= windowEnd;
      })
      .sort((a, b) => {
        const aTs = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
        const bTs = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
        return aTs - bTs;
      })
      .slice(0, 20);

    return NextResponse.json({
      courses,
      gradeSignals,
      focusRecommendations,
      assignmentSummary,
      upcomingAssignments,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to build Canvas overview",
      },
      { status: 400 },
    );
  }
}
