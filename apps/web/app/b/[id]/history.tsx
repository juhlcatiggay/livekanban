"use client";

import { useEffect, useRef, useState } from "react";
import { useBoard, type HistoryView } from "@/lib/board-store";
import { ago, exactTime, historyLines } from "@/lib/describe";
import { jumpTo } from "@/lib/jump";

const dayHeading = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" });

/** "History" in the header: a panel of every change on the board, newest first, updating live. */
export function HistoryButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="text-sm text-stone-600 hover:text-stone-900 dark:text-stone-300 dark:hover:text-white">
        History
      </button>
      {open && <HistoryPanel onClose={() => setOpen(false)} />}
    </>
  );
}

function HistoryPanel({ onClose }: { onClose: () => void }) {
  const requestHistory = useBoard((s) => s.requestHistory);
  const closeHistory = useBoard((s) => s.closeHistory);
  const view = useBoard((s) => s.history);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    requestHistory();
    panel.current?.focus();
    return () => closeHistory();
  }, [requestHistory, closeHistory]);

  return (
    <aside
      ref={panel}
      tabIndex={-1}
      aria-label="Board history"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      className="fixed inset-y-0 right-0 z-50 flex w-[min(26rem,100vw)] flex-col border-l border-stone-200 bg-white shadow-2xl outline-none dark:border-stone-800 dark:bg-stone-950"
    >
      <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3 dark:border-stone-800">
        <h2 className="font-semibold">History</h2>
        <button type="button" onClick={onClose} aria-label="Close history" className="rounded px-2 text-xl leading-none text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800">
          ×
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <HistoryList view={view} onMore={() => requestHistory({ older: true })} groupByDay onJump={onClose} />
      </div>
      <p className="border-t border-stone-200 px-4 py-2 text-xs text-stone-500 dark:border-stone-800">The board keeps its last 2,000 changes.</p>
    </aside>
  );
}

/** A card's own history, at the bottom of its dialog. */
export function CardActivity({ cardId }: { cardId: string }) {
  const requestHistory = useBoard((s) => s.requestHistory);
  const closeHistory = useBoard((s) => s.closeHistory);
  const view = useBoard((s) => (s.itemHistory?.id === cardId ? s.itemHistory : null));

  useEffect(() => {
    requestHistory({ id: cardId });
    return () => closeHistory(cardId);
  }, [cardId, requestHistory, closeHistory]);

  return <HistoryList view={view} onMore={() => requestHistory({ id: cardId, older: true })} compact />;
}

function HistoryList({
  view,
  onMore,
  groupByDay = false,
  compact = false,
  onJump,
}: {
  view: HistoryView | null;
  onMore: () => void;
  groupByDay?: boolean;
  compact?: boolean;
  onJump?: () => void;
}) {
  const board = useBoard((s) => s.board);
  // Re-render every minute so "5 minutes ago" stays true.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  if (!view || (view.loading && !view.entries.length)) return <p className="text-sm text-stone-500">Loading…</p>;
  const lines = historyLines(view.entries, board);
  if (!lines.length) return <p className="text-sm text-stone-500">No changes yet.</p>;

  return (
    <div className="flex flex-col">
      <ol className="flex flex-col" aria-label={compact ? "Card activity" : "Changes, newest first"}>
        {lines.map((line, i) => {
          const dayLabel = dayHeading.format(line.at);
          const showDay = groupByDay && (i === 0 || dayHeading.format(lines[i - 1].at) !== dayLabel);
          return (
            <li key={line.seq} className="flex flex-col">
              {showDay && <h3 className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-stone-400 first:mt-0">{dayLabel}</h3>}
              <div className={`flex gap-2 ${compact ? "py-1" : "py-1.5"} text-sm`}>
                <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-stone-300 dark:bg-stone-600" />
                <p className="min-w-0 flex-1 break-words">
                  <span className="font-medium">{line.by}</span> {line.text}
                  {line.count > 1 && <span className="text-stone-500"> ({line.count} saves)</span>}
                  {!compact && line.target && (
                    <button
                      type="button"
                      onClick={() => {
                        jumpTo(line.target!);
                        onJump?.();
                      }}
                      className="ml-1.5 text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
                    >
                      Show
                    </button>
                  )}
                  <br />
                  <time dateTime={new Date(line.at).toISOString()} title={exactTime(line.at)} className="text-xs text-stone-500">
                    {ago(line.at, now)}
                  </time>
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      {view.more && (
        <button
          type="button"
          onClick={onMore}
          disabled={view.loading}
          className="mt-2 self-start rounded-md border border-stone-300 px-3 py-1 text-sm hover:bg-stone-100 disabled:opacity-60 dark:border-stone-700 dark:hover:bg-stone-800"
        >
          {view.loading ? "Loading…" : "Show older changes"}
        </button>
      )}
    </div>
  );
}
