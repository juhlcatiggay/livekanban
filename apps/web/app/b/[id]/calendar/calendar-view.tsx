"use client";

import { useMemo, useState } from "react";
import { byPosition, sortedColumns, type BoardData, type Card } from "@livekanban/protocol";
import { useBoard } from "@/lib/board-store";
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

/**
 * Cards by due date on a month grid. Click a card to open it; drag it to
 * another day to change its due date. Days and cards are cursor anchors, so
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

  const days = useMemo(() => monthGrid(month.year, month.month), [month]);
  const columnOrder = useMemo(() => new Map(sortedColumns(board).map((c, i) => [c.id, i])), [board]);
  const byDay = useMemo(() => {
    const out = new Map<string, Card[]>();
    for (const card of Object.values(board.cards)) {
      if (!card.dueDate) continue;
      out.set(card.dueDate, [...(out.get(card.dueDate) ?? []), card]);
    }
    for (const list of out.values()) {
      list.sort((a, b) => (columnOrder.get(a.columnId) ?? 0) - (columnOrder.get(b.columnId) ?? 0) || byPosition(a, b));
    }
    return out;
  }, [board.cards, columnOrder]);
  const undated = Object.values(board.cards).filter((c) => !c.dueDate).length;

  const shift = (delta: number) =>
    setMonth(({ year, month: m }) => {
      const d = new Date(year, m + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });

  const reschedule = (cardId: string, day: string) => {
    const card = board.cards[cardId];
    if (card && card.dueDate !== day) dispatch({ kind: "card.update", id: cardId, patch: { dueDate: day } });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-stone-200 px-4 py-2 text-sm dark:border-stone-800">
        <button type="button" onClick={() => shift(-1)} aria-label="Previous month" className="rounded px-2 py-0.5 hover:bg-stone-100 dark:hover:bg-stone-800">
          ‹
        </button>
        <h2 className="min-w-40 text-center font-semibold" aria-live="polite">
          {monthFormat.format(new Date(month.year, month.month, 1))}
        </h2>
        <button type="button" onClick={() => shift(1)} aria-label="Next month" className="rounded px-2 py-0.5 hover:bg-stone-100 dark:hover:bg-stone-800">
          ›
        </button>
        <button
          type="button"
          onClick={() => {
            const now = new Date();
            setMonth({ year: now.getFullYear(), month: now.getMonth() });
          }}
          className="rounded-md border border-stone-300 px-2 py-0.5 hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
        >
          Today
        </button>
        <span className="ml-auto text-xs text-stone-500">
          {canReschedule ? "Drag a card to another day to change its due date." : "The host has made cards view-only."}
          {undated > 0 && ` ${undated} card${undated === 1 ? " has" : "s have"} no due date.`}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3" data-presence-area data-anchor="calendar">
        <div className="grid min-w-[44rem] grid-cols-7 gap-px overflow-hidden rounded-lg border border-stone-200 bg-stone-200 dark:border-stone-800 dark:bg-stone-800">
          {WEEKDAYS.map((d) => (
            <div key={d} className="bg-stone-50 px-2 py-1 text-xs font-medium text-stone-500 dark:bg-stone-900">
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
                  const id = e.dataTransfer.getData(CARD_MIME);
                  if (id) reschedule(id, day);
                }}
                className={`flex min-h-28 flex-col gap-1 p-1.5 ${inMonth ? "bg-white dark:bg-stone-950" : "bg-stone-50 text-stone-400 dark:bg-stone-900"} ${
                  dropTarget === day ? "outline outline-2 -outline-offset-2 outline-teal-500" : ""
                }`}
              >
                <span
                  className={`self-end rounded-full px-1.5 text-xs tabular-nums ${day === today ? "bg-teal-600 font-semibold text-white" : ""}`}
                  aria-current={day === today ? "date" : undefined}
                >
                  {date.getDate()}
                </span>
                {cards.map((card) => (
                  <button
                    key={card.id}
                    type="button"
                    draggable={canReschedule}
                    data-anchor={card.id}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(CARD_MIME, card.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => setDropTarget(null)}
                    onClick={() => setOpenCardId(card.id)}
                    aria-label={`${card.title} (${board.columns[card.columnId]?.title ?? ""})${canReschedule ? ". Drag to change its due date." : ""}`}
                    className="relative w-full cursor-grab overflow-hidden rounded border border-stone-200 bg-white px-1.5 pb-0.5 pt-1.5 text-left text-xs text-stone-900 shadow-sm hover:border-stone-400 active:cursor-grabbing dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
                  >
                    <span className={`absolute inset-x-0 top-0 h-1 ${card.color ? COLOR_STYLES[card.color].stripe : "bg-stone-300 dark:bg-stone-600"}`} />
                    <span className="block truncate font-medium">{card.title}</span>
                    <span className="block truncate text-[10px] text-stone-500">{board.columns[card.columnId]?.title}</span>
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
