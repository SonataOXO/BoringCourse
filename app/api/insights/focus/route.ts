import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { buildFocusRecommendations } from "@/lib/server/insights";
import { CanvasAssignment, CanvasCourse } from "@/lib/server/types";

const requestSchema = z.object({
  courses: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      enrollments: z
        .array(
          z.object({
            computed_current_score: z.number().nullable().optional(),
            computed_current_grade: z.string().nullable().optional(),
          }),
        )
        .optional(),
    }),
  ),
  assignmentsByCourse: z.record(
    z.string(),
    z.array(
      z.object({
        id: z.number(),
        course_id: z.number(),
        name: z.string(),
        due_at: z.string().nullable().optional(),
        points_possible: z.number().nullable().optional(),
        submission: z
          .object({
            score: z.number().nullable().optional(),
            submitted_at: z.string().nullable().optional(),
            workflow_state: z.string().nullable().optional(),
          })
          .nullable()
          .optional(),
      }),
    ),
  ),
});

export async function POST(request: NextRequest) {
  try {
    const json = await request.json();
    const body = requestSchema.parse(json);

    const recommendations = buildFocusRecommendations(
      body.courses as CanvasCourse[],
      body.assignmentsByCourse as unknown as Record<number, CanvasAssignment[]>,
    );

    return NextResponse.json({ recommendations });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to generate focus insights",
      },
      { status: 400 },
    );
  }
}
