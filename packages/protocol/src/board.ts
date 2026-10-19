import { generateKeyBetween } from "fractional-indexing";

/** Fixed palette so colors render consistently and can't carry arbitrary CSS. */
export const COLORS = ["gray", "red", "amber", "green", "teal", "blue", "purple", "pink"] as const;
export type Color = (typeof COLORS)[number];

export const LIMITS = {
  columns: 50,
  cards: 2000,
  notes: 500,
  title: 200,
  description: 10_000,
  labels: 10,
  label: 30,
  assignee: 60,
  wipLimit: 999,
} as const;

export interface Column {
  id: string;
  title: string;
  /** Fractional index; sort with plain `<` (code-unit order), never localeCompare. */
  position: string;
  color: Color | null;
  wipLimit: number | null;
}

export interface Card {
  id: string;
  columnId: string;
  position: string;
  title: string;
  /** Markdown source. */
  description: string;
  color: Color | null;
  labels: string[];
  assignee: string;
  /** ISO date, YYYY-MM-DD. */
  dueDate: string | null;
  updatedAt: number;
  updatedBy: string;
}

/** Bulletin canvas size in canvas pixels; note positions are absolute within it. */
export const CANVAS = { width: 4000, height: 3000 } as const;
export const NOTE_SIZE = { min: 120, max: 640, defaultW: 220, defaultH: 180 } as const;

/** A sticky note on the bulletin canvas. */
export interface Note {
  id: string;
  /** Top-left corner in canvas pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Stacking order; the most recently moved or created note is on top. */
  z: number;
  color: Color;
  text: string;
  updatedAt: number;
  updatedBy: string;
}

/** Live (not deleted) board contents. */
export interface BoardData {
  title: string;
  columns: Record<string, Column>;
  cards: Record<string, Card>;
  notes: Record<string, Note>;
  /** Note shown as an announcement banner on the kanban tab. */
  pinnedNoteId: string | null;
}

export type ColumnPatch = Partial<Pick<Column, "title" | "color" | "wipLimit">>;
export type CardPatch = Partial<Pick<Card, "title" | "description" | "color" | "labels" | "assignee" | "dueDate">>;
export type NotePatch = Partial<Pick<Note, "text" | "color" | "w" | "h">>;

export type Op =
  | { kind: "board.update"; title: string }
  | { kind: "column.create"; id: string; title: string; position: string }
  | { kind: "column.update"; id: string; patch: ColumnPatch }
  | { kind: "column.move"; id: string; position: string }
  | { kind: "column.delete"; id: string }
  /** The room fills `column` and `cards` from storage; clients send only the id. */
  | { kind: "column.restore"; id: string; column?: Column; cards?: Card[] }
  | { kind: "card.create"; id: string; columnId: string; position: string; title: string }
  | { kind: "card.update"; id: string; patch: CardPatch }
  | { kind: "card.move"; id: string; columnId: string; position: string }
  | { kind: "card.delete"; id: string }
  /** The room fills `card` from storage; clients send only the id. */
  | { kind: "card.restore"; id: string; card?: Card }
  /** `z` is assigned by the room (top of the stack); clients may omit it. */
  | { kind: "note.create"; id: string; x: number; y: number; w: number; h: number; color: Color; text: string; z?: number }
  | { kind: "note.update"; id: string; patch: NotePatch }
  /** Moving a note also brings it to the top; the room assigns `z`. */
  | { kind: "note.move"; id: string; x: number; y: number; z?: number }
  | { kind: "note.delete"; id: string }
  /** The room fills `note` from storage; clients send only the id. */
  | { kind: "note.restore"; id: string; note?: Note }
  /** Pins a note as the kanban tab's announcement banner (null unpins). */
  | { kind: "board.pin"; noteId: string | null }
  /** Replaces a note with a card made from its text (see noteToCardFields). */
  | { kind: "note.toCard"; id: string; cardId: string; columnId: string; position: string }
  /** Replaces a card with a note made from its title and description (see cardToNoteText). */
  | { kind: "card.toNote"; id: string; noteId: string; x: number; y: number; z?: number };

