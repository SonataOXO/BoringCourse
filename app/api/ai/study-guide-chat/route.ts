import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { generateText } from "@/lib/server/openai";

const requestSchema = z.object({
  question: z.string().min(2),
  selectedCourse: z.string().optional(),
  studyGuideOverview: z.string().optional(),
  topicOutline: z.array(z.string()).default([]),
  checklist: z.array(z.string()).default([]),
});

export async function POST(request: NextRequest) {
  try {
    const body = requestSchema.parse(await request.json());

    const systemPrompt = [
      "You are a study-guide refinement assistant.",
      "Respond conversationally and briefly.",
      "Ask clarifying questions when needed, otherwise provide specific improvements.",
      "Do not regenerate a full guide here; provide focused guidance only.",
      "Keep response under 140 words.",
      "Use bullets when useful.",
    ].join(" ");

    const userPrompt = [
      `Question: ${body.question}`,
      `Selected course: ${body.selectedCourse ?? "General"}`,
      `Current overview: ${body.studyGuideOverview ?? ""}`,
      `Current topic outline: ${body.topicOutline.join("; ")}`,
      `Current checklist: ${body.checklist.join("; ")}`,
    ]
      .filter(Boolean)
      .join("\n");

    const responseText = await generateText(systemPrompt, userPrompt, {
      maxOutputTokens: 240,
      reasoningEffort: "low",
    });

    return NextResponse.json({
      response: responseText || "Tell me which concept should be prioritized and I will refine the guide.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate study-guide chat response" },
      { status: 400 },
    );
  }
}
