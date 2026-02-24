"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, History as HistoryIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { HISTORY_EVENT_NAME, clearHistory, readHistory, type HistoryItem } from "@/lib/client/history";

export default function HistoryPage() {
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>(() => readHistory());

  useEffect(() => {
    const handler = () => setHistoryItems(readHistory());
    window.addEventListener("storage", handler);
    window.addEventListener(HISTORY_EVENT_NAME, handler);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener(HISTORY_EVENT_NAME, handler);
    };
  }, []);

  return (
    <main className="grainy-bg min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-4xl space-y-5">
        <Button asChild variant="ghost" size="sm">
          <Link href="/">
            <ArrowLeft className="size-4" /> Back to Dashboard
          </Link>
        </Button>

        <Card>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <HistoryIcon className="size-5" /> History
            </CardTitle>
            <Button type="button" variant="secondary" size="sm" onClick={clearHistory} disabled={historyItems.length === 0}>
              Clear History
            </Button>
          </div>
          <CardDescription>All generated activity from Study Guide, Tutor, Quizzes, and Flashcards.</CardDescription>

          <div className="mt-4 space-y-2">
            {historyItems.length > 0 ? (
              historyItems.map((item) => (
                <Link
                  key={item.id}
                  href={`${item.path}${item.path.includes("?") ? "&" : "?"}historyId=${encodeURIComponent(item.id)}`}
                  className="block rounded-xl border bg-background/70 p-3 hover:bg-muted"
                >
                  <p className="text-sm font-semibold">{item.title}</p>
                  <p className="text-sm text-muted-foreground">{item.summary}</p>
                  <p className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</p>
                </Link>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No history yet.</p>
            )}
          </div>
        </Card>
      </div>
    </main>
  );
}
