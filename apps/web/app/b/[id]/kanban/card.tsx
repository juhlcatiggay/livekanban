"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { checklistProgress, type Card, type Peer } from "@livekanban/protocol";
import { useBoard } from "@/lib/board-store";
import { firstImage, imageHost, useAllowedImageHosts } from "@/lib/image-hosts";
import { clearSelection, toggleSelected, useSelection } from "@/lib/selection";
import { AssigneeAvatars } from "./assignees";
import { ChecklistProgress } from "./checklist";
import { LabelChip } from "./labels";
import { COLOR_STYLES } from "./colors";

const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const day = (iso: string) => dayFormat.format(new Date(`${iso}T00:00:00Z`));

/** Presentational card, shared by the list and the drag overlay. */
export function CardFace({ card, lifted = false, selected = false }: { card: Card; lifted?: boolean; selected?: boolean }) {
  const labelColors = useBoard((s) => s.board?.labelColors) ?? NO_COLORS;
  const allowedHosts = useAllowedImageHosts();
  const today = new Date().toISOString().slice(0, 10);
  const overdue = card.dueDate !== null && card.dueDate < today && !isComplete(card);
  const image = firstImage(card.description);
  const cover = image && allowedHosts.includes(imageHost(image.src) ?? "") ? image : null;
  const dates = card.startDate && card.dueDate ? `${day(card.startDate)} – ${day(card.dueDate)}` : card.dueDate ? `Due ${day(card.dueDate)}` : card.startDate ? `Starts ${day(card.startDate)}` : null;

  return (
    <div
      className={`relative overflow-hidden rounded-lg border bg-white text-sm shadow-sm dark:bg-stone-900 ${
        selected ? "border-teal-500 ring-2 ring-teal-500/60" : "border-stone-200 dark:border-stone-700"
      } ${lifted ? "rotate-2 shadow-lg ring-2 ring-teal-500" : ""}`}
    >
      {card.color && <span className={`absolute inset-x-0 top-0 z-10 h-1.5 ${COLOR_STYLES[card.color].stripe}`} />}
      {cover && (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary user URLs can't go through next/image.
        <img src={cover.src} alt={cover.alt} referrerPolicy="no-referrer" loading="lazy" draggable={false} className="block max-h-40 w-full object-cover" />
      )}
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 break-words font-medium">{card.title}</p>
          {card.number > 0 && <span className="shrink-0 pt-0.5 text-[11px] tabular-nums text-stone-400">#{card.number}</span>}
        </div>
        {card.labels.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1" aria-label="Labels">
            {card.labels.map((l) => (
              <li key={l}>
                <LabelChip label={l} labelColors={labelColors} />
              </li>
            ))}
          </ul>
        )}
        <ChecklistProgress card={card} className="mt-2" />
        {(card.assignees.length > 0 || dates || card.description) && (
          <div className="mt-2 flex items-center gap-3 text-xs text-stone-500">
            <AssigneeAvatars names={card.assignees} />
            {dates && <span className={overdue ? "font-medium text-red-600 dark:text-red-400" : ""}>{dates}</span>}
            {card.description && <span aria-label="Has description">≡</span>}
            {image && !cover && <span aria-label="Has an image">🖼</span>}
          </div>
        )}
      </div>
    </div>
  );
}

const NO_COLORS = {};

/** A card whose checklist is all ticked isn't shown as overdue. */
function isComplete(card: Card) {
  const { done, total } = checklistProgress(card);
  return total > 0 && done === total;
}

interface SortableCardProps {
  card: Card;
  onOpen: () => void;
  /** Someone else is dragging this card: show where it was and don't allow pickup. */
  heldBy?: Peer;
  /** Others editing this card. */
  editors?: Peer[];
  /** False when the host has made moving cards view-only. */
  canMove?: boolean;
}

export function SortableCard({ card, onOpen, heldBy, editors = [], canMove = true }: SortableCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: "card" },
    disabled: !!heldBy || !canMove,
  });
  const selected = useSelection((s) => s.ids.has(card.id));

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
      // dnd-kit marks a non-draggable card aria-disabled, but it can still be opened.
      aria-disabled={undefined}
      aria-label={`${card.title}${selected ? " (selected)" : ""}. Press Enter to open${canMove ? ", Space to move" : ""}.`}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey) return toggleSelected(card.id);
        clearSelection();
        onOpen();
      }}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e);
        if (e.key === "Enter" && !e.defaultPrevented) onOpen();
      }}
    >
      <div className="relative rounded-lg" style={editor ? { boxShadow: `0 0 0 2px ${editor.color}` } : undefined}>
        <CardFace card={card} selected={selected} />
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
