"use client";

import { useEffect } from "react";

import { applyThemeToDocument, readThemePreference } from "@/lib/client/theme-preferences";

export function ThemeProvider() {
  useEffect(() => {
    applyThemeToDocument(readThemePreference());

    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === "boringcourse-theme-v1") {
        applyThemeToDocument(readThemePreference());
      }
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return null;
}

