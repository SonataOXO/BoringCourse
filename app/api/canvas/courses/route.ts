import { NextRequest, NextResponse } from "next/server";

import { getCanvasCourses, resolveCanvasAuth } from "@/lib/server/canvas";

export async function GET(request: NextRequest) {
  try {
    const auth = resolveCanvasAuth(request.headers);
    const search = request.nextUrl.searchParams.get("search") ?? undefined;
    const courses = await getCanvasCourses(auth, search);

    return NextResponse.json({
      courses: courses.map((course) => ({
        id: course.id,
        name: course.name,
        code: course.course_code,
        currentScore: course.enrollments?.[0]?.computed_current_score ?? null,
        currentGrade: course.enrollments?.[0]?.computed_current_grade ?? null,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to fetch Canvas courses",
      },
      { status: 400 },
    );
  }
}
