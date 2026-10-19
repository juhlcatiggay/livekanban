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
  onMoveToBulletin: (card: Card) => void;
}

interface Drafts {
  title?: string;
  description?: string;
  labels?: string;
  assignee?: string;
  dueDate?: string;
}

/**
 * A field shows the live card value until you type in it; from then on it
 * shows your draft, so someone else's edit never yanks text out from under
 * you. Fields you haven't touched update live as others type (every 300 ms).
 */
export function CardDialog({ card, columnTitle, onClose, onDelete, onMoveToBulletin }: CardDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const { queue, flush } = usePatchSender(card.id);
  const setPresence = useBoard((s) => s.setPresence);
  const editors = Object.values(useBoard((s) => s.peers)).filter((p) => p.editing === card.id);
  const [drafts, setDrafts] = useState<Drafts>({});
  const draft = <K extends keyof Drafts>(key: K, value: Drafts[K]) => setDrafts((d) => ({ ...d, [key]: value }));
  const title = drafts.title ?? card.title;
  const description = drafts.description ?? card.description;
  const labels = drafts.labels ?? card.labels.join(", ");
  const assignee = drafts.assignee ?? card.assignee;
  const dueDate = drafts.dueDate ?? card.dueDate ?? "";

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  // Others see "<you> is editing" on this card while the dialog is open.
  useEffect(() => {
    setPresence({ editing: card.id });
    return () => setPresence({ editing: null });
  }, [card.id, setPresence]);

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
              draft("title", e.target.value);
              if (e.target.value.trim()) queue({ title: e.target.value });
            }}
            className="w-full rounded-md bg-transparent px-1 text-lg font-semibold outline-none focus:ring-2 focus:ring-teal-500"
          />
          <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="rounded px-2 text-xl leading-none text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800">
            ×
          </button>
        </div>
        <p className="-mt-3 px-1 text-xs text-stone-500">
          in {columnTitle}
          {editors.length > 0 && (
            <span className="ml-2 font-medium" style={{ color: editors[0].color }}>
              · {editors.map((p) => p.name).join(", ")} {editors.length > 1 ? "are" : "is"} also editing
            </span>
          )}
        </p>

        <label className="flex flex-col gap-1 text-sm font-medium">
          Description
          <textarea
            rows={6}
            value={description}
            maxLength={LIMITS.description}
            placeholder="Add details (Markdown)"
            onChange={(e) => {
              draft("description", e.target.value);
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
                draft("assignee", e.target.value);
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
                draft("dueDate", e.target.value);
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
              draft("labels", e.target.value);
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
          <span className="flex gap-1">
          <button
            type="button"
            onClick={() => {
              flush();
              onMoveToBulletin(card);
            }}
            className="rounded-md px-2 py-1 text-sm text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
          >
            Move to bulletin
          </button>
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
          </span>
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
