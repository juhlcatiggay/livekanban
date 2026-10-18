import { COLORS, LIMITS, isPositionKey, type CardPatch, type Color, type ColumnPatch, type Op } from "./board";

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
      return isId(v.id) ? { kind: v.kind, id: v.id } : null;
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
