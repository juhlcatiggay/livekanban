"use client";

import { useLayoutEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_IMPORT_BYTES } from "@livekanban/protocol";
import { workerUrl } from "@/lib/config";
import { useTurnstile } from "@/lib/turnstile";

interface CreateBoardButtonProps {
  label?: string;
  /** Also offer "Import from a JSON export". */
  allowImport?: boolean;
}

export function CreateBoardButton({ label = "Create board", allowImport = false }: CreateBoardButtonProps) {
  const router = useRouter();
  const turnstile = useTurnstile();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Next keeps this page alive (hidden) after we navigate to the new board, so
  // coming back would show "Creating…" forever. Reset when the page is hidden.
  useLayoutEffect(
    () => () => {
      setPending(false);
      setError(null);
    },
    [],
  );

  async function create(importData?: unknown) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(workerUrl("/api/boards"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnstileToken: turnstile.token ?? undefined, import: importData }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !body.id) throw new Error(body.error ?? `HTTP ${res.status}`);
      router.push(`/b/${body.id}`);
    } catch (err) {
      const message = err instanceof Error && !err.message.startsWith("HTTP") && err.message !== "Failed to fetch" ? err.message : null;
      setError(message ?? "Couldn't create a board. Check your connection and try again.");
      setPending(false);
      turnstile.reset();
    }
  }

  async function importFile(file: File) {
    if (file.size > MAX_IMPORT_BYTES) return setError("That file is too large to import.");
    try {
      await create(JSON.parse(await file.text()));
    } catch {
      setError("That file isn't valid JSON.");
    }
  }

  const disabled = pending || !turnstile.ready;

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={() => create()}
        disabled={disabled}
        className="rounded-lg bg-teal-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-teal-700 disabled:opacity-60"
      >
        {pending ? "Creating…" : turnstile.ready ? label : "Verifying you're human…"}
      </button>
      {allowImport && (
        <label className={`text-sm text-stone-500 ${disabled ? "opacity-60" : "cursor-pointer hover:text-stone-800 hover:underline dark:hover:text-stone-200"}`}>
          or import a JSON export
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            disabled={disabled}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void importFile(file);
            }}
          />
        </label>
      )}
      {turnstile.widget}
      {turnstile.problem && (
        <p role="alert" className="max-w-sm text-center text-sm text-red-600 dark:text-red-400">
          {turnstile.problem}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
