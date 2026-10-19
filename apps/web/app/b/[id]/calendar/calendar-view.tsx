"use client";

import { useMemo, useState } from "react";
import { byPosition, sortedColumns, type BoardData, type Card } from "@livekanban/protocol";
import { useBoard } from "@/lib/board-store";
import { isFiltering, matchesFilter, useCardFilter } from "@/lib/card-filter";
import { useCan } from "@/lib/use-can";
import { CardDialogFor } from "../kanban/card-dialog-for";
import { COLOR_STYLES } from "../kanban/colors";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const monthFormat = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });
const dayLabel = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
/** dataTransfer type for a card being dragged to a new day. */
const CARD_MIME = "application/x-livekanban-card";

/** Local calendar date as YYYY-MM-DD (the format of Card.dueDate). */
const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The 5 or 6 Sunday-first weeks that cover `month`. */
function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weeks = Math.ceil((first.getDay() + daysInMonth) / 7);
  return Array.from({ length: weeks * 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

/** A card's entry on one day: its due date, or its start date. */
interface Entry {
  card: Card;
  kind: "due" | "start";
}

/**
 * Cards by due date (and start date) on a month grid. Click a card to open it;
 * drag it to another day to change that date. Days and cards are cursor anchors, so
 * live cursors work here too.
 */
export function CalendarView({ board }: { board: BoardData }) {
  const dispatch = useBoard((s) => s.dispatch);
  // Rescheduling changes a card's due date, so it needs card-editing rights.
  const canReschedule = useCan().editCards;
  const today = isoDay(new Date());
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const filter = useCardFilter();
  const filtering = isFiltering(filter);
  const days = useMemo(() => monthGrid(month.year, month.month), [month]);
  const columnOrder = useMemo(() => new Map(sortedColumns(board).map((c, i) => [c.id, i])), [board]);
  const byDay = useMemo(() => {
    const out = new Map<string, Entry[]>();
    const add = (day: string, entry: Entry) => out.set(day, [...(out.get(day) ?? []), entry]);
    for (const card of Object.values(board.cards)) {
      if (filtering && !matchesFilter(card, filter)) continue;
      if (card.startDate && card.startDate !== card.dueDate) add(card.startDate, { card, kind: "start" });
      if (card.dueDate) add(card.dueDate, { card, kind: "due" });
    }
    for (const list of out.values()) {
      list.sort(
        (a, b) =>
          (columnOrder.get(a.card.columnId) ?? 0) - (columnOrder.get(b.card.columnId) ?? 0) || byPosition(a.card, b.card) || a.kind.localeCompare(b.kind),
      );
    }
    return out;
  }, [board.cards, columnOrder, filter, filtering]);
  const undated = Object.values(board.cards).filter((c) => !c.dueDate && !c.startDate).length;

  const shift = (delta: number) =>
    setMonth(({ year, month: m }) => {
      const d = new Date(year, m + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });

  const reschedule = (cardId: string, kind: Entry["kind"], day: string) => {
    const card = board.cards[cardId];
    if (!card) return;
    if (kind === "due" && card.dueDate !== day) dispatch({ kind: "card.update", id: cardId, patch: { dueDate: day } });
    if (kind === "start" && card.startDate !== day) dispatch({ kind: "card.update", id: cardId, patch: { startDate: day } });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-2 text-sm dark:border-gray-800">
        <button type="button" onClick={() => shift(-1)} aria-label="Previous month" className="rounded px-2 py-0.5 hover:bg-gray-100 dark:hover:bg-gray-800">
          ‹
        </button>
        <h2 className="min-w-40 text-center font-semibold" aria-live="polite">
          {monthFormat.format(new Date(month.year, month.month, 1))}
        </h2>
        <button type="button" onClick={() => shift(1)} aria-label="Next month" className="rounded px-2 py-0.5 hover:bg-gray-100 dark:hover:bg-gray-800">
          ›
        </button>
        <button
          type="button"
          onClick={() => {
            const now = new Date();
            setMonth({ year: now.getFullYear(), month: now.getMonth() });
          }}
          className="rounded-full px-2 py-0.5 hover:bg-black/10 dark:hover:bg-white/15 bg-black/5 dark:bg-white/10"
        >
          Today
        </button>
        <span className="ml-auto text-xs text-gray-500">
          {canReschedule ? "Drag a card to another day to change its date." : "The host has made cards view-only."}
          {undated > 0 && ` ${undated} card${undated === 1 ? " has" : "s have"} no dates.`}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3" data-presence-area data-anchor="calendar">
        <div className="grid min-w-[44rem] grid-cols-7 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 dark:border-gray-800 dark:bg-gray-800">
          {WEEKDAYS.map((d) => (
            <div key={d} className="bg-gray-50 px-2 py-1 text-xs font-medium text-gray-500 dark:bg-gray-900">
              {d}
            </div>
          ))}
          {days.map((date) => {
            const day = isoDay(date);
            const inMonth = date.getMonth() === month.month;
            const cards = byDay.get(day) ?? [];
            return (
              <section
                key={day}
                aria-label={dayLabel.format(date)}
                data-anchor={`d${day}`}
                data-day={day}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes(CARD_MIME)) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDropTarget(day);
                }}
                onDragLeave={() => setDropTarget((t) => (t === day ? null : t))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDropTarget(null);
                  const [id, kind] = e.dataTransfer.getData(CARD_MIME).split("|");
                  if (id) reschedule(id, kind === "start" ? "start" : "due", day);
                }}
                className={`flex min-h-28 flex-col gap-1 p-1.5 ${inMonth ? "bg-white dark:bg-gray-950" : "bg-gray-50 text-gray-400 dark:bg-gray-900"} ${
                  dropTarget === day ? "outline outline-2 -outline-offset-2 outline-accent-500" : ""
                }`}
              >
                <span
                  className={`self-end rounded-full px-1.5 text-xs tabular-nums ${day === today ? "bg-accent-600 font-semibold text-white" : ""}`}
                  aria-current={day === today ? "date" : undefined}
                >
                  {date.getDate()}
                </span>
                {cards.map(({ card, kind }) => (
                  <button
                    key={`${card.id}-${kind}`}
                    type="button"
                    draggable={canReschedule}
                    data-anchor={card.id}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(CARD_MIME, `${card.id}|${kind}`);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => setDropTarget(null)}
                    onClick={() => setOpenCardId(card.id)}
                    aria-label={`${kind === "start" ? "Starts: " : ""}${card.title} (${board.columns[card.columnId]?.title ?? ""})${
                      canReschedule ? `. Drag to change its ${kind === "start" ? "start" : "due"} date.` : ""
                    }`}
                    className="relative w-full cursor-grab overflow-hidden rounded border border-gray-200 bg-white px-1.5 pb-0.5 pt-1.5 text-left text-xs text-gray-900 shadow-sm hover:border-gray-400 active:cursor-grabbing dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                  >
                    <span className={`absolute inset-x-0 top-0 h-1 ${card.color ? COLOR_STYLES[card.color].stripe : "bg-gray-300 dark:bg-gray-600"}`} />
                    <span className="block truncate font-medium">
                      {kind === "start" && <span className="mr-1 font-normal text-accent-700 dark:text-accent-400">▶ Starts</span>}
                      {card.title}
                    </span>
                    <span className="block truncate text-[10px] text-gray-500">{board.columns[card.columnId]?.title}</span>
                  </button>
                ))}
              </section>
            );
          })}
        </div>
      </div>

      {openCardId && <CardDialogFor board={board} cardId={openCardId} onClose={() => setOpenCardId(null)} />}
    </div>
  );
}
