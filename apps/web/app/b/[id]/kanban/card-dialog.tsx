"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { COLORS, LIMITS, type Card, type CardPatch } from "@livekanban/protocol";
import { useBoard } from "@/lib/board-store";
import { COLOR_STYLES } from "./colors";
import { AssigneesField } from "./assignees";
import { ChecklistEditor } from "./checklist";
import { LabelsField } from "./labels";
import { Markdown } from "./markdown";
import { MarkdownEditor } from "./markdown-editor";

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

const editedFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

interface CardDialogProps {
  card: Card;
  columnTitle: string;
  onClose: () => void;
  onDelete: (card: Card) => void;
  /** The host made cards view-only: show everything, change nothing. */
  readOnly?: boolean;
}

interface Drafts {
  title?: string;
  description?: string;
  startDate?: string;
  dueDate?: string;
}

/**
 * A field shows the live card value until you type in it; from then on it
 * shows your draft, so someone else's edit never yanks text out from under
 * you. Fields you haven't touched update live as others type (every 300 ms).
 */
export function CardDialog({ card, columnTitle, onClose, onDelete, readOnly = false }: CardDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const { queue, flush } = usePatchSender(card.id);
  const dispatch = useBoard((s) => s.dispatch);
  const setPresence = useBoard((s) => s.setPresence);
  const editors = Object.values(useBoard((s) => s.peers)).filter((p) => p.editing === card.id);
  const [drafts, setDrafts] = useState<Drafts>({});
  const draft = <K extends keyof Drafts>(key: K, value: Drafts[K]) => setDrafts((d) => ({ ...d, [key]: value }));
  const title = drafts.title ?? card.title;
  const description = drafts.description ?? card.description;
  const labelColors = useBoard((s) => s.board?.labelColors) ?? {};
  const allCards = useBoard((s) => s.board?.cards);
  // Every label used on the board, for suggestions (first spelling wins).
  const knownLabels = [...new Map(Object.values(allCards ?? {}).flatMap((c) => c.labels.map((l) => [l.toLowerCase(), l] as const))).values()].sort();
  // Assignees change in whole steps (add/remove a chip), so they follow the card directly.
  const me = useBoard((s) => s.me);
  const peerNames = Object.values(useBoard((s) => s.peers)).map((p) => p.name);
  const suggestions = [...new Set([...(me ? [me.name] : []), ...peerNames])];
  const startDate = drafts.startDate ?? card.startDate ?? "";
  const dueDate = drafts.dueDate ?? card.dueDate ?? "";
  const datesBackwards = startDate !== "" && dueDate !== "" && startDate > dueDate;
  // Cards with a description open showing it rendered; empty ones open ready to write.
  /** The description shows rendered; Edit switches to the Markdown source until Done. */
  const [editingDescription, setEditingDescription] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  // Others see "<you> is editing" on this card while the dialog is open (not when only viewing).
  useEffect(() => {
    if (readOnly) return;
    setPresence({ editing: card.id });
    return () => setPresence({ editing: null });
  }, [card.id, readOnly, setPresence]);

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
            readOnly={readOnly}
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
          {card.number > 0 && <span className="mr-1.5 font-medium tabular-nums">#{card.number}</span>}
          in {columnTitle}
          {readOnly && <span className="ml-2">· view only</span>}
          {editors.length > 0 && (
            <span className="ml-2 font-medium" style={{ color: editors[0].color }}>
              · {editors.map((p) => p.name).join(", ")} {editors.length > 1 ? "are" : "is"} also editing
            </span>
          )}
        </p>

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Description</span>
            {!readOnly && (
              <button
                type="button"
                onClick={() => setEditingDescription((e) => !e)}
                className={`rounded-md px-2.5 py-0.5 text-xs font-medium ${
                  editingDescription
                    ? "bg-teal-600 text-white hover:bg-teal-700"
                    : "border border-stone-300 text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
                }`}
              >
                {editingDescription ? "Done" : description ? "Edit" : "Add description"}
              </button>
            )}
          </div>
          {editingDescription && !readOnly ? (
            <MarkdownEditor
              autoFocus
              aria-label="Description"
              rows={10}
              value={description}
              maxLength={LIMITS.description}
              placeholder="Add details. Use the toolbar for bold, lists, links and images; type # to mention a card or note."
              onChange={(text) => {
                draft("description", text);
                queue({ description: text });
              }}
              className={`${field} font-normal`}
            />
          ) : (
            <div
              role="region"
              aria-label="Description preview"
              title={readOnly ? undefined : "Double-click to edit"}
              onDoubleClick={() => !readOnly && setEditingDescription(true)}
              className="max-h-[50vh] min-h-24 overflow-y-auto rounded-md border border-stone-200 px-4 py-3 dark:border-stone-700"
            >
              {description ? <Markdown text={description} /> : <p className="text-sm text-stone-400">No description yet.</p>}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium" id={`checklist-${card.id}`}>
            Checklist
          </span>
          <div role="group" aria-labelledby={`checklist-${card.id}`}>
            <ChecklistEditor card={card} readOnly={readOnly} />
          </div>
        </div>

        <div className="flex flex-col gap-1 text-sm font-medium">
          <span id={`assignees-${card.id}`}>Assignees</span>
          <div role="group" aria-labelledby={`assignees-${card.id}`}>
            <AssigneesField
              value={card.assignees}
              onChange={(assignees) => dispatch({ kind: "card.update", id: card.id, patch: { assignees } })}
              suggestions={suggestions}
              readOnly={readOnly}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Start date
            <input
              type="date"
              value={startDate}
              readOnly={readOnly}
              max={dueDate || undefined}
              onChange={(e) => {
                draft("startDate", e.target.value);
                queue({ startDate: e.target.value || null });
              }}
              className={`${field} font-normal`}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Due date
            <input
              type="date"
              value={dueDate}
              readOnly={readOnly}
              min={startDate || undefined}
              onChange={(e) => {
                draft("dueDate", e.target.value);
                queue({ dueDate: e.target.value || null });
              }}
              className={`${field} font-normal`}
            />
          </label>
        </div>

        {datesBackwards && (
          <p role="alert" className="-mt-2 text-xs text-amber-700 dark:text-amber-400">
            The start date is after the due date.
          </p>
        )}

        <div className="flex flex-col gap-1 text-sm font-medium">
          <span id={`labels-${card.id}`}>Labels</span>
          <div role="group" aria-labelledby={`labels-${card.id}`}>
            <LabelsField
              value={card.labels}
              onChange={(labels) => dispatch({ kind: "card.update", id: card.id, patch: { labels } })}
              labelColors={labelColors}
              onColor={(label, color) => dispatch({ kind: "label.color", label, color })}
              known={knownLabels}
              readOnly={readOnly}
            />
          </div>
        </div>

        <fieldset className="flex flex-col gap-1.5" disabled={readOnly}>
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
          {!readOnly && (
            <span className="flex gap-1">
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
          )}
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
