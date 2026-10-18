"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { workerUrl } from "@/lib/config";

export function CreateBoardButton({ label = "Create board" }: { label?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(workerUrl("/api/boards"), { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { id } = (await res.json()) as { id: string };
      router.push(`/b/${id}`);
    } catch {
      setError("Couldn't create a board. Check your connection and try again.");
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={create}
        disabled={pending}
        className="rounded-lg bg-teal-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-teal-700 disabled:opacity-60"
      >
        {pending ? "Creating…" : label}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
