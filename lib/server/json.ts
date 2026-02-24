export function safeParseJson<T>(input: string): T | null {
  const trimmed = input.trim();

  const direct = tryParse<T>(trimmed);
  if (direct) {
    return direct;
  }

  const withoutFence = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  const second = tryParse<T>(withoutFence);
  if (second) {
    return second;
  }

  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && firstBrace < lastBrace) {
    return tryParse<T>(withoutFence.slice(firstBrace, lastBrace + 1));
  }

  const firstBracket = withoutFence.indexOf("[");
  const lastBracket = withoutFence.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket !== -1 && firstBracket < lastBracket) {
    return tryParse<T>(withoutFence.slice(firstBracket, lastBracket + 1));
  }

  return null;
}

function tryParse<T>(input: string): T | null {
  try {
    return JSON.parse(input) as T;
  } catch {
    return null;
  }
}
