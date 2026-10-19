import { create } from "zustand";
import type { Op } from "@livekanban/protocol";

/** How long the "Undo" toast stays after a delete. */
const UNDO_WINDOW_MS = 8000;

interface UndoState {
  /** The latest deletion that can still be undone. */
  pending: { label: string; restore: Op } | null;
  /** Shows "<label> · Undo"; clicking Undo dispatches `restore`. */
  offer: (label: string, restore: Op) => void;
  clear: () => void;
}

let timer: ReturnType<typeof setTimeout> | undefined;

export const useUndo = create<UndoState>((set) => ({
  pending: null,
  offer: (label, restore) => {
    clearTimeout(timer);
    set({ pending: { label, restore } });
    timer = setTimeout(() => set({ pending: null }), UNDO_WINDOW_MS);
  },
  clear: () => {
    clearTimeout(timer);
    set({ pending: null });
  },
}));
