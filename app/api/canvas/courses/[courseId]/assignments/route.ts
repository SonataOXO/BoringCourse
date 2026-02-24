import { NextRequest, NextResponse } from "next/server";

import { getCanvasAssignments, resolveCanvasAuth } from "@/lib/server/canvas";
import { inferConceptFromTitle } from "@/lib/server/insights";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ courseId: string }> },
) {
  try {
    const { courseId } = await context.params;
    const parsedCourseId = Number(courseId);
    if (Number.isNaN(parsedCourseId)) {
      return NextResponse.json({ error: "Invalid courseId" }, { status: 400 });
    }

    const auth = resolveCanvasAuth(request.headers);
    const assignments = await getCanvasAssignments(auth, parsedCourseId);

    return NextResponse.json({
      assignments: assignments.map((assignment) => ({
        id: assignment.id,
        name: assignment.name,
        conceptHint: inferConceptFromTitle(assignment.name),
        dueAt: assignment.due_at,
        canvasUrl:
          assignment.html_url ??
          `${auth.baseUrl.replace(/\/+$/, "")}/courses/${parsedCourseId}/assignments/${assignment.id}`,
        pointsPossible: assignment.points_possible,
        submissionScore: assignment.submission?.score ?? null,
        submissionState: assignment.submission?.workflow_state ?? null,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to fetch assignments",
      },
      { status: 400 },
    );
  }
}
