"use client";

import type { BoardData } from "@livekanban/protocol";
import { useBoard } from "@/lib/board-store";
import { useCan } from "@/lib/use-can";
import { setView } from "../view";

/** The pinned note, shown as an announcement strip at the top of the kanban tab. */
export function PinnedBanner({ board }: { board: BoardData }) {
  const dispatch = useBoard((s) => s.dispatch);
  const canEdit = useCan().editBulletin;
  const note = board.pinnedNoteId ? board.notes[board.pinnedNoteId] : undefined;
  if (!note) return null;

  return (
    <aside
      aria-label="Pinned announcement"
      className="flex items-start gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-stone-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-50"
    >
      <span aria-hidden className="pt-0.5">
        📌
      </span>
      <p className="line-clamp-3 min-w-0 flex-1 whitespace-pre-wrap break-words">{note.text || "Empty note"}</p>
      <button type="button" onClick={() => setView("bulletin")} className="shrink-0 rounded px-2 py-0.5 hover:bg-amber-100 dark:hover:bg-amber-900">
        Open bulletin
      </button>
      {canEdit && (
        <button
          type="button"
          onClick={() => dispatch({ kind: "board.pin", noteId: null })}
          className="shrink-0 rounded px-2 py-0.5 hover:bg-amber-100 dark:hover:bg-amber-900"
        >
          Unpin
        </button>
      )}
    </aside>
  );
}
