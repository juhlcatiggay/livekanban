"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { connectBoard, useBoard, type ConnectionStatus } from "@/lib/board-store";
import { getIdentity } from "@/lib/identity";
import { useActivity, useCursorSender } from "@/lib/use-presence";
import { CreateBoardButton } from "../../create-board-button";
import { BoardActions } from "./board-actions";
import { InlineEdit } from "./kanban/inline-edit";
import { BulletinBoard } from "./bulletin/bulletin-board";
import { CalendarView } from "./calendar/calendar-view";
import { PinnedBanner } from "./bulletin/pinned-banner";
import { KanbanBoard } from "./kanban/kanban-board";
import { CursorLayer } from "./presence/cursor-layer";
import { PresenceBar } from "./presence/presence-bar";
import { UndoToast } from "./undo-toast";
import { setView, useView, type View } from "./view";

export function Board({ boardId }: { boardId: string }) {
  const status = useBoard((s) => s.status);
  const board = useBoard((s) => s.board);
  const dispatch = useBoard((s) => s.dispatch);
  const view = useView();

  useEffect(() => connectBoard(boardId, getIdentity()), [boardId]);
  useCursorSender();
  useActivity();
  useUndoShortcuts();

  if (status === "expired") return <ExpiredBoard />;
  if (status === "full") {
    return <Notice title="This board is full" body="Too many people are on this board right now. Try again soon." />;
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-stone-200 px-4 py-3 dark:border-stone-800">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="shrink-0 font-semibold">
            LiveKanban
          </Link>
          <span className="text-stone-300 dark:text-stone-700">/</span>
          {board && (
            <InlineEdit
              value={board.title}
              label="board title"
              className="text-base font-medium"
              onCommit={(title) => dispatch({ kind: "board.update", title })}
            />
          )}
        </div>
        <div className="flex items-center gap-4">
          {board && <BoardActions board={board} />}
          <PresenceBar />
          <CopyLinkButton />
        </div>
      </header>
      <Tabs view={view} noteCount={board ? Object.keys(board.notes).length : 0} />
      <main className="flex min-h-0 flex-1 flex-col">
        {!board ? (
          <p className="m-auto text-stone-500">Loading board…</p>
        ) : view === "bulletin" ? (
          <BulletinBoard board={board} />
        ) : view === "calendar" ? (
          <CalendarView board={board} />
        ) : (
          <>
            <PinnedBanner board={board} />
            <KanbanBoard board={board} />
          </>
        )}
      </main>
      <CursorLayer />
      <UndoToast />
      <ErrorToast />
      <footer className="flex items-center justify-between border-t border-stone-200 px-4 py-2 text-xs text-stone-500 dark:border-stone-800">
        <KeptUntil />
        <span className="flex items-center gap-4">
          <ReportLink boardId={boardId} />
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
    <a href={`mailto:${email}?subject=${subject}&body=${body}`} className="hover:text-stone-800 hover:underline dark:hover:text-stone-200">
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
      className={`border-b-2 px-3 py-2 text-sm ${
        view === v ? "border-teal-600 font-semibold" : "border-transparent text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"
      }`}
    >
      {label}
    </button>
  );
  return (
    <nav role="tablist" aria-label="Board views" className="flex gap-1 border-b border-stone-200 px-3 dark:border-stone-800">
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
    <div role="alert" className="fixed right-4 top-16 z-40 flex items-center gap-3 rounded-lg bg-red-600 px-4 py-2.5 text-sm text-white shadow-lg">
      <span>Change not saved: {error}</span>
      <button type="button" onClick={clearError} aria-label="Dismiss" className="text-lg leading-none">
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
        await navigator.clipboard.writeText(window.location.href);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="rounded-md border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-900"
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
    <Notice title="This board expired" body="Boards are deleted after 60 days without a visit or edit.">
      <CreateBoardButton label="Create a new board" />
    </Notice>
  );
}

function Notice({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 text-center">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="mt-2 text-stone-600 dark:text-stone-400">{body}</p>
      </div>
      {children}
    </main>
  );
}
