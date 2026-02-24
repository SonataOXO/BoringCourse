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
  overview: "Focus on highest-priority classes first and study in short daily blocks.",
  plan: [
    {
      day: "Monday",
      tasks: ["Review weak concepts", "Complete one active assignment"],
      minutes: 60,
    },
  ],
  priorities: [
    {
      subject: "General",
      reason: "No detailed data provided.",
      action: "Upload assignments and sync Canvas to personalize.",
    },
  ],
  checklist: [
    "Review one weak concept from your lowest-scoring assignment",
    "Complete 10 practice problems and check errors",
    "Do a 20-minute active recall session",
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
      "Build a high-signal study guide with specific, actionable tasks.",
      "Use grades and focus recommendations to allocate time.",
      "Include a concise checklist of study bullets.",
      "Checklist bullets should be short (max 14 words each).",
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
