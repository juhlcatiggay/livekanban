"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { COLORS, LIMITS, type Card, type CardPatch } from "@livekanban/protocol";
import { useBoard } from "@/lib/board-store";
import { COLOR_STYLES } from "./colors";

/** Text saves are last-writer-wins per field, sent at most every 300 ms while typing. */
const SAVE_DEBOUNCE_MS = 300;

function usePatchSender(cardId: string) {
  const dispatch = useBoard((s) => s.dispatch);
  const queued = useRef<CardPatch>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const patch = queued.current;
    queued.current = {};
    if (Object.keys(patch).length) dispatch({ kind: "card.update", id: cardId, patch });
  }, [cardId, dispatch]);

  const queue = useCallback(
    (patch: CardPatch) => {
      Object.assign(queued.current, patch);
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  useEffect(() => flush, [flush]);
  return { queue, flush };
}

function parseLabels(text: string): string[] {
  const labels = text
    .split(",")
    .map((l) => l.trim().slice(0, LIMITS.label))
    .filter(Boolean);
  return [...new Set(labels)].slice(0, LIMITS.labels);
}

const editedFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

interface CardDialogProps {
  card: Card;
  columnTitle: string;
  onClose: () => void;
  onDelete: (card: Card) => void;
}

/**
 * Drafts are local while the dialog is open, so someone else's edit to the
 * same field doesn't yank text out from under you (live typing comes in phase 3).
 */
export function CardDialog({ card, columnTitle, onClose, onDelete }: CardDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const { queue, flush } = usePatchSender(card.id);
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [labels, setLabels] = useState(card.labels.join(", "));
  const [assignee, setAssignee] = useState(card.assignee);
  const [dueDate, setDueDate] = useState(card.dueDate ?? "");

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const close = () => {
    flush();
    onClose();
  };

  const field = "w-full rounded-md border border-stone-300 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-teal-500 dark:border-stone-700";

  return (
    <dialog
      ref={ref}
      onClose={close}
      onClick={(e) => e.target === ref.current && ref.current.close()}
      aria-label={`Card ${card.title}`}
      className="m-auto w-[min(36rem,calc(100vw-2rem))] rounded-xl bg-white p-0 text-stone-900 shadow-2xl backdrop:bg-black/40 dark:bg-stone-900 dark:text-stone-100"
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <input
            aria-label="Card title"
            value={title}
            maxLength={LIMITS.title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (e.target.value.trim()) queue({ title: e.target.value });
            }}
            className="w-full rounded-md bg-transparent px-1 text-lg font-semibold outline-none focus:ring-2 focus:ring-teal-500"
          />
          <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="rounded px-2 text-xl leading-none text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800">
            ×
          </button>
        </div>
        <p className="-mt-3 px-1 text-xs text-stone-500">in {columnTitle}</p>

        <label className="flex flex-col gap-1 text-sm font-medium">
          Description
          <textarea
            rows={6}
            value={description}
            maxLength={LIMITS.description}
            placeholder="Add details (Markdown)"
            onChange={(e) => {
              setDescription(e.target.value);
              queue({ description: e.target.value });
            }}
            className={`${field} font-normal`}
          />
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Assignee
            <input
              value={assignee}
              maxLength={LIMITS.assignee}
              placeholder="Name"
              onChange={(e) => {
                setAssignee(e.target.value);
                queue({ assignee: e.target.value });
              }}
              className={`${field} font-normal`}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Due date
            <input
              type="date"
              value={dueDate}
              onChange={(e) => {
                setDueDate(e.target.value);
                queue({ dueDate: e.target.value || null });
              }}
              className={`${field} font-normal`}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm font-medium">
          Labels
          <input
            value={labels}
            placeholder="Comma separated, e.g. bug, design"
            onChange={(e) => {
              setLabels(e.target.value);
              queue({ labels: parseLabels(e.target.value) });
            }}
            className={`${field} font-normal`}
          />
        </label>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-sm font-medium">Color</legend>
          <div className="flex flex-wrap gap-2">
            <ColorSwatch label="None" selected={card.color === null} onClick={() => queue({ color: null })} className="bg-white ring-1 ring-stone-300 dark:bg-stone-800" />
            {COLORS.map((c) => (
              <ColorSwatch
                key={c}
                label={COLOR_STYLES[c].label}
                selected={card.color === c}
                onClick={() => queue({ color: c })}
                className={COLOR_STYLES[c].swatch}
              />
            ))}
          </div>
        </fieldset>

        <div className="flex items-center justify-between border-t border-stone-200 pt-3 text-xs text-stone-500 dark:border-stone-800">
          <span>
            Last edited by {card.updatedBy} · {editedFormat.format(card.updatedAt)}
          </span>
          <button
            type="button"
            onClick={() => {
              flush();
              onDelete(card);
            }}
            className="rounded-md px-2 py-1 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
          >
            Delete card
          </button>
        </div>
      </div>
    </dialog>
  );
}

function ColorSwatch({ label, selected, onClick, className }: { label: string; selected: boolean; onClick: () => void; className: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      title={label}
      onClick={onClick}
      className={`h-7 w-7 rounded-full ${className} ${selected ? "ring-2 ring-teal-600 ring-offset-2 dark:ring-offset-stone-900" : ""}`}
    />
  );
}
