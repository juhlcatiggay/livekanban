"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Card } from "@livekanban/protocol";
import { COLOR_STYLES } from "./colors";

const dueFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Presentational card, shared by the list and the drag overlay. */
export function CardFace({ card, lifted = false }: { card: Card; lifted?: boolean }) {
  const overdue = card.dueDate !== null && card.dueDate < new Date().toISOString().slice(0, 10);
  return (
    <div
      className={`relative overflow-hidden rounded-lg border border-stone-200 bg-white p-3 text-sm shadow-sm dark:border-stone-700 dark:bg-stone-900 ${
        lifted ? "rotate-2 shadow-lg ring-2 ring-teal-500" : ""
      }`}
    >
      {card.color && <span className={`absolute inset-y-0 left-0 w-1 ${COLOR_STYLES[card.color].stripe}`} />}
      <p className="break-words font-medium">{card.title}</p>
      {card.labels.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1">
          {card.labels.map((l) => (
            <li key={l} className="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-700 dark:bg-stone-800 dark:text-stone-300">
              {l}
            </li>
          ))}
        </ul>
      )}
      {(card.assignee || card.dueDate || card.description) && (
        <div className="mt-2 flex items-center gap-3 text-xs text-stone-500">
          {card.assignee && <span className="truncate">@{card.assignee}</span>}
          {card.dueDate && (
            <span className={overdue ? "font-medium text-red-600 dark:text-red-400" : ""}>
              Due {dueFormat.format(new Date(`${card.dueDate}T00:00:00Z`))}
            </span>
          )}
          {card.description && <span aria-label="Has description">≡</span>}
        </div>
      )}
    </div>
  );
}

export function SortableCard({ card, onOpen }: { card: Card; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: "card" },
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`cursor-grab touch-none rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-teal-500 active:cursor-grabbing ${
        isDragging ? "opacity-40" : ""
      }`}
      data-anchor={card.id}
      {...attributes}
      {...listeners}
      aria-roledescription="card"
      aria-label={`${card.title}. Press Enter to open, Space to move.`}
      onClick={onOpen}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e);
        if (e.key === "Enter" && !e.defaultPrevented) onOpen();
      }}
    >
      <CardFace card={card} />
    </li>
  );
}
