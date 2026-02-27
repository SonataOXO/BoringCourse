import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { generateStructured, generateText } from "@/lib/server/openai";

const requestSchema = z.object({
  question: z.string().min(5),
  subject: z.string(),
  context: z.string().optional(),
  chatHistory: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      }),
    )
    .default([]),
  images: z.array(z.string().startsWith("data:image/")).max(5).default([]),
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
});

const mcqFallback = {
  question: "Which expression is equivalent to sqrt(-9)?",
  choices: ["3", "-3", "3i", "-3i"],
  correctIndex: 2,
  explanation: "sqrt(-9) = sqrt(9) * sqrt(-1) = 3i.",
};

const SUBSCRIPT_DIGITS: Record<string, string> = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
};

const SUPERSCRIPT_CHARS: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "+": "⁺",
  "-": "⁻",
};

function toSubscript(value: string): string {
  return value
    .split("")
    .map((char) => SUBSCRIPT_DIGITS[char] ?? char)
    .join("");
}

function toSuperscript(value: string): string {
  return value
    .split("")
    .map((char) => SUPERSCRIPT_CHARS[char] ?? char)
    .join("");
}

function normalizeTutorNotation(raw: string): string {
  let text = raw;

  // x^2, SO4^2-, NO3^- => superscript block
  text = text.replace(/\^([0-9+-]+)/g, (_, exp: string) => toSuperscript(exp));

  // Format chemistry-like tokens: Na+, Cl-, SO4²-, CO2, H2O
  text = text.replace(/\b[A-Za-z][A-Za-z0-9()+\-⁺⁻]{0,24}\b/g, (token) => {
    const looksChemical = /[A-Z]/.test(token) && (/\d/.test(token) || /[+\-⁺⁻]/.test(token));
    if (!looksChemical) {
      return token;
    }

    let next = token;

    // trailing ionic charge (e.g., NO3-, Ca2+, SO4²-)
    next = next.replace(/(\d*)([+\-⁺⁻])$/, (_, chargeDigits: string, sign: string) => {
      const signAscii = sign === "⁺" ? "+" : sign === "⁻" ? "-" : sign;
      const block = `${chargeDigits}${signAscii}`.replace(/[⁺⁻]/g, (char) => (char === "⁺" ? "+" : "-"));
      return toSuperscript(block);
    });

    // stoichiometric numbers to subscript when after element/parenthesis
    next = next.replace(/([A-Za-z\)])(\d+)/g, (_, lead: string, digits: string) => `${lead}${toSubscript(digits)}`);

    return next;
  });

  return text;
}

