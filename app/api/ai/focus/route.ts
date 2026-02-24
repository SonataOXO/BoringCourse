import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { generateStructured } from "@/lib/server/openai";

const requestSchema = z.object({
  courses: z
    .array(
      z.object({
        id: z.number().optional(),
        name: z.string(),
        currentScore: z.number().nullable().optional(),
      }),
    )
    .default([]),
  assignmentsByCourse: z
    .record(
      z.string(),
      z.array(
        z.object({
          name: z.string(),
          conceptHint: z.string().optional(),
          dueAt: z.string().nullable().optional(),
          submissionScore: z.number().nullable().optional(),
          pointsPossible: z.number().nullable().optional(),
        }),
      ),
    )
    .default({}),
  courseFocusContext: z
    .array(
      z.object({
        courseId: z.number(),
        courseName: z.string(),
        basisType: z.enum(["unit", "latest-assignment"]),
        basisLabel: z.string(),
        assignmentTitles: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  selectedOption: z
    .object({
      course: z.string().optional(),
      concept: z.string(),
      reason: z.string().optional(),
      divePrompt: z.string().optional(),
    })
    .optional(),
});

const fallback = {
  overview: "Start with one weaker class, then reinforce one concept in a stronger class to keep momentum.",
  options: [
    {
      id: "focus-1",
      title: "Strengthen weakest recent concept",
      course: "General",
      concept: "Recent assignment topics",
      reason: "Assignment performance suggests gaps in recent concepts.",
      priority: "high",
      divePrompt: "Give me a step-by-step plan for this concept.",
    },
  ],
  deepDive: {
    title: "Deep dive plan",
    plan: ["Review concept definition", "Do 3 guided examples", "Do 3 independent problems"],
    practice: ["Timed mini-quiz", "Error review checklist"],
  },
};

export async function POST(request: NextRequest) {
  try {
    const body = requestSchema.parse(await request.json());

    const systemPrompt = [
      "You are an expert academic strategist.",
      "Analyze class grades and assignment-level signals to identify where a student should focus.",
      "Use courseFocusContext as the primary basis for each course.",
      "For each course, focus on basisType=basisLabel (current unit or latest assignment).",
      "Tie every focus option to assignment titles from that same course context.",
      "Even if a class is 100%, still suggest at least one deeper concept for mastery or retention.",
      "Return options the student can click to dive deeper by class or concept.",
      "Keep deepDive.plan and deepDive.practice concise bullet-style strings (max 16 words each).",
      "Prefer 4-8 bullets in deepDive.plan and 2-4 bullets in deepDive.practice.",
      "Return only valid JSON with this exact shape:",
      '{ "overview": string, "options": [{ "id": string, "title": string, "course": string, "concept": string, "reason": string, "priority": "high"|"medium"|"low", "divePrompt": string }], "deepDive": { "title": string, "plan": string[], "practice": string[] } }',
      "If selectedOption is provided, tailor deepDive specifically to that option.",
    ].join(" ");

    const userPrompt = JSON.stringify(body);
    const result = await generateStructured(systemPrompt, userPrompt, fallback);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to generate focus strategy",
      },
      { status: 400 },
    );
  }
}
