"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import { parseRecent, readRecentRaw, subscribeRecent } from "@/lib/recent-boards";

const EMPTY = "[]";

export function RecentBoards() {
  const raw = useSyncExternalStore(subscribeRecent, readRecentRaw, () => EMPTY);
  const boards = useMemo(() => parseRecent(raw), [raw]);

  if (boards.length === 0) return null;

  return (
    <section className="w-full max-w-md">
      <h2 className="mb-2 text-sm font-medium text-stone-500">Your recent boards</h2>
      <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
        {boards.map((b) => (
          <li key={b.id}>
            <Link
              href={`/b/${b.id}`}
              className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-stone-100 dark:hover:bg-stone-900"
            >
              <span className="font-mono">{b.id.slice(0, 8)}…</span>
              <span className="text-stone-500">{new Date(b.visitedAt).toLocaleDateString()}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-stone-500">Stored in this browser only.</p>
    </section>
  );
}
