const ICON_COLOR_KEY = "boringcourse-icon-color-v1";
const DEFAULT_ICON_COLOR = "#e56b2f";

export function readIconColorPreference(): string {
  if (typeof window === "undefined") {
    return DEFAULT_ICON_COLOR;
  }
  const raw = window.localStorage.getItem(ICON_COLOR_KEY)?.trim();
  if (!raw) {
    return DEFAULT_ICON_COLOR;
  }
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : DEFAULT_ICON_COLOR;
}

export function writeIconColorPreference(color: string): string {
  const normalized = /^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_ICON_COLOR;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(ICON_COLOR_KEY, normalized);
  }
  return normalized;
}

export function clearIconColorPreference(): void {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(ICON_COLOR_KEY);
  }
}

export function applyIconColorToDocument(color: string): void {
  if (typeof document === "undefined") {
    return;
  }
  const normalized = /^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_ICON_COLOR;
  document.documentElement.style.setProperty("--icon-accent", normalized);
  document.documentElement.style.setProperty("--accent", normalized);
  document.documentElement.style.setProperty("--ring", normalized);
}

export { DEFAULT_ICON_COLOR };