export type OpKind = Op["kind"];

/** An op as committed by the room: canonical form plus its sequence number. */
export interface CommittedOp {
  seq: number;
  op: Op;
  /** Display name of the person who made the change. */
  by: string;
  at: number;
}

export const emptyBoard = (): BoardData => ({ title: "Untitled board", columns: {}, cards: {}, notes: {}, pinnedNoteId: null });

/** A note's first non-empty line becomes the card title; the full text becomes the description if there's more. */
export function noteToCardFields(text: string): { title: string; description: string } {
  const trimmed = text.trim();
  const firstLine = trimmed.split("\n").find((l) => l.trim())?.trim() ?? "";
  const title = (firstLine || "Untitled note").slice(0, LIMITS.title);
  const description = trimmed === firstLine ? "" : trimmed.slice(0, LIMITS.description);
  return { title, description };
}

/** A card's title, then its description, as note text. */
export function cardToNoteText(card: Pick<Card, "title" | "description">): string {
  const text = card.description ? `${card.title}\n\n${card.description}` : card.title;
  return text.slice(0, LIMITS.description);
}

/** Default size for a note made from a card. */
export const CONVERTED_NOTE_SIZE = { w: 260, h: 200 } as const;

export function topZ(board: Pick<BoardData, "notes">): number {
  let z = 0;
  for (const n of Object.values(board.notes)) z = Math.max(z, n.z);
  return z + 1;
}

