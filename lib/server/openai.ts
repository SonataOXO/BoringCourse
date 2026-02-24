import OpenAI from "openai";

import { requireEnv, readEnv } from "@/lib/server/env";
import { safeParseJson } from "@/lib/server/json";

const modelName = readEnv("OPENAI_MODEL", "gpt-5-mini")!;

function getClient(): OpenAI {
  const apiKey = requireEnv("OPENAI_API_KEY");
  return new OpenAI({ apiKey });
}

export async function generateStructured<T>(
  systemPrompt: string,
  userPrompt: string,
  fallback: T,
  options?: {
    imageDataUrls?: string[];
    maxOutputTokens?: number;
    reasoningEffort?: "low" | "medium" | "high";
  },
): Promise<T> {
  const client = getClient();
  const imageDataUrls = options?.imageDataUrls ?? [];

  const userContent: Array<
    { type: "input_text"; text: string } | { type: "input_image"; image_url: string; detail: "auto" | "low" | "high" }
  > = [
    { type: "input_text", text: userPrompt },
  ];

  for (const imageUrl of imageDataUrls) {
    userContent.push({ type: "input_image", image_url: imageUrl, detail: "auto" });
  }

  const response = await client.responses.create({
    model: modelName,
    max_output_tokens: options?.maxOutputTokens,
    reasoning: options?.reasoningEffort ? { effort: options.reasoningEffort } : undefined,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: systemPrompt }],
      },
      {
        role: "user",
        content: userContent,
      },
    ],
  });

  const parsed = safeParseJson<T>(response.output_text ?? "");
  return parsed ?? fallback;
}

export async function generateText(
  systemPrompt: string,
  userPrompt: string,
  options?: {
    imageDataUrls?: string[];
    maxOutputTokens?: number;
    reasoningEffort?: "low" | "medium" | "high";
  },
): Promise<string> {
  const client = getClient();
  const imageDataUrls = options?.imageDataUrls ?? [];

  const userContent: Array<
    { type: "input_text"; text: string } | { type: "input_image"; image_url: string; detail: "auto" | "low" | "high" }
  > = [
    { type: "input_text", text: userPrompt },
  ];

  for (const imageUrl of imageDataUrls) {
    userContent.push({ type: "input_image", image_url: imageUrl, detail: "auto" });
  }

  const response = await client.responses.create({
    model: modelName,
    max_output_tokens: options?.maxOutputTokens,
    reasoning: options?.reasoningEffort ? { effort: options.reasoningEffort } : undefined,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: systemPrompt }],
      },
      {
        role: "user",
        content: userContent,
      },
    ],
  });

  return (response.output_text ?? "").trim();
}
