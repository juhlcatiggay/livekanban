import { COLORS, PERMISSION_LABELS, opTarget, type BoardData, type CardPatch, type CommittedOp, type Permission } from "@livekanban/protocol";

/** One line of history: who did what to what. */
export interface HistoryLine {
  seq: number;
  at: number;
  by: string;
  /** What happened, after the person's name ("moved “Fix login” from To do to Doing"). */
  text: string;
  /** The card or note it's about, if it still exists (to jump to it). */
  target: { kind: "card" | "note"; id: string } | null;
  /** How many changes this line stands for (typing saves every 300 ms; those are merged). */
  count: number;
}

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const day = (iso: string) => dateFormat.format(new Date(`${iso}T00:00:00Z`));
const q = (text: string | undefined, fallback: string) => (text ? `“${text.length > 60 ? `${text.slice(0, 59)}…` : text}”` : fallback);

const FIELD_NAMES: Record<keyof CardPatch, string> = {
  title: "title",
  description: "description",
  color: "color",
  labels: "labels",
  assignees: "assignees",
  startDate: "start date",
  dueDate: "due date",
};

function cardUpdate(patch: CardPatch, card: string): string {
  const keys = Object.keys(patch) as (keyof CardPatch)[];
  if (keys.length === 1) {
    const [k] = keys;
    if (k === "title") return `renamed ${card} to ${q(patch.title, "")}`;
    if (k === "dueDate") return patch.dueDate ? `set the due date of ${card} to ${day(patch.dueDate)}` : `removed the due date of ${card}`;
    if (k === "startDate") return patch.startDate ? `set the start date of ${card} to ${day(patch.startDate)}` : `removed the start date of ${card}`;
    if (k === "color") return patch.color ? `made ${card} ${patch.color}` : `removed the color of ${card}`;
    if (k === "labels") return patch.labels?.length ? `set the labels of ${card} to ${patch.labels.join(", ")}` : `removed the labels of ${card}`;
    if (k === "assignees") return patch.assignees?.length ? `assigned ${card} to ${patch.assignees.join(", ")}` : `unassigned ${card}`;
    if (k === "description") return `edited the description of ${card}`;
  }
  return `edited the ${keys.map((k) => FIELD_NAMES[k]).join(" and ")} of ${card}`;
}