export function byPosition<T extends { position: string; id: string }>(a: T, b: T): number {
  if (a.position !== b.position) return a.position < b.position ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Position for an item placed between two neighbours (null = start/end). */
export function positionBetween(before: string | null | undefined, after: string | null | undefined): string {
  if (before && after && before === after) return generateKeyBetween(before, null);
  return generateKeyBetween(before ?? null, after ?? null);
}

/** True if `key` is a well-formed fractional index. */
export function isPositionKey(key: unknown): key is string {
  if (typeof key !== "string" || key.length === 0 || key.length > 64) return false;
  try {
    generateKeyBetween(key, null);
    return true;
  } catch {
    return false;
  }
}

export function sortedColumns(board: BoardData): Column[] {
  return Object.values(board.columns).sort(byPosition);
}

export function cardsByColumn(board: BoardData): Record<string, Card[]> {
  const out: Record<string, Card[]> = {};
  for (const id of Object.keys(board.columns)) out[id] = [];
  for (const card of Object.values(board.cards)) out[card.columnId]?.push(card);
  for (const list of Object.values(out)) list.sort(byPosition);
  return out;
}

/**
 * Pure reducer used by clients for optimistic updates and for applying the
 * room's broadcasts. Ops that don't apply (unknown id etc.) leave the board unchanged.
 */
export function applyOp(board: BoardData, op: Op, meta: { at: number; by: string }): BoardData {
  switch (op.kind) {
    case "board.update":
      return { ...board, title: op.title };

    case "column.create":
      if (board.columns[op.id]) return board;
      return {
        ...board,
        columns: { ...board.columns, [op.id]: { id: op.id, title: op.title, position: op.position, color: null, wipLimit: null } },
      };

    case "column.update": {
      const col = board.columns[op.id];
      if (!col) return board;
      return { ...board, columns: { ...board.columns, [op.id]: { ...col, ...op.patch } } };
    }

    case "column.move": {
      const col = board.columns[op.id];
      if (!col) return board;
      return { ...board, columns: { ...board.columns, [op.id]: { ...col, position: op.position } } };
    }

    case "column.delete": {
      if (!board.columns[op.id]) return board;
      const columns = { ...board.columns };
      delete columns[op.id];
      const cards = Object.fromEntries(Object.entries(board.cards).filter(([, c]) => c.columnId !== op.id));
      return { ...board, columns, cards };
    }

    case "column.restore": {
      if (!op.column) return board;
      const cards = { ...board.cards };
      for (const c of op.cards ?? []) cards[c.id] = c;
      return { ...board, columns: { ...board.columns, [op.id]: op.column }, cards };
    }

    case "card.create":
      if (board.cards[op.id] || !board.columns[op.columnId]) return board;
      return {
        ...board,
        cards: {
          ...board.cards,
          [op.id]: {
            id: op.id,
            columnId: op.columnId,
            position: op.position,
            title: op.title,
            description: "",
            color: null,
            labels: [],
            assignee: "",
            dueDate: null,
            updatedAt: meta.at,
            updatedBy: meta.by,
          },
        },
      };

    case "card.update": {
      const card = board.cards[op.id];
      if (!card) return board;
      return {
        ...board,
        cards: { ...board.cards, [op.id]: { ...card, ...op.patch, updatedAt: meta.at, updatedBy: meta.by } },
      };
    }

    case "card.move": {
      const card = board.cards[op.id];
      if (!card || !board.columns[op.columnId]) return board;
      return {
        ...board,
        cards: { ...board.cards, [op.id]: { ...card, columnId: op.columnId, position: op.position } },
      };
    }

    case "card.delete": {
      if (!board.cards[op.id]) return board;
      const cards = { ...board.cards };
      delete cards[op.id];
      return { ...board, cards };
    }

    case "card.restore":
      if (!op.card || !board.columns[op.card.columnId]) return board;
      return { ...board, cards: { ...board.cards, [op.id]: op.card } };

    case "note.create": {
      if (board.notes[op.id]) return board;
      const { kind: _, ...fields } = op;
      const note: Note = { ...fields, z: op.z ?? topZ(board), updatedAt: meta.at, updatedBy: meta.by };
      return { ...board, notes: { ...board.notes, [op.id]: note } };
    }

    case "note.update": {
      const note = board.notes[op.id];
      if (!note) return board;
      return { ...board, notes: { ...board.notes, [op.id]: { ...note, ...op.patch, updatedAt: meta.at, updatedBy: meta.by } } };
    }

    case "note.move": {
      const note = board.notes[op.id];
      if (!note) return board;
      return { ...board, notes: { ...board.notes, [op.id]: { ...note, x: op.x, y: op.y, z: op.z ?? topZ(board) } } };
    }

    case "note.delete": {
      if (!board.notes[op.id]) return board;
      const notes = { ...board.notes };
      delete notes[op.id];
      return { ...board, notes };
    }

    case "note.restore":
      if (!op.note) return board;
      return { ...board, notes: { ...board.notes, [op.id]: op.note } };

    case "board.pin":
      return { ...board, pinnedNoteId: op.noteId };

    case "note.toCard": {
      const note = board.notes[op.id];
      if (!note || board.cards[op.cardId] || !board.columns[op.columnId]) return board;
      const notes = { ...board.notes };
      delete notes[op.id];
      const card: Card = {
        id: op.cardId,
        columnId: op.columnId,
        position: op.position,
        ...noteToCardFields(note.text),
        color: note.color,
        labels: [],
        assignee: "",
        dueDate: null,
        updatedAt: meta.at,
        updatedBy: meta.by,
      };
      return { ...board, notes, cards: { ...board.cards, [card.id]: card } };
    }

    case "card.toNote": {
      const card = board.cards[op.id];
      if (!card || board.notes[op.noteId]) return board;
      const cards = { ...board.cards };
      delete cards[op.id];
      const note: Note = {
        id: op.noteId,
        x: op.x,
        y: op.y,
        ...CONVERTED_NOTE_SIZE,
        z: op.z ?? topZ(board),
        color: card.color ?? "amber",
        text: cardToNoteText(card),
        updatedAt: meta.at,
        updatedBy: meta.by,
      };
      return { ...board, cards, notes: { ...board.notes, [note.id]: note } };
    }
  }
}
