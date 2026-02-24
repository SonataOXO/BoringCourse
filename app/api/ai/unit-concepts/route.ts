import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { generateStructured } from "@/lib/server/openai";
import { inferConceptFromTitle } from "@/lib/server/insights";

const requestSchema = z.object({
  course: z.string(),
  unit: z.string(),
  assignments: z
    .array(
      z.object({
        name: z.string(),
        conceptHint: z.string().optional(),
        submissionScore: z.number().nullable().optional(),
        dueAt: z.string().nullable().optional(),
      }),
    )
    .default([]),
});

const fallback = {
  concepts: ["Core definitions", "Worked examples", "Common mistakes"],
};

function isLowSignalConcept(value: string): boolean {
  const lowered = value.toLowerCase();
  return (
    lowered.includes("not enough data") ||
    lowered.includes("no assignment") ||
    lowered.includes("insufficient") ||
    lowered.includes("need more") ||
    lowered.includes("unknown")
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = requestSchema.parse(await request.json());

    const normalizedAssignments = body.assignments
      .filter((item) => item.name.trim().length > 0)
      .slice(0, 20)
      .map((item, index) => {
        const scorePart =
          typeof item.submissionScore === "number" ? ` | score: ${item.submissionScore.toFixed(1)}` : "";
        const hintPart = item.conceptHint?.trim() ? ` | hint: ${item.conceptHint.trim()}` : "";
        return `${index + 1}. ${item.name}${hintPart}${scorePart}`;
      });

    const assignmentLines =
      normalizedAssignments.length > 0 ? normalizedAssignments.join("\n") : "No assignment titles provided.";

    const systemPrompt = [
      "You are an academic curriculum interpreter.",
      "Infer concrete concepts within a class unit from assignment titles and concept hints.",
      "Every concept must be directly grounded in provided assignment titles.",
      "Do not invent topics not evidenced by assignment titles/hints.",
      "Prioritize concepts tied to lower scores when scores are available.",
      "Never output meta-statements like 'not enough data' if assignment titles are present.",
      "Return only valid JSON with shape: { concepts: string[] }",
      "Return 3 to 6 concepts, each under 8 words.",
    ].join(" ");

    const userPrompt = [
      `Course: ${body.course}`,
      `Unit: ${body.unit}`,
      "Assignments in this unit:",
      assignmentLines,
      "Task: extract the most important study concepts for this unit, based on assignment titles first.",
    ].join("\n");
    const result = await generateStructured(systemPrompt, userPrompt, fallback);

    const aiConcepts = Array.isArray(result.concepts) ? result.concepts : [];
    const sanitizedAiConcepts = aiConcepts
      .map((item) => item.trim())
      .filter((item) => item.length > 0 && !isLowSignalConcept(item));

    if (sanitizedAiConcepts.length >= 3) {
      return NextResponse.json({ concepts: sanitizedAiConcepts.slice(0, 6) });
    }

    const titleFallback = Array.from(
      new Set(
        body.assignments
          .map((item) => inferConceptFromTitle(item.name))
          .filter((item) => item && !isLowSignalConcept(item)),
      ),
    ).slice(0, 6);

    if (titleFallback.length > 0) {
      return NextResponse.json({ concepts: titleFallback });
    }

    return NextResponse.json(fallback);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to infer unit concepts",
      },
      { status: 400 },
    );
  }
}
