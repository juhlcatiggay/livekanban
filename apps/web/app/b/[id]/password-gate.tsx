"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PASSWORD } from "@livekanban/protocol";
import { useBoard } from "@/lib/board-store";

/** Shown instead of the board when it has a password this browser doesn't know yet. */
export function PasswordGate() {
  const prompt = useBoard((s) => s.passwordPrompt);
  const submitPassword = useBoard((s) => s.submitPassword);
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const waitMs = prompt?.retryAt ? Math.max(0, prompt.retryAt - now) : 0;

  // Count down while guessing is paused.
  useEffect(() => {
    if (!prompt?.retryAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [prompt?.retryAt]);

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (password.length >= PASSWORD.min && !waitMs) submitPassword(password);
        }}
        className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900"
      >
        <div>
          <p aria-hidden className="text-3xl">🔒</p>
          <h1 className="mt-2 text-xl font-semibold">This board has a password</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Ask the person who shared the link for it. This browser remembers it once it works.</p>
        </div>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Password
          <span className="flex gap-2">
            <input
              autoFocus
              type={shown ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              maxLength={PASSWORD.max}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={prompt?.wrong || undefined}
              className="field min-w-0 flex-1 rounded-md px-3 py-2 font-normal"
            />
            <button type="button" onClick={() => setShown((s) => !s)} className="rounded-full bg-black/5 px-3 text-xs font-medium hover:bg-black/10 dark:bg-white/10">
              {shown ? "Hide" : "Show"}
            </button>
          </span>
        </label>
        {prompt?.wrong && !waitMs && (
          <p role="alert" className="-mt-2 text-sm text-red-600 dark:text-red-400">
            That password isn&apos;t right.
          </p>
        )}
        {waitMs > 0 && (
          <p role="alert" className="-mt-2 text-sm text-amber-700 dark:text-amber-400">
            Too many wrong passwords. Try again in {Math.ceil(waitMs / 1000)} s.
          </p>
        )}
        <button
          type="submit"
          disabled={password.length < PASSWORD.min || waitMs > 0}
          className="rounded-full bg-accent-600 px-4 py-2 font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
        >
          Open board
        </button>
        <Link href="/" className="text-center text-sm text-gray-500 hover:underline">
          Back to LiveKanban
        </Link>
      </form>
    </main>
  );
}
