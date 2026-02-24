export type HistoryType = "study-guide" | "tutor" | "quiz" | "flashcards";

export type HistoryItem = {
  id: string;
  type: HistoryType;
  title: string;
  summary: string;
  createdAt: string;
  path: string;
};

const HISTORY_STORAGE_KEY = "boringcourse-history-v1";
const HISTORY_EVENT_NAME = "boringcourse-history-updated";

export function readHistory(): HistoryItem[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as HistoryItem[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed;
  } catch {
    return [];
  }
}

export function appendHistory(
  item: Omit<HistoryItem, "id" | "createdAt">,
): HistoryItem[] {
  if (typeof window === "undefined") {
    return [];
  }

  const nextItem: HistoryItem = {
    ...item,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    createdAt: new Date().toISOString(),
  };

  const current = readHistory();
  const next = [nextItem, ...current].slice(0, 100);
  window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(HISTORY_EVENT_NAME));
  return next;
}

export function clearHistory(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify([]));
  window.dispatchEvent(new Event(HISTORY_EVENT_NAME));
}

export { HISTORY_EVENT_NAME };
