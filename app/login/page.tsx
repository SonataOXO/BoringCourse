"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [nextPath, setNextPath] = useState("/");

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const nextValue = query.get("next");
    if (nextValue && nextValue.startsWith("/")) {
      setNextPath(nextValue);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const me = await fetch("/api/auth/me");
      if (me.ok) {
        router.replace(nextPath);
      }
    })();
  }, [router, nextPath]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, rememberMe }),
      });

      const raw = await response.text();
      let parsed: { error?: string } = {};
      try {
        parsed = JSON.parse(raw) as { error?: string };
      } catch {
        parsed = {};
      }

      if (!response.ok) {
        const htmlResponse = raw.trim().startsWith("<!DOCTYPE") || raw.trim().startsWith("<html");
        if (htmlResponse) {
          throw new Error(
            "Login endpoint returned HTML instead of JSON. Check server errors and ensure AUTH_ENCRYPTION_KEY is set in .env.local.",
          );
        }

        throw new Error(parsed.error ?? `Login failed (${response.status})`);
      }

      router.push(nextPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  const submitDisabled = loading || !email || password.length < 6;

  return (
    <main className="grainy-bg flex min-h-screen items-center justify-center px-4 py-12">
      <Card className="w-full max-w-lg">
        <CardTitle className="text-2xl">Login to BoringCourse</CardTitle>
        <CardDescription className="mt-1">Welcome back. Use your email and password to continue.</CardDescription>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            className="h-11 w-full rounded-2xl border bg-background px-4 text-sm outline-none focus:ring-2 focus:ring-ring"
            required
          />
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password (min 6 chars)"
              className="h-11 w-full rounded-2xl border bg-background px-4 pr-12 text-sm outline-none focus:ring-2 focus:ring-ring"
              minLength={6}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(event) => setRememberMe(event.target.checked)}
            />
            Remember me
          </label>

          {error ? <p className="text-sm font-semibold text-red-600">{error}</p> : null}

          <Button type="submit" className="w-full" disabled={submitDisabled}>
            {loading ? "Logging in..." : "Login"}
          </Button>
        </form>

        <p className="mt-4 text-xs text-muted-foreground">
          New here? <Link className="underline" href="/signup">Create an account</Link>.
        </p>
      </Card>
    </main>
  );
}
