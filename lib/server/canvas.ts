import { CanvasAssignment, CanvasCourse } from "@/lib/server/types";

type CanvasAuth = {
  baseUrl: string;
  token: string;
};

function normalizeCanvasBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

async function fetchCanvasPage<T>(url: string, token: string): Promise<{ data: T[]; nextUrl?: string }> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Canvas API error ${response.status}: ${details}`);
  }

  const data = (await response.json()) as T[];
  const linkHeader = response.headers.get("link") ?? "";
  const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/i);

  return {
    data,
    nextUrl: nextMatch?.[1],
  };
}

async function fetchAllPages<T>(initialUrl: string, token: string): Promise<T[]> {
  const all: T[] = [];
  let nextUrl: string | undefined = initialUrl;

  while (nextUrl) {
    const pageResult: { data: T[]; nextUrl?: string } = await fetchCanvasPage<T>(nextUrl, token);
    all.push(...pageResult.data);
    nextUrl = pageResult.nextUrl;
  }

  return all;
}

export async function getCanvasCourses(auth: CanvasAuth, search?: string): Promise<CanvasCourse[]> {
  const query = new URLSearchParams({
    per_page: "100",
    enrollment_state: "active",
    include: "total_scores",
  });

  if (search) {
    query.set("search_term", search);
  }

  const url = `${normalizeCanvasBaseUrl(auth.baseUrl)}/api/v1/courses?${query.toString()}`;
  return fetchAllPages<CanvasCourse>(url, auth.token);
}

export async function getCanvasAssignments(auth: CanvasAuth, courseId: number): Promise<CanvasAssignment[]> {
  const query = new URLSearchParams({
    per_page: "100",
    include: "submission",
    order_by: "due_at",
  });

  const url = `${normalizeCanvasBaseUrl(auth.baseUrl)}/api/v1/courses/${courseId}/assignments?${query.toString()}`;
  return fetchAllPages<CanvasAssignment>(url, auth.token);
}

export async function getCanvasAssignmentsForCourses(
  auth: CanvasAuth,
  courseIds: number[],
): Promise<Record<number, CanvasAssignment[]>> {
  const results = await Promise.all(courseIds.map((courseId) => getCanvasAssignments(auth, courseId)));

  return Object.fromEntries(courseIds.map((courseId, idx) => [courseId, results[idx]]));
}

export function resolveCanvasAuth(headers: Headers): CanvasAuth {
  const baseUrl =
    headers.get("x-canvas-base-url") ??
    process.env.CANVAS_BASE_URL ??
    "";

  const token =
    headers.get("x-canvas-token") ??
    process.env.CANVAS_API_TOKEN ??
    "";

  if (!baseUrl || !token) {
    throw new Error(
      "Missing Canvas auth. Set CANVAS_BASE_URL and CANVAS_API_TOKEN env vars, or pass x-canvas-base-url and x-canvas-token headers.",
    );
  }

  return {
    baseUrl,
    token,
  };
}
