import { generateKeyBetween } from "fractional-indexing";

/** Fixed palette so colors render consistently and can't carry arbitrary CSS. */
export const COLORS = ["gray", "red", "amber", "green", "teal", "blue", "purple", "pink"] as const;
export type Color = (typeof COLORS)[number];

export const LIMITS = {
  columns: 50,
  cards: 2000,
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

/** Live (not deleted) board contents. */
export interface BoardData {
  title: string;
  columns: Record<string, Column>;
  cards: Record<string, Card>;
}

export type ColumnPatch = Partial<Pick<Column, "title" | "color" | "wipLimit">>;
export type CardPatch = Partial<Pick<Card, "title" | "description" | "color" | "labels" | "assignee" | "dueDate">>;

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
  | { kind: "card.restore"; id: string; card?: Card };

export type OpKind = Op["kind"];

/** An op as committed by the room: canonical form plus its sequence number. */
export interface CommittedOp {
  seq: number;
  op: Op;
  /** Display name of the person who made the change. */
  by: string;
  at: number;
}

export const emptyBoard = (): BoardData => ({ title: "Untitled board", columns: {}, cards: {} });

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
  }
}