/** The sentence for one committed change. Uses names captured when it happened, falling back to the board as it is now. */
export function describe(c: CommittedOp, board: Pick<BoardData, "cards" | "notes" | "columns"> | null): string {
  const { op, detail = {} } = c;
  const cardNow = "id" in op ? board?.cards[op.id]?.title : undefined;
  const card = q(detail.card ?? cardNow, "a card");
  const column = q(detail.column ?? ("id" in op ? board?.columns[op.id]?.title : undefined), "a column");
  const note = q(detail.note, "a note");
  switch (op.kind) {
    case "board.update":
      return `renamed the board to ${q(op.title, "")}`;
    case "board.permissions": {
      const off = (Object.keys(op.permissions) as Permission[]).filter((p) => !op.permissions[p]);
      return off.length ? `stopped others from being able to ${off.map((p) => PERMISSION_LABELS[p]).join(", ")}` : "let everyone change everything";
    }
    case "board.pin":
      return op.noteId ? `pinned ${note} as the announcement` : `unpinned ${note}`;
    case "column.create":
      return `added the column ${q(op.title, "")}`;
    case "column.update":
      if (op.patch.title !== undefined) return `renamed the column ${column} to ${q(op.patch.title, "")}`;
      if (op.patch.wipLimit !== undefined) return op.patch.wipLimit ? `set the WIP limit of ${column} to ${op.patch.wipLimit}` : `removed the WIP limit of ${column}`;
      return `changed the color of ${column}`;
    case "column.move":
      return `moved the column ${column}`;
    case "column.delete":
      return `deleted the column ${column}`;
    case "column.restore":
      return `restored the column ${column}`;
    case "card.create":
      return `added ${q(op.title, "a card")}${detail.column ? ` to ${detail.column}` : ""}`;
    case "card.update":
      return cardUpdate(op.patch, card);
    case "card.move":
      return detail.to && detail.column && detail.to !== detail.column
        ? `moved ${card} from ${detail.column} to ${detail.to}`
        : `moved ${card}${detail.column ? ` within ${detail.column}` : ""}`;
    case "card.delete":
      return `deleted ${card}`;
    case "card.restore":
      return `restored ${card}`;
    case "card.toNote":
      return `turned the card ${card} into a note`;
    case "checklist.add":
      return `added ${q(op.item.text, "an item")} to the checklist of ${card}`;
    case "checklist.update":
      if (op.patch.done !== undefined && op.patch.text === undefined) {
        return `${op.patch.done ? "checked" : "unchecked"} ${q(detail.item, "an item")} on ${card}`;
      }
      return `edited the checklist item ${q(detail.item, "")} on ${card}`;
    case "checklist.delete":
      return `removed ${q(detail.item, "an item")} from the checklist of ${card}`;
    case "label.color":
      return op.color && (COLORS as readonly string[]).includes(op.color) ? `made the label “${op.label}” ${op.color}` : `reset the color of the label “${op.label}”`;
    case "note.create":
      return `added the note ${note}`;
    case "note.update":
      return op.patch.text !== undefined ? `edited the note ${note}` : op.patch.color ? `recolored the note ${note}` : `resized the note ${note}`;
    case "note.move":
      return `moved the note ${note}`;
    case "note.delete":
      return `deleted the note ${note}`;
    case "note.restore":
      return `restored the note ${note}`;
    case "note.toCard":
      return `turned the note ${note} into a card${detail.to ? ` in ${detail.to}` : ""}`;
  }
}

/** Same person, same change to the same thing, within this long: shown as one line. */
const MERGE_MS = 10 * 60_000;

function mergeKey(c: CommittedOp): string | null {
  const { op } = c;
  if (op.kind === "card.update" || op.kind === "note.update" || op.kind === "column.update") {
    return `${op.kind}:${op.id}:${Object.keys(op.patch).sort().join()}`;
  }
  if (op.kind === "note.move" || op.kind === "column.move") return `${op.kind}:${op.id}`;
  if (op.kind === "checklist.update" && op.patch.text !== undefined) return `${op.kind}:${op.id}:${op.itemId}`;
  return null;
}

/**
 * History lines from newest-first entries: rapid repeats (typing, nudging a
 * note) collapse into one line that keeps the newest wording.
 */
export function historyLines(entries: CommittedOp[], board: BoardData | null): HistoryLine[] {
  const lines: (HistoryLine & { key: string | null })[] = [];
  for (const c of entries) {
    const key = mergeKey(c);
    const prev = lines.at(-1);
    if (key && prev && prev.key === key && prev.by === c.by && prev.at - c.at < MERGE_MS) {
      prev.count++;
      continue;
    }
    const id = opTarget(c.op);
    const target = id && board?.cards[id] ? { kind: "card" as const, id } : id && board?.notes[id] ? { kind: "note" as const, id } : null;
    lines.push({ seq: c.seq, at: c.at, by: c.by, text: describe(c, board), target, count: 1, key });
  }
  return lines.map(({ seq, at, by, text, target, count }) => ({ seq, at, by, text, target, count }));
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** "just now", "5 minutes ago", "yesterday", or a date for anything older than a week. */
export function ago(at: number, now = Date.now()): string {
  const s = Math.round((at - now) / 1000);
  if (s > -45) return "just now";
  const m = Math.round(s / 60);
  if (m > -60) return relative.format(m, "minute");
  const h = Math.round(m / 60);
  if (h > -24) return relative.format(h, "hour");
  const d = Math.round(h / 24);
  if (d > -7) return relative.format(d, "day");
  return timeFormat.format(at);
}

export const exactTime = (at: number) => timeFormat.format(at);