export async function POST(request: NextRequest) {
  try {
    const json = await request.json();
    const body = requestSchema.parse(json);
    const explicitPracticeCountMatch = body.question.match(/\b(\d{1,2})\s+(?:practice\s+)?problems?\b/i);
    const explicitPracticeCount = explicitPracticeCountMatch ? Number(explicitPracticeCountMatch[1]) : null;
    const asksForPlanning = /\b(plan|schedule|week|deadline|due|focus on first|what should i focus)\b/i.test(
      body.question,
    );
    const userTurnsInRecentHistory = body.chatHistory.filter((item) => item.role === "user").length;
    const repeatedConfusionSignal = /\b(still|again|confused|don't get|do not get|stuck|wrong|incorrect|not working)\b/i.test(
      body.question,
    );
    const needsExtraHelpLinks = !asksForPlanning && (userTurnsInRecentHistory >= 3 || repeatedConfusionSignal);
    const isMathQuestion = /\b(math|algebra|quadratic|equation|function|graph|factor|formula|roots|vertex|discriminant|complex)\b/i.test(
      body.question,
    );
    const asksForPractice = /\b(practice|quiz|multiple choice|mcq|test me|question me)\b/i.test(body.question);
    const isVagueConceptPrompt =
      !asksForPlanning &&
      body.question.trim().split(/\s+/).length <= 10 &&
      /\b(help|stuck|struggling|confused|need help)\b/i.test(body.question) &&
      !/\b(vertex|factoring|quadratic formula|discriminant|roots|graph|complete the square|complex)\b/i.test(body.question);

    const systemPrompt = [
      "You are a real tutor in a one-on-one chat.",
      "Respond directly to the student's latest message, not a template.",
      "Sound human and specific, not robotic.",
      "If student asks a concept question, teach that concept with concrete examples.",
      "If student asks for tips, give practical tips for that exact topic.",
      "Only mention class schedules/deadlines when explicitly asked for planning.",
      "Keep response medium length (120-220 words), clear and helpful.",
      "Use readable structure with bold section titles and bullet points when useful.",
      "For math responses, format clearly with short step-by-step bullets.",
      "For math responses, put each equation on its own bullet line.",
      "For math responses, always include a **Final Answer** section.",
      "For chemistry/math notation, prefer readable Unicode superscripts/subscripts (example: SO₄²⁻, x², NO₃⁻).",
      "Avoid caret notation like ^2 or ^- unless absolutely unavoidable.",
      "When solving quadratics, show both roots when they exist.",
      "If complex numbers are involved, explicitly show `i = sqrt(-1)` usage.",
      "Never leave formulas incomplete or cut off.",
      asksForPlanning
        ? "For planning requests use: **Top Priority**, **This Week Plan**, **How to Study**."
        : "For concept tutoring use: **What This Means**, **Try This**, **Your Next Step**.",
      needsExtraHelpLinks
        ? "Include **1 to 2 helpful links** from reputable learning resources (for example Khan Academy or a relevant YouTube lesson)."
        : "Do not include external links unless the student clearly needs extra help or asks for resources.",
      isVagueConceptPrompt
        ? "If the request is broad/vague, first ask 2-4 clarifying questions about the exact subtopic and preferred help type (tips, walkthrough, or practice)."
        : "If the request is specific, directly teach that exact subtopic.",
      isVagueConceptPrompt
        ? "For vague prompts, keep explanation brief and prioritize questions that narrow scope."
        : "For specific prompts, include one concrete mini-example.",
      explicitPracticeCount && explicitPracticeCount >= 2
        ? `The student asked for ${explicitPracticeCount} practice problems. Provide exactly ${explicitPracticeCount} complete problems, numbered 1-${explicitPracticeCount}, each with a full answer and brief solution steps.`
        : "If providing practice, include fully-formed questions and complete answers.",
      "Always include at least one check-in question tailored to the user's message.",
      "Do not output JSON. Return plain markdown text only.",
    ].join(" ");

    const userPrompt = [
      `Subject: ${body.subject}`,
      `Student message: ${body.question}`,
      `Mode: ${asksForPlanning ? "planning" : "concept tutoring"}`,
      `Math question: ${isMathQuestion ? "yes" : "no"}`,
      `Vague request: ${isVagueConceptPrompt ? "yes" : "no"}`,
      `Needs extra-help links: ${needsExtraHelpLinks ? "yes" : "no"}`,
      `Recent chat history: ${JSON.stringify(body.chatHistory.slice(-6))}`,
      asksForPlanning ? `Context: ${(body.context ?? "").slice(0, 2200)}` : "",
      asksForPlanning ? `Focus recommendations: ${JSON.stringify(body.focusRecommendations.slice(0, 4))}` : "",
      `Image count: ${body.images.length}`,
    ]
      .filter(Boolean)
      .join("\n");

    const responseText = await generateText(systemPrompt, userPrompt, {
      imageDataUrls: body.images,
      maxOutputTokens: explicitPracticeCount && explicitPracticeCount >= 2 ? 1000 : isMathQuestion ? 520 : 360,
      reasoningEffort: "low",
    });

    const shouldIncludeMcq =
      !asksForPlanning &&
      asksForPractice &&
      !(explicitPracticeCount && explicitPracticeCount >= 2);

    let mcq: typeof mcqFallback | undefined;
    if (shouldIncludeMcq) {
      const mcqPrompt = [
        "Create one multiple-choice practice problem tailored to the student's exact topic.",
        "Return exactly 4 choices and one correct index.",
        "Keep wording clear for high school level unless user asks otherwise.",
        `Student message: ${body.question}`,
        `Tutor response context: ${responseText.slice(0, 900)}`,
      ].join("\n");

      const generatedMcq = await generateStructured(
        "Return only JSON shape: { question: string, choices: string[4], correctIndex: number, explanation: string }",
        mcqPrompt,
        mcqFallback,
        { maxOutputTokens: 220, reasoningEffort: "low" },
      );

      const validChoices = Array.isArray(generatedMcq.choices) ? generatedMcq.choices.slice(0, 4) : [];
      const validIndex =
        Number.isInteger(generatedMcq.correctIndex) &&
        generatedMcq.correctIndex >= 0 &&
        generatedMcq.correctIndex < validChoices.length
          ? generatedMcq.correctIndex
          : 0;

      if (validChoices.length === 4) {
        mcq = {
          question: String(generatedMcq.question ?? "").trim() || mcqFallback.question,
          choices: validChoices.map((choice) => String(choice)),
          correctIndex: validIndex,
          explanation: String(generatedMcq.explanation ?? "").trim() || mcqFallback.explanation,
        };
      }
    }

    return NextResponse.json({
      response: normalizeTutorNotation(
        responseText ||
          "Tell me which exact step feels confusing, and I will walk through one example with you.",
      ),
      mcq,
      nextSteps: [],
      focusAdvice: "",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to generate tutoring response",
      },
      { status: 400 },
    );
  }
}
