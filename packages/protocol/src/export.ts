import { CANVAS, NOTE_SIZE, cardsByColumn, sortedColumns, type BoardData, type Op } from "./board";
import { parseOp } from "./ops";

/** Envelope for board exports; `version` bumps if the shape changes. */
export interface BoardExport {
  format: "livekanban";
  version: 1;
  exportedAt: string;
  board: BoardData;
}

export const MAX_IMPORT_BYTES = 5_000_000;

export function toExport(board: BoardData, now = new Date()): BoardExport {
  return { format: "livekanban", version: 1, exportedAt: now.toISOString(), board };
}

/** Human-readable export: columns as sections, cards as checklist items, then bulletin notes. */
export function toMarkdown(board: BoardData): string {
  const lines: string[] = [`# ${board.title}`, ""];
  const cardsIn = cardsByColumn(board);
  for (const column of sortedColumns(board)) {
    const wip = column.wipLimit ? ` (WIP ${column.wipLimit})` : "";
    lines.push(`## ${column.title}${wip}`, "");
    const cards = cardsIn[column.id] ?? [];
    if (!cards.length) lines.push("_No cards_", "");
    for (const card of cards) {
      const meta = [
        ...card.labels.map((l) => `#${l.replace(/\s+/g, "-")}`),
        ...card.assignees.map((a) => `@${a.replace(/\s+/g, "-")}`),
        card.dueDate && `due ${card.dueDate}`,
      ].filter(Boolean);
      lines.push(`- [ ] ${card.title}${meta.length ? ` — ${meta.join(" ")}` : ""}`);
      if (card.description) {
        for (const l of card.description.split("\n")) lines.push(`  ${l}`.trimEnd());
      }
    }
    lines.push("");
  }
  const notes = Object.values(board.notes).sort((a, b) => a.y - b.y || a.x - b.x);
  if (notes.length) {
    lines.push("## Bulletin", "");
    for (const note of notes) {
      const pinned = note.id === board.pinnedNoteId ? " 📌" : "";
      const [first = "", ...rest] = note.text.split("\n");
      lines.push(`- ${first}${pinned}`);
      for (const l of rest) lines.push(`  ${l}`.trimEnd());
    }
    lines.push("");
  }
  return lines.join("\n");
}

const clamp = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(Math.min(Math.max(v, min), max)) : fallback;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const values = (v: unknown): Obj[] => (isObj(v) ? Object.values(v).filter(isObj) : []);

/**
 * Turns an untrusted export into ops for a fresh board. Every op passes
 * through parseOp, and the room then commits them like live edits, so an
 * import can never write anything a person couldn't. Invalid parts are dropped.
 */
export function importToOps(data: unknown): { ops: Op[]; dropped: number } | null {
  if (!isObj(data) || data.format !== "livekanban" || data.version !== 1 || !isObj(data.board)) return null;
  const board = data.board;
  const raw: unknown[] = [];

  if (typeof board.title === "string") raw.push({ kind: "board.update", title: board.title.slice(0, 200) });

  const columns = values(board.columns).sort((a, b) => String(a.position) < String(b.position) ? -1 : 1);
  for (const c of columns) {
    raw.push({ kind: "column.create", id: c.id, title: c.title, position: c.position });
    if (c.color !== null && c.color !== undefined) raw.push({ kind: "column.update", id: c.id, patch: { color: c.color } });
    if (c.wipLimit !== null && c.wipLimit !== undefined) raw.push({ kind: "column.update", id: c.id, patch: { wipLimit: c.wipLimit } });
  }

  for (const c of values(board.cards)) {
    raw.push({ kind: "card.create", id: c.id, columnId: c.columnId, position: c.position, title: c.title, number: c.number });
    const patch: Obj = {};
    if (typeof c.description === "string" && c.description) patch.description = c.description;
    if (c.color) patch.color = c.color;
    if (Array.isArray(c.labels) && c.labels.length) patch.labels = c.labels;
    // Exports from before multiple assignees have a single `assignee` string.
    const assignees = Array.isArray(c.assignees) ? c.assignees : typeof c.assignee === "string" && c.assignee ? [c.assignee] : [];
    if (assignees.length) patch.assignees = assignees;
    if (c.dueDate) patch.dueDate = c.dueDate;
    if (Object.keys(patch).length) raw.push({ kind: "card.update", id: c.id, patch });
  }

  for (const n of values(board.notes).sort((a, b) => Number(a.z) - Number(b.z))) {
    const w = clamp(n.w, NOTE_SIZE.min, NOTE_SIZE.max, NOTE_SIZE.defaultW);
    const h = clamp(n.h, NOTE_SIZE.min, NOTE_SIZE.max, NOTE_SIZE.defaultH);
    raw.push({
      kind: "note.create",
      id: n.id,
      x: clamp(n.x, 0, CANVAS.width - NOTE_SIZE.min, 0),
      y: clamp(n.y, 0, CANVAS.height - NOTE_SIZE.min, 0),
      w,
      h,
      color: n.color,
      text: n.text,
      number: n.number,
    });
  }

  if (typeof board.pinnedNoteId === "string") raw.push({ kind: "board.pin", noteId: board.pinnedNoteId });

  const ops: Op[] = [];
  for (const r of raw) {
    const op = parseOp(r);
    if (!op) continue;
    // parseOp drops room-assigned fields; carry the original number so #mentions keep pointing at the same items.
    const n = (r as Obj).number;
    if ((op.kind === "card.create" || op.kind === "note.create") && typeof n === "number" && Number.isInteger(n) && n > 0) {
      op.number = n;
    }
    ops.push(op);
  }
  return { ops, dropped: raw.length - ops.length };
}
