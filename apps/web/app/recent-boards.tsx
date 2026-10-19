"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { workerUrl } from "@/lib/config";
import { ago } from "@/lib/describe";
import { getHostKey } from "@/lib/host";
import { forgetBoard, parseRecent, readRecentRaw, subscribeRecent, type RecentBoard } from "@/lib/recent-boards";
import { CreateBoardButton } from "./create-board-button";
import { Icon } from "./icons";

const EMPTY = "[]";
const keptFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** A board's live status, from the Worker's public status endpoint. */
type Status = { status: "active"; keptUntil: number; locked?: boolean } | { status: "expired" } | { status: "unknown" };

/** Accent colors for board cards, picked from the id so a board always looks the same. */
const ACCENTS = ["bg-[#0071e3]", "bg-[#ff9500]", "bg-[#ff2d55]", "bg-[#5856d6]", "bg-[#34c759]", "bg-[#af52de]", "bg-[#30b0c7]", "bg-[#ff3b30]"];
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
    <section id="my-boards" aria-labelledby="my-boards-heading" className="mx-auto w-full max-w-[980px] scroll-mt-12 px-4 py-20">
      <h2 id="my-boards-heading" className="text-4xl font-semibold sm:text-5xl">
        My boards.
      </h2>
      <p className="mt-3 text-[17px] text-gray-600 dark:text-gray-400">Every board you&apos;ve opened in this browser. No account needed.</p>
      {boards.length === 0 ? (
        <div className="mt-10 flex flex-col items-center gap-5 rounded-[18px] bg-white px-6 py-14 text-center dark:bg-gray-900">
          <span className="text-gray-400">
            <Icon name="columns" className="h-10 w-10" />
          </span>
          <p className="text-[17px] text-gray-600 dark:text-gray-400">No boards yet. Create one, or open a link someone shared with you.</p>
          <CreateBoardButton />
        </div>
      ) : (
        <>
          <BoardGroup title="My own boards" hint="You're the host." boards={own} statuses={statuses} host empty="Boards you create appear here." />
          <BoardGroup title="Others' boards" hint="Shared with you by link." boards={shared} statuses={statuses} empty="Boards people share with you appear here once you open them." />
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
    <div className="mt-12">
      <h3 className="text-[21px] font-semibold">{title}</h3>
      <p className="mt-1 text-[15px] text-gray-500">{boards.length ? hint : empty}</p>
      {boards.length > 0 && (
        <ul className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label={title}>
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
        className={`press flex h-full items-start gap-4 rounded-[18px] bg-white p-5 shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-shadow hover:shadow-[0_10px_30px_-10px_rgb(0_0_0/0.2)] dark:bg-gray-900 ${
          expired ? "opacity-55" : ""
        }`}
      >
        <span aria-hidden className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white ${accent(board.id)}`}>
          <Icon name="columns" className="h-6 w-6" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[17px] font-semibold">{title}</span>
            {status?.status === "active" && status.locked && (
              <span title="Has a password" aria-label="Has a password" className="shrink-0 text-gray-400">
                <Icon name="lock" className="h-4 w-4" />
              </span>
            )}
          </span>
          <span className="text-[13px] text-gray-500">
            {host ? "Host · " : ""}Opened {ago(board.visitedAt)}
          </span>
          <span className={`text-[13px] ${expired ? "text-red-600 dark:text-red-400" : "text-gray-500"}`}>
            {status?.status === "active" ? `Kept until ${keptFormat.format(status.keptUntil)}` : expired ? "Expired" : " "}
          </span>
        </span>
      </Link>
      <button
        type="button"
        onClick={() => forgetBoard(board.id)}
        aria-label={`Remove ${title} from this list`}
        title="Remove from this list (doesn't delete the board)"
        className="absolute right-3 top-3 hidden h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-sm leading-none text-gray-600 hover:bg-gray-300 group-focus-within:flex group-hover:flex dark:bg-gray-700 dark:text-gray-200"
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
