import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { generateStructured } from "@/lib/server/openai";

const requestSchema = z.object({
  subject: z.string(),
  content: z.string().min(20),
  count: z.number().int().min(1).max(20).default(8),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
});

const fallback = {
  questions: [
    {
      prompt: "Which study strategy improves retention the most?",
      options: ["Passive rereading", "Spaced retrieval practice", "Skipping review", "Cramming once"],
      answer: "Spaced retrieval practice",
      explanation: "Frequent retrieval over time improves long-term recall.",
    },
  ],
};

export async function POST(request: NextRequest) {
  try {
    const json = await request.json();
    const body = requestSchema.parse(json);

    const systemPrompt = [
      "You produce multiple-choice quizzes for students.",
      "Return only valid JSON.",
      "JSON shape: { questions: Array<{prompt:string,options:string[],answer:string,explanation:string}> }",
      "Each question must have 4 options and one correct answer.",
    ].join(" ");

    const userPrompt = JSON.stringify(body);
    const result = await generateStructured(systemPrompt, userPrompt, fallback);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to generate quiz",
      },
      { status: 400 },
    );
  }
}
