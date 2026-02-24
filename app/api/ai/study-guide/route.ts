import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { generateStructured } from "@/lib/server/openai";

const requestSchema = z.object({
  studentName: z.string().optional(),
  goals: z.array(z.string()).default([]),
  courses: z.array(z.object({ id: z.number(), name: z.string(), currentScore: z.number().nullable().optional() })).default([]),
  focusRecommendations: z
    .array(
      z.object({
        subject: z.string(),
        priority: z.enum(["high", "medium", "low"]),
        concept: z.string(),
        why: z.string(),
        suggestedMinutesPerWeek: z.number(),
      }),
    )
    .default([]),
  uploadedMaterials: z
    .array(
      z.object({
        title: z.string(),
        content: z.string(),
      }),
    )
    .default([]),
  images: z.array(z.string().startsWith("data:image/")).max(5).default([]),
});

const fallback = {
  overview: "Use focused blocks on your selected course concepts and verify understanding with practice.",
  plan: [
    {
      day: "Monday",
      tasks: ["Review the target concept definitions", "Solve 6 guided practice questions"],
      minutes: 60,
    },
  ],
  priorities: [
    {
      subject: "Selected Course",
      reason: "Concentrate on current unit concepts before moving to older topics.",
      action: "Start with weakest concept first, then practice and self-check errors.",
    },
  ],
  checklist: [
    "Define the target concept in your own words",
    "Identify the formula/rule used for this concept",
    "Solve 5 problems on this exact concept",
    "Explain one common mistake and how to avoid it",
  ],
};

export async function POST(request: NextRequest) {
  try {
    const json = await request.json();
    const body = requestSchema.parse(json);

    const compactMaterials = body.uploadedMaterials
      .slice(0, 5)
      .map((item) => ({
        title: item.title.slice(0, 120),
        content: item.content.slice(0, 1400),
      }));

    const systemPrompt = [
      "You are an expert academic coach.",
      "Return only valid JSON.",
      "Build a detailed, high-signal study guide with specific, actionable tasks.",
      "Use grades and focus recommendations to allocate time.",
      "Checklist must contain specific concepts to understand, not generic study habits.",
      "Each checklist item must name a concept, skill, or formula from provided context.",
      "Include a clear outline of what to work on first, second, and third in priorities/action.",
      "Plan tasks should be concrete and tied to selected assignments/units when available.",
      "Checklist bullets should be short (max 16 words each).",
      "Do not include markdown fences.",
      "JSON shape: { overview: string, plan: Array<{day:string,tasks:string[],minutes:number}>, priorities: Array<{subject:string,reason:string,action:string}>, checklist: string[] }",
    ].join(" ");

    const userPrompt = JSON.stringify({
      studentName: body.studentName,
      goals: body.goals,
      courses: body.courses,
      focusRecommendations: body.focusRecommendations.slice(0, 8),
      uploadedMaterials: compactMaterials,
      imageCount: body.images.length,
    });
    const result = await generateStructured(systemPrompt, userPrompt, fallback, {
      imageDataUrls: body.images,
      maxOutputTokens: 700,
      reasoningEffort: "low",
    });

    return NextResponse.json({ studyGuide: result });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to generate study guide",
      },
      { status: 400 },
    );
  }
}
