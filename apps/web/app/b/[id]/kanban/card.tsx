"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Card, Peer } from "@livekanban/protocol";
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

interface SortableCardProps {
  card: Card;
  onOpen: () => void;
  /** Someone else is dragging this card: show where it was and don't allow pickup. */
  heldBy?: Peer;
  /** Others editing this card. */
  editors?: Peer[];
}

export function SortableCard({ card, onOpen, heldBy, editors = [] }: SortableCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: "card" },
    disabled: !!heldBy,
  });

  if (heldBy) {
    return (
      <li
        ref={setNodeRef}
        data-anchor={card.id}
        className="flex min-h-16 items-center justify-center rounded-lg border-2 border-dashed p-3 text-xs font-medium"
        style={{ borderColor: heldBy.color, color: heldBy.color }}
        aria-label={`${card.title}, held by ${heldBy.name}`}
      >
        {heldBy.name} is moving “{card.title}”
      </li>
    );
  }

  const editor = editors[0];
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
      <div className="relative rounded-lg" style={editor ? { boxShadow: `0 0 0 2px ${editor.color}` } : undefined}>
        <CardFace card={card} />
        {editor && <EditingBadge peers={editors} />}
      </div>
    </li>
  );
}

/** "Teal Otter is editing" tag in the first editor's color. */
export function EditingBadge({ peers, className = "-top-2.5 right-2" }: { peers: Peer[]; className?: string }) {
  const [first] = peers;
  const label = peers.length > 1 ? `${first.name} +${peers.length - 1} editing` : `${first.name} is editing`;
  return (
    <span
      className={`pointer-events-none absolute z-10 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium text-white shadow ${className}`}
      style={{ backgroundColor: first.color }}
    >
      {label}
    </span>
  );
}
