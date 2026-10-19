import { cardsByColumn, type BoardData, type Op } from "@livekanban/protocol";

/** Undo/redo depth, per the spec's "your own last 20 actions". */
export const HISTORY_LIMIT = 20;
/** Consecutive edits to the same item's same fields within this window undo as one step. */
const COALESCE_MS = 1500;

/** Picks the current values of `keys` from `source`, for a patch that undoes `patch`. */
function previous<T extends object>(source: T, patch: Partial<T>): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(patch) as (keyof T)[]) out[k] = source[k];
  return out;
}

/**
 * The op that undoes `op`, computed against the board as it is just before
 * `op` applies. Returns null for ops that can't be undone (conversions) or
 * whose target is already gone.
 */
export function invert(board: BoardData, op: Op): Op | null {
  switch (op.kind) {
    case "board.update":
      return { kind: "board.update", title: board.title };
    case "board.pin":
      return { kind: "board.pin", noteId: board.pinnedNoteId };
    case "board.permissions":
      return { kind: "board.permissions", permissions: board.permissions };

    case "column.create":
      return { kind: "column.delete", id: op.id };
    case "column.restore":
      return { kind: "column.delete", id: op.id };
    case "column.update": {
      const col = board.columns[op.id];
      return col ? { kind: "column.update", id: op.id, patch: previous(col, op.patch) } : null;
    }
    case "column.move": {
      const col = board.columns[op.id];
      return col ? { kind: "column.move", id: op.id, position: col.position } : null;
    }
    case "column.delete": {
      const column = board.columns[op.id];
      return column ? { kind: "column.restore", id: op.id, column, cards: cardsByColumn(board)[op.id] ?? [] } : null;
    }

    case "card.create":
    case "card.restore":
      return { kind: "card.delete", id: op.id };
    case "card.update": {
      const card = board.cards[op.id];
      return card ? { kind: "card.update", id: op.id, patch: previous(card, op.patch) } : null;
    }
    case "card.move": {
      const card = board.cards[op.id];
      return card ? { kind: "card.move", id: op.id, columnId: card.columnId, position: card.position } : null;
    }
    case "card.delete": {
      const card = board.cards[op.id];
      return card ? { kind: "card.restore", id: op.id, card } : null;
    }

    case "note.create":
    case "note.restore":
      return { kind: "note.delete", id: op.id };
    case "note.update": {
      const note = board.notes[op.id];
      return note ? { kind: "note.update", id: op.id, patch: previous(note, op.patch) } : null;
    }
    case "note.move": {
      const note = board.notes[op.id];
      return note ? { kind: "note.move", id: op.id, x: note.x, y: note.y } : null;
    }
    case "note.delete": {
      const note = board.notes[op.id];
      return note ? { kind: "note.restore", id: op.id, note } : null;
    }

    case "note.toCard":
    case "card.toNote":
      return null;
  }
}

export interface HistoryEntry {
  /** What was done. */
  op: Op;
  /** What undoes it. */
  inverse: Op;
  at: number;
}

const sameFields = (a: object, b: object) => {
  const ka = Object.keys(a).sort().join();
  return ka === Object.keys(b).sort().join();
};

/** True if `next` continues typing into the same fields as `prev`, so they undo as one step. */
export function coalesces(prev: HistoryEntry | undefined, next: HistoryEntry): boolean {
  if (!prev || next.at - prev.at > COALESCE_MS) return false;
  const a = prev.op;
  const b = next.op;
  if (a.kind !== b.kind || !("patch" in a) || !("patch" in b) || a.id !== b.id) return false;
  return sameFields(a.patch, b.patch);
}
