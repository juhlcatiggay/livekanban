"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { connectBoard, useBoard, type ConnectionStatus } from "@/lib/board-store";
import { claimHostFromUrl, getHostKey } from "@/lib/host";
import { getIdentity } from "@/lib/identity";
import { copyText } from "@/lib/clipboard";
import { useCan } from "@/lib/use-can";
import { useActivity, useCursorSender } from "@/lib/use-presence";
import { CreateBoardButton } from "../../create-board-button";
import { ThemeToggle } from "../../theme-toggle";
import { BoardActions } from "./board-actions";
import { ConfirmDialog } from "./confirm-dialog";
import { HistoryButton } from "./history";
import { FilterBar } from "./kanban/filter-bar";
import { InlineEdit } from "./kanban/inline-edit";
import { PasswordGate } from "./password-gate";
import { BulletinBoard } from "./bulletin/bulletin-board";
import { CalendarView } from "./calendar/calendar-view";
import { PinnedBanner } from "./bulletin/pinned-banner";
import { KanbanBoard } from "./kanban/kanban-board";
import { CursorLayer } from "./presence/cursor-layer";
import { HostMenu, ViewOnlyNotice } from "./presence/host-menu";
import { PresenceBar } from "./presence/presence-bar";
import { UndoToast } from "./undo-toast";
import { setView, useView, type View } from "./view";

export function Board({ boardId }: { boardId: string }) {
  const status = useBoard((s) => s.status);
  const board = useBoard((s) => s.board);
  const dispatch = useBoard((s) => s.dispatch);
  const view = useView();
  const can = useCan();

  useEffect(() => {
    const hostKey = claimHostFromUrl(boardId) ?? getHostKey(boardId);
    return connectBoard(boardId, getIdentity(), hostKey);
  }, [boardId]);
  useCursorSender();
  useActivity();
  useUndoShortcuts();

  if (status === "expired") return <ExpiredBoard />;
  if (status === "deleted") return <DeletedBoard />;
  if (status === "password") return <PasswordGate />;
  if (status === "full") {
    return <Notice title="This board is full" body="Too many people are on this board right now. Try again soon." />;
  }

  return (
    <div className="flex h-dvh flex-col bg-gray-100 dark:bg-black">
      {/* One toolbar, like a Mac app: where you are on the left, the views in the middle, actions on the right. */}
      {/* Wide screens: one row (name · views · actions). Narrow: name and actions, then the views on their own row. */}
      <header className="material material-edge relative z-30 flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2 lg:grid lg:grid-cols-[1fr_auto_1fr]">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <Link href="/" aria-label="LiveKanban home" title="All boards" className="press shrink-0 rounded-md px-1.5 py-1 text-[15px] font-semibold hover:bg-black/5 dark:hover:bg-white/10">
            ‹ LiveKanban
          </Link>
          <span className="text-gray-300 dark:text-gray-700">/</span>
          {board && (
            <InlineEdit
              value={board.title}
              label="board title"
              className="text-[15px] font-semibold"
              onCommit={(title) => dispatch({ kind: "board.update", title })}
              disabled={!can.renameBoard}
            />
          )}
        </div>
        <div className="order-last flex w-full justify-center lg:order-none lg:w-auto">
          <Tabs view={view} noteCount={board ? Object.keys(board.notes).length : 0} />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {board && <HistoryButton />}
          {board && <BoardActions board={board} />}
          <HostMenu boardId={boardId} />
          <PresenceBar />
          <CopyLinkButton />
        </div>
      </header>
      <ViewOnlyNotice />
      <main className="flex min-h-0 flex-1 flex-col">
        {!board ? (
          <p className="m-auto text-gray-500">Loading board…</p>
        ) : view === "bulletin" ? (
          <BulletinBoard board={board} />
        ) : view === "calendar" ? (
          <>
            <FilterBar board={board} />
            <CalendarView board={board} />
          </>
        ) : (
          <>
            <PinnedBanner board={board} />
            <FilterBar board={board} />
            <KanbanBoard board={board} />
          </>
        )}
      </main>
      <CursorLayer />
      <UndoToast />
      <ConfirmDialog />
      <ErrorToast />
      <footer className="hairline flex items-center justify-between border-t px-4 py-1.5 text-xs text-gray-500">
        <KeptUntil />
        <span className="flex items-center gap-4">
          <ReportLink boardId={boardId} />
          <ThemeToggle />
          <ConnectionInfo status={status} />
        </span>
      </footer>
    </div>
  );
}

