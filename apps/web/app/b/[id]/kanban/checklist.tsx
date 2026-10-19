"use client";

import { useState } from "react";
import { LIMITS, checklistProgress, type Card } from "@livekanban/protocol";
import { newItemId, useBoard } from "@/lib/board-store";

/** "☑ 2/5" with a thin bar, for the card face on the kanban. Green when everything is done. */
export function ChecklistProgress({ card, className = "" }: { card: Pick<Card, "checklist">; className?: string }) {
  const { done, total } = checklistProgress(card);
  if (!total) return null;
  const complete = done === total;
  return (
    <div className={`flex items-center gap-2 text-xs ${className}`} aria-label={`Checklist: ${done} of ${total} done`} role="img">
      <span className={`shrink-0 tabular-nums ${complete ? "font-medium text-green-700 dark:text-green-400" : "text-gray-500"}`}>
        ☑ {done}/{total}
      </span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
        <span
          className={`block h-full rounded-full transition-[width] ${complete ? "bg-green-500" : "bg-accent-500"}`}
          style={{ width: `${(done / total) * 100}%` }}
        />
      </span>
    </div>
  );
}

/**
 * The checklist inside the card dialog. Each tick, edit, add and delete is
 * its own op, so two people working through the same list never overwrite
 * each other's ticks.
 */
export function ChecklistEditor({ card, readOnly = false }: { card: Card; readOnly?: boolean }) {
  const dispatch = useBoard((s) => s.dispatch);
  const [adding, setAdding] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const { done, total } = checklistProgress(card);
  const full = total >= LIMITS.checklist;

  const add = () => {
    const text = adding.trim();
    if (!text || full) return;
    dispatch({ kind: "checklist.add", id: card.id, item: { id: newItemId(), text, done: false } });
    setAdding("");
  };

  const saveEdit = () => {
    if (!editing) return;
    const text = editing.text.trim();
    const item = card.checklist.find((i) => i.id === editing.id);
    if (item && text && text !== item.text) dispatch({ kind: "checklist.update", id: card.id, itemId: item.id, patch: { text } });
    setEditing(null);
  };

  return (
    <div className="flex flex-col gap-2">
      {total > 0 && (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className="tabular-nums">{Math.round((done / total) * 100)}%</span>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            <span
              className={`block h-full rounded-full transition-[width] ${done === total ? "bg-green-500" : "bg-accent-500"}`}
              style={{ width: `${(done / total) * 100}%` }}
            />
          </span>
          <span className="tabular-nums">
            {done} of {total}
          </span>
        </div>
      )}
      <ul className="flex flex-col" aria-label="Checklist items">
        {card.checklist.map((item) => (
          <li key={item.id} className="group flex items-start gap-2 rounded px-1 py-1 hover:bg-gray-50 dark:hover:bg-gray-800/50">
            <input
              type="checkbox"
              checked={item.done}
              disabled={readOnly}
              aria-label={item.text}
              onChange={(e) => dispatch({ kind: "checklist.update", id: card.id, itemId: item.id, patch: { done: e.target.checked } })}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            {editing?.id === item.id ? (
              <input
                autoFocus
                aria-label="Edit checklist item"
                value={editing.text}
                maxLength={LIMITS.checklistItem}
                onChange={(e) => setEditing({ id: item.id, text: e.target.value })}
                onBlur={saveEdit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveEdit();
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setEditing(null);
                  }
                }}
                className="field min-w-0 flex-1 rounded px-1.5 text-sm"
              />
            ) : (
              <span
                className={`min-w-0 flex-1 break-words text-sm ${item.done ? "text-gray-400 line-through" : ""} ${readOnly ? "" : "cursor-text"}`}
                onClick={() => !readOnly && setEditing({ id: item.id, text: item.text })}
              >
                {item.text}
              </span>
            )}
            {!readOnly && (
              <button
                type="button"
                aria-label={`Delete checklist item ${item.text}`}
                onClick={() => dispatch({ kind: "checklist.delete", id: card.id, itemId: item.id })}
                className="shrink-0 px-1 text-gray-400 opacity-0 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      {!readOnly && !full && (
        <input
          aria-label="Add checklist item"
          value={adding}
          maxLength={LIMITS.checklistItem}
          placeholder="Add an item and press Enter"
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          className="field w-full rounded-md px-2 py-1.5 text-sm"
        />
      )}
      {readOnly && total === 0 && <p className="text-sm text-gray-400">No checklist.</p>}
    </div>
  );
}
