"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { workerUrl } from "@/lib/config";
import { ago } from "@/lib/describe";
import { getHostKey } from "@/lib/host";
import { forgetBoard, parseRecent, readRecentRaw, subscribeRecent, type RecentBoard } from "@/lib/recent-boards";
import { CreateBoardButton } from "./create-board-button";

const EMPTY = "[]";
const keptFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** A board's live status, from the Worker's public status endpoint. */
type Status = { status: "active"; keptUntil: number; locked?: boolean } | { status: "expired" } | { status: "unknown" };

/** Accent colors for board cards, picked from the id so a board always looks the same. */
const ACCENTS = ["bg-teal-500", "bg-amber-500", "bg-rose-500", "bg-indigo-500", "bg-lime-600", "bg-purple-500", "bg-sky-500", "bg-orange-600"];
const accent = (id: string) => ACCENTS[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0) % ACCENTS.length];

/**
 * "My boards": every board this browser has opened, as cards. Boards you
 * created (you hold the host key) are "My own boards"; boards others shared
 * with you are "Others' boards". Kept in this browser only.
 */
export function MyBoards() {
  const raw = useSyncExternalStore(subscribeRecent, readRecentRaw, () => EMPTY);
  const boards = useMemo(() => parseRecent(raw), [raw]);
  // Host keys live in localStorage too, so this only runs in the browser (the list is empty on the server).
  const own = boards.filter((b) => getHostKey(b.id));
  const shared = boards.filter((b) => !getHostKey(b.id));
  const statuses = useStatuses(boards.map((b) => b.id));

  return (
    <section id="my-boards" aria-labelledby="my-boards-heading" className="mx-auto w-full max-w-5xl scroll-mt-20 px-4 py-14">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="my-boards-heading" className="text-2xl font-bold tracking-tight">
            My boards
          </h2>
          <p className="mt-1 text-sm text-stone-500">Boards you&apos;ve opened in this browser. Nothing is stored on a server account.</p>
        </div>
      </div>
      {boards.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-stone-300 px-6 py-12 text-center dark:border-stone-700">
          <p className="text-stone-600 dark:text-stone-400">No boards yet. Create one, or open a link someone shared with you.</p>
          <CreateBoardButton />
        </div>
      ) : (
        <>
          <BoardGroup title="My own boards" hint="You're the host." boards={own} statuses={statuses} host empty="Boards you create show up here." />
          <BoardGroup title="Others' boards" hint="Shared with you by link." boards={shared} statuses={statuses} empty="Boards people share with you show up here once you open them." />
        </>
      )}
    </section>
  );
}

function BoardGroup({
  title,
  hint,
  boards,
  statuses,
  host = false,
  empty,
}: {
  title: string;
  hint: string;
  boards: RecentBoard[];
  statuses: Record<string, Status>;
  host?: boolean;
  empty: string;
}) {
  return (
    <div className="mt-8">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
        {title} <span className="font-normal normal-case tracking-normal">· {boards.length ? hint : empty}</span>
      </h3>
      {boards.length > 0 && (
        <ul className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label={title}>
          {boards.map((b) => (
            <BoardCard key={b.id} board={b} status={statuses[b.id]} host={host} />
          ))}
        </ul>
      )}
    </div>
  );
}

function BoardCard({ board, status, host }: { board: RecentBoard; status?: Status; host: boolean }) {
  const expired = status?.status === "expired";
  const title = board.title ?? "Untitled board";
  return (
    <li className="group relative">
      <Link
        href={`/b/${board.id}`}
        aria-label={`${title}${expired ? " (expired)" : ""}`}
        className={`flex h-full flex-col overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-stone-800 dark:bg-stone-900 ${
          expired ? "opacity-60" : ""
        }`}
      >
        <span className={`h-2 ${accent(board.id)}`} />
        <span className="flex flex-1 flex-col gap-2 p-4">
          <span className="flex items-start justify-between gap-2">
            <span className="line-clamp-2 font-semibold">{title}</span>
            <span className="flex shrink-0 gap-1">
              {status?.status === "active" && status.locked && (
                <span title="Has a password" aria-label="Has a password" className="text-sm">
                  🔒
                </span>
              )}
              {host && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-900 dark:bg-amber-900/60 dark:text-amber-100">Host</span>}
            </span>
          </span>
          <span className="mt-auto text-xs text-stone-500">Opened {ago(board.visitedAt)}</span>
          <span className="text-xs text-stone-500">
            {status?.status === "active" ? `Kept until ${keptFormat.format(status.keptUntil)}` : expired ? "Expired" : " "}
          </span>
        </span>
      </Link>
      <button
        type="button"
        onClick={() => forgetBoard(board.id)}
        aria-label={`Remove ${title} from this list`}
        title="Remove from this list (doesn't delete the board)"
        className="absolute right-2 top-4 hidden rounded-full bg-white/90 px-2 text-stone-500 shadow hover:text-stone-900 group-focus-within:block group-hover:block dark:bg-stone-800/90"
      >
        ×
      </button>
    </li>
  );
}

/** Asks the Worker whether each board is still there (and until when). */
function useStatuses(ids: string[]): Record<string, Status> {
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const key = ids.join(",");
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    for (const id of key.split(",")) {
      fetch(workerUrl(`/parties/board-room/${id}`), { signal: controller.signal })
        .then((r) => (r.ok ? (r.json() as Promise<Status>) : { status: "unknown" as const }))
        .catch(() => ({ status: "unknown" as const }))
        .then((s) => !controller.signal.aborted && setStatuses((prev) => ({ ...prev, [id]: s })));
    }
    return () => controller.abort();
  }, [key]);
  return statuses;
}
