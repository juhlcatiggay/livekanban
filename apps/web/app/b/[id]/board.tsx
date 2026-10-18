"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Peer } from "@livekanban/protocol";
import { connectBoard, useBoard, type ConnectionStatus } from "@/lib/board-store";
import { getIdentity } from "@/lib/identity";
import { CreateBoardButton } from "../../create-board-button";

export function Board({ boardId }: { boardId: string }) {
  const status = useBoard((s) => s.status);

  useEffect(() => connectBoard(boardId, getIdentity()), [boardId]);

  if (status === "expired") return <ExpiredBoard />;
  if (status === "full") {
    return <Notice title="This board is full" body="Too many people are on this board right now. Try again soon." />;
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-stone-200 px-4 py-3 dark:border-stone-800">
        <Link href="/" className="font-semibold">
          LiveKanban
        </Link>
        <div className="flex items-center gap-4">
          <PresenceBar />
          <CopyLinkButton />
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center p-8 text-stone-500">
        <p>Columns and cards arrive in phase 2.</p>
      </main>
      <footer className="flex items-center justify-between border-t border-stone-200 px-4 py-2 text-xs text-stone-500 dark:border-stone-800">
        <KeptUntil />
        <ConnectionInfo status={status} />
      </footer>
    </div>
  );
}

function PresenceBar() {
  const me = useBoard((s) => s.me);
  const self = useBoard((s) => s.self);
  const peers = useBoard((s) => s.peers);
  const everyone: Peer[] = [...(me && self ? [{ ...me, connectionId: self }] : []), ...Object.values(peers)];

  return (
    <ul className="flex -space-x-2" aria-label={`${everyone.length} people on this board`}>
      {everyone.map((p) => (
        <li key={p.connectionId}>
          <span
            title={p.connectionId === self ? `${p.name} (you)` : p.name}
            className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white text-xs font-semibold text-white dark:border-stone-950"
            style={{ backgroundColor: p.color }}
          >
            {initials(p.name)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
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
