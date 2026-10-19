"use client";

import { useState } from "react";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { LIMITS, positionBetween, type Card, type Column, type Peer } from "@livekanban/protocol";
import { newItemId, useBoard } from "@/lib/board-store";
import { closeMenu, useDismiss } from "@/lib/use-dismiss";
import type { PresenceIndex } from "@/lib/presence-index";
import type { Can } from "@/lib/use-can";
import { InlineEdit } from "./inline-edit";
import { EditingBadge, SortableCard } from "./card";

export const columnDragId = (id: string) => `col:${id}`;

interface ColumnProps {
  column: Column;
  cards: Card[];
  presence: PresenceIndex;
  /** What this tab may change (the host can make parts view-only). */
  can: Can;
  onOpenCard: (id: string) => void;
  onDelete: (column: Column) => void;
}

export function SortableColumn({ column, cards, presence, can, onOpenCard, onDelete }: ColumnProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: columnDragId(column.id),
    data: { type: "column" },
    disabled: !can.moveCards,
  });

  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`flex max-h-full w-72 shrink-0 flex-col rounded-2xl bg-black/[0.04] dark:bg-white/[0.06] ${
        isDragging ? "opacity-40" : ""
      }`}
      data-anchor={column.id}
      aria-label={`Column ${column.title}`}
    >
      <ColumnHeader
        column={column}
        count={cards.length}
        editors={presence.editors[column.id] ?? []}
        canEdit={can.editCards}
        onDelete={() => onDelete(column)}
        handle={
          can.moveCards && (
            <button
              type="button"
              ref={setActivatorNodeRef}
              {...attributes}
              {...listeners}
              aria-roledescription="column"
              aria-label={`Move column ${column.title}. Press Space to pick up.`}
              className="cursor-grab touch-none rounded-md px-1 text-gray-400 hover:bg-black/5 active:cursor-grabbing dark:hover:bg-white/10"
            >
              ⠿
            </button>
          )
        }
      />
      <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <ul className="flex min-h-12 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 pt-0.5">
          {cards.map((card) => (
            <SortableCard
              key={card.id}
              card={card}
              onOpen={() => onOpenCard(card.id)}
              heldBy={presence.heldBy[card.id]}
              editors={presence.editors[card.id]}
              canMove={can.moveCards}
            />
          ))}
        </ul>
      </SortableContext>
      {can.editCards && <AddCard columnId={column.id} lastPosition={cards.at(-1)?.position ?? null} />}
    </section>
  );
}

/** Static header used for the column drag overlay. */
export function ColumnPreview({ column, count }: { column: Column; count: number }) {
  return (
    <section className="w-72 rotate-1 rounded-2xl bg-gray-100 shadow-[0_20px_40px_-12px_rgb(0_0_0/0.35)] ring-1 ring-accent-500/50 dark:bg-gray-900">
      <div className="px-3 py-2.5 text-sm font-semibold">
        {column.title} <span className="font-normal text-gray-500">{count}</span>
      </div>
    </section>
  );
}

function ColumnHeader({
  column,
  count,
  editors,
  canEdit,
  onDelete,
  handle,
}: {
  column: Column;
  count: number;
  editors: Peer[];
  canEdit: boolean;
  onDelete: () => void;
  handle: React.ReactNode;
}) {
  const dispatch = useBoard((s) => s.dispatch);
  const setPresence = useBoard((s) => s.setPresence);
  const over = column.wipLimit !== null && count > column.wipLimit;

  return (
    <header
      className="relative flex items-center gap-1 rounded-t-2xl px-2 pb-1.5 pt-2.5"
      style={editors[0] ? { boxShadow: `inset 0 0 0 2px ${editors[0].color}` } : undefined}
    >
      {editors.length > 0 && <EditingBadge peers={editors} className="-top-2.5 left-8" />}
      {handle}
      <InlineEdit
        value={column.title}
        label="column title"
        className="flex-1 text-[13px] font-semibold"
        onCommit={(title) => dispatch({ kind: "column.update", id: column.id, patch: { title } })}
        onEditingChange={(editing) => setPresence({ editing: editing ? column.id : null })}
        disabled={!canEdit}
      />
      <span
        className={`rounded-full px-2 py-px text-[11px] font-medium tabular-nums ${over ? "bg-red-500 text-white" : "bg-black/[0.06] text-gray-600 dark:bg-white/10 dark:text-gray-300"}`}
        title={column.wipLimit !== null ? `WIP limit ${column.wipLimit}` : undefined}
      >
        {count}
        {column.wipLimit !== null && ` / ${column.wipLimit}`}
      </span>
      {/* Keyed so a WIP limit changed by someone else resets the draft. */}
      {canEdit && <ColumnMenu key={String(column.wipLimit)} column={column} onDelete={onDelete} />}
    </header>
  );
}

