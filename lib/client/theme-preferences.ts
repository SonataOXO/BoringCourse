const THEME_KEY = "boringcourse-theme-v1";

export type ThemePreference = "light" | "dark";

const DEFAULT_THEME: ThemePreference = "light";

export function readThemePreference(): ThemePreference {
  if (typeof window === "undefined") {
    return DEFAULT_THEME;
  }
  const raw = window.localStorage.getItem(THEME_KEY);
  return raw === "dark" ? "dark" : "light";
}

export function writeThemePreference(theme: ThemePreference): ThemePreference {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(THEME_KEY, theme);
  }
  return theme;
}

export function applyThemeToDocument(theme: ThemePreference): void {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.setAttribute("data-theme", theme);
}

