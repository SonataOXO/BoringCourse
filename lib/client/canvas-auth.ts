"use client";

export type CanvasAuthSettings = {
  baseUrl: string;
  token: string;
};

const CANVAS_AUTH_STORAGE_KEY = "boringcourse-canvas-auth-v1";

export function readCanvasAuthSettings(): CanvasAuthSettings {
  if (typeof window === "undefined") {
    return { baseUrl: "", token: "" };
  }

  try {
    const raw = window.localStorage.getItem(CANVAS_AUTH_STORAGE_KEY);
    if (!raw) {
      return { baseUrl: "", token: "" };
    }

    const parsed = JSON.parse(raw) as Partial<CanvasAuthSettings>;
    return {
      baseUrl: String(parsed.baseUrl ?? "").trim(),
      token: String(parsed.token ?? "").trim(),
    };
  } catch {
    return { baseUrl: "", token: "" };
  }
}

export function writeCanvasAuthSettings(settings: CanvasAuthSettings): void {
  if (typeof window === "undefined") {
    return;
  }

  const normalized: CanvasAuthSettings = {
    baseUrl: settings.baseUrl.trim().replace(/\/+$/, ""),
    token: settings.token.trim(),
  };

  window.localStorage.setItem(CANVAS_AUTH_STORAGE_KEY, JSON.stringify(normalized));
}

export function getCanvasAuthHeaders(): HeadersInit {
  const settings = readCanvasAuthSettings();
  const headers: Record<string, string> = {};

  if (settings.baseUrl) {
    headers["x-canvas-base-url"] = settings.baseUrl;
  }

  if (settings.token) {
    headers["x-canvas-token"] = settings.token;
  }

  return headers;
}
