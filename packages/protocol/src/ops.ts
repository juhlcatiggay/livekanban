import {
  CANVAS,
  COLORS,
  LIMITS,
  NOTE_SIZE,
  isPositionKey,
  type CardPatch,
  type Color,
  type ColumnPatch,
  type NotePatch,
  type Op,
} from "./board";

/** Client-generated ids for columns and cards (short nanoids). */
export const ITEM_ID_RE = /^[A-Za-z0-9_-]{8,24}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === "string" && ITEM_ID_RE.test(v);

/** Trimmed, non-empty, within `max` characters. */
function title(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 && t.length <= LIMITS.title ? t : null;
}

function color(v: unknown): Color | null | undefined {
  if (v === null) return null;
  return (COLORS as readonly unknown[]).includes(v) ? (v as Color) : undefined;
}

function isValidDate(v: string): boolean {
  if (!DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
}

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const isX = (v: unknown): v is number => isInt(v, 0, CANVAS.width - NOTE_SIZE.min);
const isY = (v: unknown): v is number => isInt(v, 0, CANVAS.height - NOTE_SIZE.min);
const isSize = (v: unknown): v is number => isInt(v, NOTE_SIZE.min, NOTE_SIZE.max);
const isNoteText = (v: unknown): v is string => typeof v === "string" && v.length <= LIMITS.description;

function notePatch(v: unknown): NotePatch | null {
  if (!isObj(v)) return null;
  const patch: NotePatch = {};
  if ("text" in v) {
    if (!isNoteText(v.text)) return null;
    patch.text = v.text;
  }
  if ("color" in v) {
    const c = color(v.color);
    if (!c) return null;
    patch.color = c;
  }
  if ("w" in v) {
    if (!isSize(v.w)) return null;
    patch.w = v.w;
  }
  if ("h" in v) {
    if (!isSize(v.h)) return null;
    patch.h = v.h;
  }
  return Object.keys(patch).length ? patch : null;
}

function columnPatch(v: unknown): ColumnPatch | null {
  if (!isObj(v)) return null;
  const patch: ColumnPatch = {};
  if ("title" in v) {
    const t = title(v.title);
    if (t === null) return null;
    patch.title = t;
  }
  if ("color" in v) {
    const c = color(v.color);
    if (c === undefined) return null;
    patch.color = c;
  }
  if ("wipLimit" in v) {
    const w = v.wipLimit;
    if (w !== null && !(Number.isInteger(w) && (w as number) >= 1 && (w as number) <= LIMITS.wipLimit)) return null;
    patch.wipLimit = w as number | null;
  }
  return Object.keys(patch).length ? patch : null;
}

function cardPatch(v: unknown): CardPatch | null {
  if (!isObj(v)) return null;
  const patch: CardPatch = {};
  if ("title" in v) {
    const t = title(v.title);
    if (t === null) return null;
    patch.title = t;
  }
  if ("description" in v) {
    if (typeof v.description !== "string" || v.description.length > LIMITS.description) return null;
    patch.description = v.description;
  }
  if ("color" in v) {
    const c = color(v.color);
    if (c === undefined) return null;
    patch.color = c;
  }
  if ("labels" in v) {
    const labels = v.labels;
    if (!Array.isArray(labels) || labels.length > LIMITS.labels) return null;
    const clean = labels.map((l) => (typeof l === "string" ? l.trim() : ""));
    if (clean.some((l) => l.length === 0 || l.length > LIMITS.label)) return null;
    patch.labels = [...new Set(clean)];
  }
  if ("assignee" in v) {
    if (typeof v.assignee !== "string" || v.assignee.length > LIMITS.assignee) return null;
    patch.assignee = v.assignee.trim();
  }
  if ("dueDate" in v) {
    const d = v.dueDate;
    if (d !== null && !(typeof d === "string" && isValidDate(d))) return null;
    patch.dueDate = d as string | null;
  }
  return Object.keys(patch).length ? patch : null;
}

/**
 * Validates the shape and bounds of an untrusted op. State-dependent rules
 * (does the column exist, limits on counts) are checked by the room.
 */
export function parseOp(v: unknown): Op | null {
  if (!isObj(v)) return null;
  switch (v.kind) {
    case "board.update": {
      const t = title(v.title);
      return t ? { kind: "board.update", title: t } : null;
    }
    case "column.create": {
      const t = title(v.title);
      return isId(v.id) && t && isPositionKey(v.position)
        ? { kind: "column.create", id: v.id, title: t, position: v.position }
        : null;
    }
    case "column.update": {
      const patch = columnPatch(v.patch);
      return isId(v.id) && patch ? { kind: "column.update", id: v.id, patch } : null;
    }
    case "column.move":
      return isId(v.id) && isPositionKey(v.position) ? { kind: "column.move", id: v.id, position: v.position } : null;
    case "column.delete":
    case "column.restore":
    case "card.delete":
    case "card.restore":
    case "note.delete":
    case "note.restore":
      return isId(v.id) ? { kind: v.kind, id: v.id } : null;
    case "note.create": {
      const c = color(v.color);
      return isId(v.id) && isX(v.x) && isY(v.y) && isSize(v.w) && isSize(v.h) && c && isNoteText(v.text)
        ? { kind: "note.create", id: v.id, x: v.x, y: v.y, w: v.w, h: v.h, color: c, text: v.text }
        : null;
    }
    case "note.update": {
      const patch = notePatch(v.patch);
      return isId(v.id) && patch ? { kind: "note.update", id: v.id, patch } : null;
    }
    case "note.move":
      return isId(v.id) && isX(v.x) && isY(v.y) ? { kind: "note.move", id: v.id, x: v.x, y: v.y } : null;
    case "board.pin":
      return v.noteId === null || isId(v.noteId) ? { kind: "board.pin", noteId: v.noteId } : null;
    case "note.toCard":
      return isId(v.id) && isId(v.cardId) && isId(v.columnId) && isPositionKey(v.position)
        ? { kind: "note.toCard", id: v.id, cardId: v.cardId, columnId: v.columnId, position: v.position }
        : null;
    case "card.toNote":
      return isId(v.id) && isId(v.noteId) && isX(v.x) && isY(v.y)
        ? { kind: "card.toNote", id: v.id, noteId: v.noteId, x: v.x, y: v.y }
        : null;
    case "card.create": {
      const t = title(v.title);
      return isId(v.id) && isId(v.columnId) && t && isPositionKey(v.position)
        ? { kind: "card.create", id: v.id, columnId: v.columnId, position: v.position, title: t }
        : null;
    }
    case "card.update": {
      const patch = cardPatch(v.patch);
      return isId(v.id) && patch ? { kind: "card.update", id: v.id, patch } : null;
    }
    case "card.move":
      return isId(v.id) && isId(v.columnId) && isPositionKey(v.position)
        ? { kind: "card.move", id: v.id, columnId: v.columnId, position: v.position }
        : null;
    default:
      return null;
  }
}
