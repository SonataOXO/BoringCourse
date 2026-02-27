"use client";

import { useEffect } from "react";

import { applyIconColorToDocument, readIconColorPreference } from "@/lib/client/ui-preferences";

export function IconColorProvider() {
  useEffect(() => {
    applyIconColorToDocument(readIconColorPreference());

    const handleStorage = (event: StorageEvent) => {
      if (!event.key || event.key === "boringcourse-icon-color-v1") {
        applyIconColorToDocument(readIconColorPreference());
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  return null;
}

