"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Eye, EyeOff, Settings as SettingsIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { readCanvasAuthSettings, writeCanvasAuthSettings } from "@/lib/client/canvas-auth";
import {
  DEFAULT_ICON_COLOR,
  applyIconColorToDocument,
  clearIconColorPreference,
  readIconColorPreference,
  writeIconColorPreference,
} from "@/lib/client/ui-preferences";

export default function SettingsPage() {
  const [baseUrl, setBaseUrl] = useState(() => readCanvasAuthSettings().baseUrl);
  const [token, setToken] = useState(() => readCanvasAuthSettings().token);
  const [iconColor, setIconColor] = useState(() => readIconColorPreference());
  const [showToken, setShowToken] = useState(false);
  const [message, setMessage] = useState("");

  function saveSettings() {
    writeCanvasAuthSettings({ baseUrl, token });
    const normalized = writeIconColorPreference(iconColor);
    setIconColor(normalized);
    applyIconColorToDocument(normalized);
    setMessage("Saved Canvas settings and icon color for this user/browser.");
  }

  function resetIconColor() {
    clearIconColorPreference();
    setIconColor(DEFAULT_ICON_COLOR);
    applyIconColorToDocument(DEFAULT_ICON_COLOR);
    setMessage("Reset icon color to default.");
  }

  return (
    <main className="grainy-bg min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-3xl space-y-5">
        <Button asChild variant="ghost" size="sm">
          <Link href="/">
            <ArrowLeft className="size-4" /> Back to Dashboard
          </Link>
        </Button>

        <Card>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Settings</CardTitle>
              <CardDescription>Add your own Canvas school URL, API token, and icon color for hosted use.</CardDescription>
            </div>
            <SettingsIcon className="size-5 text-icon-accent" />
          </div>

          <div className="mt-4 space-y-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground" htmlFor="canvas-base-url">
                Canvas School URL
              </label>
              <input
                id="canvas-base-url"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://school.instructure.com"
                className="mt-1 h-10 w-full rounded-xl border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground" htmlFor="canvas-api-token">
                Canvas API Token
              </label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  id="canvas-api-token"
                  type={showToken ? "text" : "password"}
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="Paste Canvas API token"
                  className="h-10 flex-1 rounded-xl border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <Button type="button" variant="secondary" onClick={() => setShowToken((prev) => !prev)}>
                  {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </Button>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground" htmlFor="icon-color">
                Icon Color
              </label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  id="icon-color"
                  type="color"
                  value={iconColor}
                  onChange={(event) => {
                    const value = event.target.value;
                    setIconColor(value);
                    applyIconColorToDocument(value);
                  }}
                  className="h-10 w-16 rounded-xl border bg-background p-1"
                />
                <input
                  value={iconColor}
                  onChange={(event) => {
                    const value = event.target.value;
                    setIconColor(value);
                    applyIconColorToDocument(value);
                  }}
                  placeholder="#e56b2f"
                  className="h-10 flex-1 rounded-xl border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <Button type="button" variant="secondary" onClick={resetIconColor}>
                  Reset
                </Button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Applies to dashboard accent icons.</p>
            </div>

            <Button onClick={saveSettings}>Save Canvas Settings</Button>
            {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
          </div>
        </Card>
      </div>
    </main>
  );
}