function ColumnMenu({ column, onDelete }: { column: Column; onDelete: () => void }) {
  const dispatch = useBoard((s) => s.dispatch);
  const menu = useDismiss();
  const [wip, setWip] = useState(column.wipLimit?.toString() ?? "");

  const saveWip = () => {
    const n = wip.trim() === "" ? null : Number(wip);
    if (n !== null && !(Number.isInteger(n) && n >= 1 && n <= LIMITS.wipLimit)) {
      setWip(column.wipLimit?.toString() ?? "");
      return;
    }
    if (n !== column.wipLimit) dispatch({ kind: "column.update", id: column.id, patch: { wipLimit: n } });
  };

  return (
    <details ref={menu} className="relative">
      <summary
        className="cursor-pointer list-none rounded-md px-1.5 text-gray-500 hover:bg-black/5 dark:hover:bg-white/10"
        aria-label={`Column ${column.title} options`}
      >
        ⋯
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-48 rounded-xl border border-black/10 bg-white/90 backdrop-blur-xl backdrop-saturate-150 p-2 text-sm shadow-[0_12px_40px_-8px_rgb(0_0_0/0.28)] dark:border-white/10 dark:bg-gray-800/90">
        <label className="flex items-center justify-between gap-2 px-1 py-1">
          WIP limit
          <input
            type="number"
            min={1}
            max={LIMITS.wipLimit}
            placeholder="None"
            value={wip}
            onChange={(e) => setWip(e.target.value)}
            onBlur={saveWip}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              saveWip();
              closeMenu(menu);
            }}
            className="field w-16 rounded px-1 py-0.5"
          />
        </label>
        <button
          type="button"
          onClick={() => {
            closeMenu(menu);
            onDelete();
          }}
          className="mt-1 w-full rounded px-1 py-1 text-left text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
        >
          Delete column
        </button>
      </div>
    </details>
  );
}

function AddCard({ columnId, lastPosition }: { columnId: string; lastPosition: string | null }) {
  const dispatch = useBoard((s) => s.dispatch);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="m-2 mt-0 rounded-lg px-2 py-1.5 text-left text-[13px] font-medium text-gray-500 hover:bg-black/5 hover:text-gray-800 dark:hover:bg-white/10 dark:hover:text-gray-200"
      >
        + Add card
      </button>
    );
  }

  const add = () => {
    const t = title.trim();
    if (!t) return;
    dispatch({ kind: "card.create", id: newItemId(), columnId, position: positionBetween(lastPosition, null), title: t });
    setTitle("");
  };

  return (
    <form
      className="m-2 mt-0 flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      <textarea
        autoFocus
        rows={2}
        value={title}
        maxLength={LIMITS.title}
        placeholder="Card title"
        aria-label="New card title"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            add();
          }
          if (e.key === "Escape") setOpen(false);
        }}
        className="field resize-none rounded-lg p-2 text-sm"
      />
      <div className="flex gap-2">
        <button type="submit" className="rounded-full bg-accent-600 px-3 py-1 text-sm font-medium text-white hover:bg-accent-700">
          Add
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-full px-3 py-1 text-sm text-gray-500 hover:bg-black/5 dark:hover:bg-white/10">
          Cancel
        </button>
      </div>
    </form>
  );
}