/** Ctrl/Cmd+Z undoes your last change, Ctrl/Cmd+Shift+Z or Ctrl+Y redoes; text fields keep their own undo. */
function useUndoShortcuts() {
  const undo = useBoard((s) => s.undo);
  const redo = useBoard((s) => s.redo);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable=true]")) return;
      const key = e.key.toLowerCase();
      if (key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (key === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);
}

/** Anonymous boards will eventually host content that must be taken down; this is the way to ask. */
function ReportLink({ boardId }: { boardId: string }) {
  const email = process.env.NEXT_PUBLIC_ABUSE_EMAIL;
  if (!email) return null;
  const subject = encodeURIComponent(`Report board ${boardId}`);
  const body = encodeURIComponent(`Board ID: ${boardId}\n\nWhat's wrong:\n`);
  return (
    <a href={`mailto:${email}?subject=${subject}&body=${body}`} className="hover:text-gray-800 hover:underline dark:hover:text-gray-200">
      Report this board
    </a>
  );
}

function Tabs({ view, noteCount }: { view: View; noteCount: number }) {
  const tab = (v: View, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={view === v}
      onClick={() => setView(v)}
      className={`rounded-[7px] px-4 py-1 text-[13px] font-medium ${view === v ? "" : "text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"}`}
    >
      {label}
    </button>
  );
  return (
    <nav role="tablist" aria-label="Board views" className="segmented">
      {tab("kanban", "Kanban")}
      {tab("bulletin", noteCount ? `Bulletin (${noteCount})` : "Bulletin")}
      {tab("calendar", "Calendar")}
    </nav>
  );
}

function ErrorToast() {
  const error = useBoard((s) => s.error);
  const clearError = useBoard((s) => s.clearError);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, 5000);
    return () => clearTimeout(t);
  }, [error, clearError]);

  if (!error) return null;
  return (
    <div role="alert" className="fixed left-1/2 top-16 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full bg-gray-900/90 py-2 pl-4 pr-2 text-[13px] text-white shadow-lg backdrop-blur dark:bg-gray-100/90 dark:text-gray-900">
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
      <span>{error}</span>
      <button type="button" onClick={clearError} aria-label="Dismiss" className="flex h-6 w-6 items-center justify-center rounded-full text-base leading-none hover:bg-white/15 dark:hover:bg-black/10">
        ×
      </button>
    </div>
  );
}

function CopyLinkButton() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        if (!(await copyText(window.location.href))) return;
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="rounded-full bg-accent-600 px-3.5 py-1 text-[13px] font-medium text-white hover:bg-accent-700"
    >
      {copied ? "Link copied" : "Copy link"}
    </button>
  );
}

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

function KeptUntil() {
  const keptUntil = useBoard((s) => s.keptUntil);
  if (!keptUntil) return <span />;
  return <span>Kept until {dateFormat.format(keptUntil)}</span>;
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: "Connecting…",
  open: "Live",
  reconnecting: "Reconnecting…",
  expired: "Expired",
  deleted: "Deleted",
  password: "Password needed",
  full: "Board full",
};

function ConnectionInfo({ status }: { status: ConnectionStatus }) {
  const rtt = useBoard((s) => s.rtt);
  return (
    <span className="flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${status === "open" ? "bg-emerald-500" : "bg-amber-500"}`} />
      {STATUS_LABEL[status]}
      {status === "open" && rtt !== null && <span className="font-mono">· {rtt} ms</span>}
    </span>
  );
}

function ExpiredBoard() {
  return (
    <Notice title="This board expired" body="Boards are deleted after 60 days without a visit or edit, or when their host deletes them.">
      <CreateBoardButton label="Create a new board" />
    </Notice>
  );
}

function DeletedBoard() {
  const by = useBoard((s) => s.deletedBy);
  return (
    <Notice title="This board was deleted" body={`${by ? `${by}, the host,` : "The host"} deleted this board and everything on it.`}>
      <CreateBoardButton label="Create a new board" />
    </Notice>
  );
}

function Notice({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 text-center">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">{body}</p>
      </div>
      {children}
    </main>
  );
}
