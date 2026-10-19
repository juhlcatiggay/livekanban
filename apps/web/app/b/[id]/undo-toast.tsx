"use client";

import { useBoard } from "@/lib/board-store";
import { useUndo } from "@/lib/undo";

/** "<thing> deleted · Undo" after a delete on either tab. */
export function UndoToast() {
  const pending = useUndo((s) => s.pending);
  const clear = useUndo((s) => s.clear);
  const dispatch = useBoard((s) => s.dispatch);
  if (!pending) return null;

  return (
    <div
      role="status"
      className="fixed bottom-12 left-1/2 z-40 flex -translate-x-1/2 items-center gap-4 rounded-lg bg-gray-900 px-4 py-2.5 text-sm text-white shadow-lg dark:bg-gray-100 dark:text-gray-900"
    >
      <span>{pending.label}</span>
      <button
        type="button"
        className="font-semibold text-accent-300 hover:underline dark:text-accent-700"
        onClick={() => {
          dispatch(pending.restore);
          clear();
        }}
      >
        Undo
      </button>
    </div>
  );
}
