import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { generateStructured } from "@/lib/server/openai";

const requestSchema = z.object({
  subject: z.string(),
  content: z.string().min(20),
  count: z.number().int().min(1).max(50).default(15),
  instructions: z.string().optional(),
  existingQuestions: z.array(z.string()).default([]),
});

const fallback = {
  flashcards: [
    {
      question: "What concept should I review first?",
      answer: "Start with the weakest assignment topic and define key terms.",
    },
  ],
};

export async function POST(request: NextRequest) {
  try {
    const json = await request.json();
    const body = requestSchema.parse(json);

    const systemPrompt = [
      "You generate concise, exam-ready flashcards.",
      "Return only valid JSON and no markdown.",
      "JSON shape: { flashcards: Array<{question:string,answer:string}> }.",
      "Cards should be specific and avoid duplicates.",
      `Return exactly ${body.count} cards when possible.`,
    ].join(" ");

    const userPrompt = JSON.stringify({
      subject: body.subject,
      content: body.content,
      count: body.count,
      instructions: body.instructions ?? "",
      existingQuestions: body.existingQuestions.slice(0, 60),
    });
    const result = await generateStructured(systemPrompt, userPrompt, fallback);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to generate flashcards",
      },
      { status: 400 },
    );
  }
}
