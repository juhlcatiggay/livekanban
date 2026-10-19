import { pickName } from "./names";
import {
  CONVERTED_NOTE_SIZE,
  PEOPLE_COLORS,
  DEFAULT_PERMISSIONS,
  parsePermissions,
  LIMITS,
  applyChecklistOp,
  cardToNoteText,
  labelKey,
  noteToCardFields,
  positionBetween,
  type BoardData,
  type Card,
  type CardPatch,
  type ChecklistItem,
  type Color,
  type Column,
  type ColumnPatch,
  type CommittedOp,
  type Note,
  type NotePatch,
  type Op,
  type BackupInfo,
  type Permissions,
  type TrashItem,
} from "@livekanban/protocol";

/** 2: columns, cards, ops_log. 3: notes. 4: backups. 5: cards.assignees (multiple). 6: item numbers, notes.created_at. 7: members. 8: cards.start_date, cards.checklist. */
export const SCHEMA_VERSION = 8;
/** Daily backups kept (the plan's "7 days of snapshots"). */
export const BACKUPS_KEPT = 7;
/** Durable Object SQLite values max out at 2 MB; bigger boards skip the backup rather than fail. */
const MAX_BACKUP_CHARS = 1_900_000;
/** ops_log keeps this many recent ops for reconnect replay. */
export const OPS_KEPT = 1000;

type Row = Record<string, SqlStorageValue>;

interface ColumnRow extends Row {
  id: string;
  title: string;
  position: string;
  color: string | null;
  wip_limit: number | null;
  deleted_at: number | null;
}

interface CardRow extends Row {
  id: string;
  number: number;
  column_id: string;
  position: string;
  title: string;
  description: string;
  color: string | null;
  labels: string;
  /** JSON array (schema v5); the old single `assignee` column is kept but unused. */
  assignees: string;
  start_date: string | null;
  due_date: string | null;
  /** JSON array of ChecklistItem (schema v8). */
  checklist: string;
  updated_at: number;
  updated_by: string;
  deleted_at: number | null;
}

interface NoteRow extends Row {
  id: string;
  number: number;
  created_at: number;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  color: string;
  text: string;
  updated_at: number;
  updated_by: string;
  deleted_at: number | null;
}

export type CommitResult = { ok: true; committed: CommittedOp } | { ok: false; reason: string };

class Rejected extends Error {}
const reject = (reason: string): never => {
  throw new Rejected(reason);
};

const toColumn = (r: ColumnRow): Column => ({
  id: r.id,
  title: r.title,
  position: r.position,
  color: r.color as Color | null,
  wipLimit: r.wip_limit,
});

const toCard = (r: CardRow): Card => ({
  id: r.id,
  number: r.number,
  columnId: r.column_id,
  position: r.position,
  title: r.title,
  description: r.description,
  color: r.color as Color | null,
  labels: JSON.parse(r.labels) as string[],
  assignees: JSON.parse(r.assignees) as string[],
  startDate: r.start_date,
  dueDate: r.due_date,
  checklist: JSON.parse(r.checklist) as ChecklistItem[],
  updatedAt: r.updated_at,
  updatedBy: r.updated_by,
});

const toNote = (r: NoteRow): Note => ({
  id: r.id,
  number: r.number,
  createdAt: r.created_at,
  x: r.x,
  y: r.y,
  w: r.w,
  h: r.h,
  z: r.z,
  color: r.color as Color,
  text: r.text,
  updatedAt: r.updated_at,
  updatedBy: r.updated_by,
});

/**
 * Board persistence on a Durable Object's SQLite database. Plain TypeScript
 * with no Durable Object or PartyServer dependency, so it can move hosts.
 */
export class BoardStorage {
  constructor(
    private readonly sql: SqlStorage,
    private readonly transaction: <T>(fn: () => T) => T,
  ) {}

  // ---- schema and meta ----

  hasMetaTable(): boolean {
    return this.sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").toArray().length > 0;
  }

  getMeta(key: string): string | undefined {
    if (!this.hasMetaTable()) return undefined;
    return this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key).toArray()[0]?.value;
  }

  private setMeta(key: string, value: string) {
    this.sql.exec(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key,
      value,
    );
  }

  /** Creates or upgrades tables. Idempotent. */
  migrate() {
    this.transaction(() => {
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS columns (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          position TEXT NOT NULL,
          color TEXT,
          wip_limit INTEGER,
          deleted_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS cards (
          id TEXT PRIMARY KEY,
          number INTEGER NOT NULL DEFAULT 0,
          column_id TEXT NOT NULL,
          position TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          color TEXT,
          labels TEXT NOT NULL DEFAULT '[]',
          assignee TEXT NOT NULL DEFAULT '',
          assignees TEXT NOT NULL DEFAULT '[]',
          start_date TEXT,
          due_date TEXT,
          checklist TEXT NOT NULL DEFAULT '[]',
          updated_at INTEGER NOT NULL,
          updated_by TEXT NOT NULL,
          deleted_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS cards_by_column ON cards (column_id, position);
        CREATE TABLE IF NOT EXISTS notes (
          id TEXT PRIMARY KEY,
          number INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT 0,
          x INTEGER NOT NULL,
          y INTEGER NOT NULL,
          w INTEGER NOT NULL,
          h INTEGER NOT NULL,
          z INTEGER NOT NULL,
          color TEXT NOT NULL,
          text TEXT NOT NULL DEFAULT '',
          updated_at INTEGER NOT NULL,
          updated_by TEXT NOT NULL,
          deleted_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS backups (day TEXT PRIMARY KEY, at INTEGER NOT NULL, board TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS members (
          client_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          color TEXT NOT NULL,
          joined_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ops_log (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          op TEXT NOT NULL,
          actor_name TEXT NOT NULL,
          at INTEGER NOT NULL
        );
      `);
      // v5: multiple assignees. Boards created earlier get the column and keep their single assignee.
      if (this.addColumn("cards", "assignees", "TEXT NOT NULL DEFAULT '[]'")) {
        this.sql.exec("UPDATE cards SET assignees = json_array(assignee) WHERE assignee != ''");
      }
      // v6: reference numbers (#12) for cards and notes, and note creation times.
      this.addColumn("cards", "number", "INTEGER NOT NULL DEFAULT 0");
      this.addColumn("notes", "number", "INTEGER NOT NULL DEFAULT 0");
      if (this.addColumn("notes", "created_at", "INTEGER NOT NULL DEFAULT 0")) {
        this.sql.exec("UPDATE notes SET created_at = updated_at");
      }
      this.numberExistingItems();
      // v8: start dates and checklists.
      this.addColumn("cards", "start_date", "TEXT");
      this.addColumn("cards", "checklist", "TEXT NOT NULL DEFAULT '[]'");
      this.setMeta("schema_version", String(SCHEMA_VERSION));
    });
  }

  /** Gives every card and note without a number one, oldest first (cards, then notes). */
  private numberExistingItems() {
    for (const table of ["cards", "notes"]) {
      for (const r of this.sql.exec<{ id: string }>(`SELECT id FROM ${table} WHERE number = 0 ORDER BY rowid`).toArray()) {
        this.sql.exec(`UPDATE ${table} SET number = ? WHERE id = ?`, this.takeNumber(), r.id);
      }
    }
  }

  /**
   * The next free reference number. An import may ask to keep an item's
   * original number; that's honoured if it's free, and the counter moves past it.
   */
  private takeNumber(requested?: number): number {
    let next = Number(this.getMeta("next_number") ?? 1);
    let n = next;
    if (requested && requested > 0 && !this.numberTaken(requested)) n = requested;
    else while (this.numberTaken(n)) n++;
    next = Math.max(next, n + 1);
    this.setMeta("next_number", String(next));
    return n;
  }

  private numberTaken(n: number): boolean {
    return (
      this.sql.exec("SELECT 1 FROM cards WHERE number = ? UNION ALL SELECT 1 FROM notes WHERE number = ?", n, n).toArray().length > 0
    );
  }

  /** Adds a column to an existing table if it's missing. Returns true if it was added. */
  private addColumn(table: string, column: string, definition: string): boolean {
    const exists = this.sql
      .exec<{ name: string }>(`SELECT name FROM pragma_table_info('${table}')`)
      .toArray()
      .some((c) => c.name === column);
    if (exists) return false;
    this.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    return true;
  }

  needsMigration(): boolean {
    return Number(this.getMeta("schema_version") ?? 0) < SCHEMA_VERSION;
  }

  /** Initializes a brand-new board, with starter columns unless it's about to be filled by an import. */
  init(now: number, newId: () => string, { starterColumns = true, hostKey }: { starterColumns?: boolean; hostKey?: string } = {}) {
    this.migrate();
    this.transaction(() => {
      this.setMeta("created_at", String(now));
      this.setMeta("last_activity_at", String(now));
      this.setMeta("title", "Untitled board");
      // Kept only in this board's own database, which never leaves the room.
      if (hostKey) this.setMeta("host_key", hostKey);
      if (!starterColumns) return;
      let position: string | null = null;
      for (const title of ["To do", "Doing", "Done"]) {
        position = positionBetween(position, null);
        this.sql.exec("INSERT INTO columns (id, title, position) VALUES (?, ?, ?)", newId(), title, position);
      }
    });
  }

  // ---- members: everyone who has opened the board, with the name they have here ----

  /**
   * The name and color `clientId` has on this board. First-timers get their
   * own chosen name if nobody here has it, otherwise a free Marvel name; the
   * color is whichever is least used. Returning members keep what they had.
   */
  joinMember(clientId: string, wanted: { name: string; color: string; custom: boolean }, now: number): { name: string; color: string } {
    const existing = this.sql
      .exec<{ name: string; color: string }>("SELECT name, color FROM members WHERE client_id = ?", clientId)
      .toArray()[0];
    if (existing) return existing;
    const taken = new Set(this.sql.exec<{ name: string }>("SELECT name FROM members").toArray().map((m) => m.name.toLowerCase()));
    const name = wanted.custom && !taken.has(wanted.name.toLowerCase()) ? wanted.name : pickName(taken);
    const color = wanted.custom ? wanted.color : this.leastUsedColor();
    this.sql.exec("INSERT INTO members (client_id, name, color, joined_at) VALUES (?, ?, ?, ?)", clientId, name, color, now);
    return { name, color };
  }

  /** Renames a member, refusing a name someone else on this board already has. */
  renameMember(clientId: string, name: string, color: string): { ok: true } | { ok: false; reason: string } {
    const clash = this.sql
      .exec("SELECT 1 FROM members WHERE lower(name) = lower(?) AND client_id != ?", name, clientId)
      .toArray().length;
    if (clash) return { ok: false, reason: `Someone on this board is already called ${name}` };
    this.sql.exec(
      "INSERT INTO members (client_id, name, color, joined_at) VALUES (?, ?, ?, ?) ON CONFLICT(client_id) DO UPDATE SET name = excluded.name, color = excluded.color",
      clientId,
      name,
      color,
      Date.now(),
    );
    return { ok: true };
  }

  private leastUsedColor(): string {
    const counts = new Map(PEOPLE_COLORS.map((c) => [c, 0]));
    for (const m of this.sql.exec<{ color: string }>("SELECT color FROM members")) {
      if (counts.has(m.color)) counts.set(m.color, counts.get(m.color)! + 1);
    }
    const fewest = Math.min(...counts.values());
    const options = PEOPLE_COLORS.filter((c) => counts.get(c) === fewest);
    return options[Math.floor(Math.random() * options.length)];
  }

  // ---- host and permissions (issue #12) ----

  hasHost(): boolean {
    return !!this.getMeta("host_key");
  }

  /** Constant-time check of a presented host key. */
  isHostKey(key: string | undefined): boolean {
    const stored = this.getMeta("host_key");
    if (!stored || !key) return false;
    const a = new TextEncoder().encode(key);
    const b = new TextEncoder().encode(stored);
    return a.length === b.length && crypto.subtle.timingSafeEqual(a, b);
  }

  permissions(): Permissions {
    const raw = this.getMeta("permissions");
    return (raw && parsePermissions(JSON.parse(raw))) || DEFAULT_PERMISSIONS;
  }

  /** True if `id` is a live note (locks on notes need bulletin rights, on cards move rights). */
  isNote(id: string): boolean {
    return this.sql.exec("SELECT 1 FROM notes WHERE id = ? AND deleted_at IS NULL", id).toArray().length > 0;
  }

  // ---- activity, trash and backups (driven by the room's alarm) ----

  lastActivityAt(): number {
    return Number(this.getMeta("last_activity_at"));
  }

  touch(now: number) {
    this.setMeta("last_activity_at", String(now));
  }

  /** Deleted items still restorable, newest first. Cards inside a deleted column come back with it. */
  trash(): TrashItem[] {
    const items: TrashItem[] = [];
    for (const r of this.sql.exec<{ id: string; title: string; deleted_at: number; n: number }>(
      `SELECT c.id, c.title, c.deleted_at, (SELECT COUNT(*) FROM cards WHERE column_id = c.id AND deleted_at IS NULL) AS n
       FROM columns c WHERE c.deleted_at IS NOT NULL`,
    )) {
      items.push({ kind: "column", id: r.id, label: r.title, deletedAt: r.deleted_at, cardCount: r.n });
    }
    for (const r of this.sql.exec<{ id: string; title: string; deleted_at: number }>(
      `SELECT cards.id, cards.title, cards.deleted_at FROM cards JOIN columns ON columns.id = cards.column_id
       WHERE cards.deleted_at IS NOT NULL AND columns.deleted_at IS NULL`,
    )) {
      items.push({ kind: "card", id: r.id, label: r.title, deletedAt: r.deleted_at });
    }
    for (const r of this.sql.exec<{ id: string; text: string; deleted_at: number }>(
      "SELECT id, text, deleted_at FROM notes WHERE deleted_at IS NOT NULL",
    )) {
      const label = r.text.trim().split("\n")[0].slice(0, 80) || "Empty note";
      items.push({ kind: "note", id: r.id, label, deletedAt: r.deleted_at });
    }
    return items.sort((a, b) => b.deletedAt - a.deletedAt);
  }

  oldestDeletedAt(): number | null {
    return this.sql
      .exec<{ t: number | null }>(
        `SELECT MIN(t) AS t FROM (
           SELECT MIN(deleted_at) AS t FROM columns UNION ALL
           SELECT MIN(deleted_at) FROM cards UNION ALL
           SELECT MIN(deleted_at) FROM notes)`,
      )
      .one().t;
  }

  /** Permanently removes everything deleted before `before`, including cards of purged columns. */
  purgeTrash(before: number) {
    this.transaction(() => {
      this.sql.exec(
        "DELETE FROM cards WHERE column_id IN (SELECT id FROM columns WHERE deleted_at IS NOT NULL AND deleted_at < ?)",
        before,
      );
      for (const table of ["cards", "columns", "notes"]) {
        this.sql.exec(`DELETE FROM ${table} WHERE deleted_at IS NOT NULL AND deleted_at < ?`, before);
      }
    });
  }

  lastBackupAt(): number {
    return Number(this.getMeta("last_backup_at") ?? 0);
  }

  /** Saves today's (UTC) backup of the live board and keeps only the newest BACKUPS_KEPT. */
  takeBackup(now: number): boolean {
    const json = JSON.stringify(this.snapshot());
    if (json.length > MAX_BACKUP_CHARS) return false;
    const day = new Date(now).toISOString().slice(0, 10);
    this.transaction(() => {
      this.sql.exec(
        "INSERT INTO backups (day, at, board) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET at = excluded.at, board = excluded.board",
        day,
        now,
        json,
      );
      this.sql.exec(
        "DELETE FROM backups WHERE day NOT IN (SELECT day FROM backups ORDER BY day DESC LIMIT ?)",
        BACKUPS_KEPT,
      );
      this.setMeta("last_backup_at", String(now));
    });
    return true;
  }

  backups(): BackupInfo[] {
    return this.sql.exec<{ day: string; at: number }>("SELECT day, at FROM backups ORDER BY day DESC").toArray();
  }

  backup(day: string): BoardData | null {
    const row = this.sql.exec<{ board: string }>("SELECT board FROM backups WHERE day = ?", day).toArray()[0];
    return row ? (JSON.parse(row.board) as BoardData) : null;
  }

  // ---- reads ----

  private labelColors(): Record<string, Color> {
    const raw = this.getMeta("label_colors");
    return raw ? (JSON.parse(raw) as Record<string, Color>) : {};
  }

  snapshot(): BoardData {
    const columns: Record<string, Column> = {};
    for (const r of this.sql.exec<ColumnRow>("SELECT * FROM columns WHERE deleted_at IS NULL")) {
      columns[r.id] = toColumn(r);
    }
    const cards: Record<string, Card> = {};
    for (const r of this.sql.exec<CardRow>(
      `SELECT cards.* FROM cards JOIN columns ON columns.id = cards.column_id
       WHERE cards.deleted_at IS NULL AND columns.deleted_at IS NULL`,
    )) {
      cards[r.id] = toCard(r);
    }
    const notes: Record<string, Note> = {};
    for (const r of this.sql.exec<NoteRow>("SELECT * FROM notes WHERE deleted_at IS NULL")) notes[r.id] = toNote(r);
    return {
      title: this.getMeta("title") ?? "Untitled board",
      columns,
      cards,
      notes,
      pinnedNoteId: this.getMeta("pinned_note_id") || null,
      permissions: this.permissions(),
      hasHost: this.hasHost(),
      labelColors: this.labelColors(),
    };
  }

  currentSeq(): number {
    return this.sql.exec<{ seq: number }>("SELECT COALESCE(MAX(seq), 0) AS seq FROM ops_log").one().seq;
  }

  /** Ops after `lastSeq`, or null if the log no longer reaches back that far. */
  opsSince(lastSeq: number): CommittedOp[] | null {
    const current = this.currentSeq();
    if (lastSeq <= 0 || lastSeq > current) return null;
    if (lastSeq === current) return [];
    const oldest = this.sql.exec<{ seq: number }>("SELECT MIN(seq) AS seq FROM ops_log").one().seq;
    if (lastSeq < oldest - 1) return null;
    return this.sql
      .exec<{ seq: number; op: string; actor_name: string; at: number }>(
        "SELECT seq, op, actor_name, at FROM ops_log WHERE seq > ? ORDER BY seq",
        lastSeq,
      )
      .toArray()
      .map((r) => ({ seq: r.seq, op: JSON.parse(r.op) as Op, by: r.actor_name, at: r.at }));
  }

  private columnRow(id: string): ColumnRow | undefined {
    return this.sql.exec<ColumnRow>("SELECT * FROM columns WHERE id = ?", id).toArray()[0];
  }

  private cardRow(id: string): CardRow | undefined {
    return this.sql.exec<CardRow>("SELECT * FROM cards WHERE id = ?", id).toArray()[0];
  }

  private noteRow(id: string): NoteRow | undefined {
    return this.sql.exec<NoteRow>("SELECT * FROM notes WHERE id = ?", id).toArray()[0];
  }

  private liveNote(id: string): NoteRow {
    const row = this.noteRow(id);
    return row && row.deleted_at === null ? row : reject("Note not found");
  }

  /** Next stacking position: above every live note. */
  private topZ(): number {
    return this.sql.exec<{ z: number }>("SELECT COALESCE(MAX(z), 0) + 1 AS z FROM notes WHERE deleted_at IS NULL").one().z;
  }

  private checkNoteLimit() {
    if (this.count("SELECT COUNT(*) AS n FROM notes WHERE deleted_at IS NULL") >= LIMITS.notes) {
      reject(`A board can have at most ${LIMITS.notes} notes`);
    }
  }

  private insertNote(n: Note) {
    this.sql.exec(
      "INSERT INTO notes (id, number, created_at, x, y, w, h, z, color, text, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      n.id,
      n.number,
      n.createdAt,
      n.x,
      n.y,
      n.w,
      n.h,
      n.z,
      n.color,
      n.text,
      n.updatedAt,
      n.updatedBy,
    );
  }

  private liveColumn(id: string): ColumnRow {
    const row = this.columnRow(id);
    return row && row.deleted_at === null ? row : reject("Column not found");
  }

  private liveCard(id: string): CardRow {
    const row = this.cardRow(id);
    if (!row || row.deleted_at !== null) return reject("Card not found");
    this.liveColumn(row.column_id);
    return row;
  }

  private count(sql: string): number {
    return this.sql.exec<{ n: number }>(sql).one().n;
  }

  /**
   * Two people can pick the same position for different items at once. If
   * `position` is taken in the scope, move it just after the existing item.
   */
  private freePosition(table: "columns" | "cards", position: string, selfId: string, columnId?: string): string {
    const scope = table === "cards" ? "AND column_id = ?" : "";
    const scopeArgs = table === "cards" ? [columnId!] : [];
    const taken = this.sql
      .exec(`SELECT 1 FROM ${table} WHERE deleted_at IS NULL AND position = ? AND id != ? ${scope}`, position, selfId, ...scopeArgs)
      .toArray().length;
    if (!taken) return position;
    const next = this.sql
      .exec<{ position: string }>(
        `SELECT position FROM ${table} WHERE deleted_at IS NULL AND position > ? AND id != ? ${scope} ORDER BY position LIMIT 1`,
        position,
        selfId,
        ...scopeArgs,
      )
      .toArray()[0]?.position;
    return positionBetween(position, next ?? null);
  }

  // ---- writes ----

  /**
   * Validates `op` against current state, applies it, and appends it to the
   * ops log, all in one transaction. Returns the canonical committed op.
   */
  commit(op: Op, actor: string, now: number): CommitResult {
    try {
      return this.transaction(() => {
        const canonical = this.apply(op, actor, now);
        const seq = this.sql
          .exec<{ seq: number }>(
            "INSERT INTO ops_log (op, actor_name, at) VALUES (?, ?, ?) RETURNING seq",
            JSON.stringify(canonical),
            actor,
            now,
          )
          .one().seq;
        if (seq % 100 === 0) this.sql.exec("DELETE FROM ops_log WHERE seq <= ?", seq - OPS_KEPT);
        return { ok: true as const, committed: { seq, op: canonical, by: actor, at: now } };
      });
    } catch (err) {
      if (err instanceof Rejected) return { ok: false, reason: err.message };
      throw err;
    }
  }

  private apply(op: Op, actor: string, now: number): Op {
    switch (op.kind) {
      case "board.update":
        this.setMeta("title", op.title);
        return op;

      case "column.create": {
        if (this.columnRow(op.id)) reject("Column already exists");
        if (this.count("SELECT COUNT(*) AS n FROM columns WHERE deleted_at IS NULL") >= LIMITS.columns) {
          reject(`A board can have at most ${LIMITS.columns} columns`);
        }
        const position = this.freePosition("columns", op.position, op.id);
        this.sql.exec("INSERT INTO columns (id, title, position) VALUES (?, ?, ?)", op.id, op.title, position);
        return { ...op, position };
      }

      case "column.update": {
        this.liveColumn(op.id);
        this.updateColumn(op.id, op.patch);
        return op;
      }

      case "column.move": {
        this.liveColumn(op.id);
        const position = this.freePosition("columns", op.position, op.id);
        this.sql.exec("UPDATE columns SET position = ? WHERE id = ?", position, op.id);
        return { ...op, position };
      }

      case "column.delete":
        this.liveColumn(op.id);
        this.sql.exec("UPDATE columns SET deleted_at = ? WHERE id = ?", now, op.id);
        return op;

      case "column.restore": {
        const row = this.columnRow(op.id);
        if (!row || row.deleted_at === null) reject("Nothing to restore");
        if (this.count("SELECT COUNT(*) AS n FROM columns WHERE deleted_at IS NULL") >= LIMITS.columns) {
          reject(`A board can have at most ${LIMITS.columns} columns`);
        }
        const position = this.freePosition("columns", row!.position, op.id);
        this.sql.exec("UPDATE columns SET deleted_at = NULL, position = ? WHERE id = ?", position, op.id);
        const cards = this.sql
          .exec<CardRow>("SELECT * FROM cards WHERE column_id = ? AND deleted_at IS NULL", op.id)
          .toArray()
          .map(toCard);
        return { kind: "column.restore", id: op.id, column: toColumn({ ...row!, position, deleted_at: null }), cards };
      }

      case "card.create": {
        if (this.cardRow(op.id)) reject("Card already exists");
        this.liveColumn(op.columnId);
        this.checkCardLimit();
        const position = this.freePosition("cards", op.position, op.id, op.columnId);
        const number = this.takeNumber(op.number);
        this.sql.exec(
          "INSERT INTO cards (id, number, column_id, position, title, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
          op.id,
          number,
          op.columnId,
          position,
          op.title,
          now,
          actor,
        );
        return { ...op, position, number };
      }

      case "card.update":
        this.liveCard(op.id);
        this.updateCard(op.id, op.patch, actor, now);
        return op;

      case "card.move": {
        this.liveCard(op.id);
        this.liveColumn(op.columnId);
        const position = this.freePosition("cards", op.position, op.id, op.columnId);
        this.sql.exec("UPDATE cards SET column_id = ?, position = ? WHERE id = ?", op.columnId, position, op.id);
        return { ...op, position };
      }

      case "card.delete":
        this.liveCard(op.id);
        this.sql.exec("UPDATE cards SET deleted_at = ? WHERE id = ?", now, op.id);
        return op;

      case "card.restore": {
        const row = this.cardRow(op.id);
        if (!row || row.deleted_at === null) reject("Nothing to restore");
        this.liveColumn(row!.column_id);
        this.checkCardLimit();
        const position = this.freePosition("cards", row!.position, op.id, row!.column_id);
        this.sql.exec("UPDATE cards SET deleted_at = NULL, position = ? WHERE id = ?", position, op.id);
        return { kind: "card.restore", id: op.id, card: toCard({ ...row!, position, deleted_at: null }) };
      }

      case "note.create": {
        if (this.noteRow(op.id)) reject("Note already exists");
        this.checkNoteLimit();
        const z = this.topZ();
        const number = this.takeNumber(op.number);
        this.insertNote({ ...op, number, z, createdAt: now, updatedAt: now, updatedBy: actor });
        return { ...op, z, number };
      }

      case "note.update":
        this.liveNote(op.id);
        this.updateNote(op.id, op.patch, actor, now);
        return op;

      case "note.move": {
        this.liveNote(op.id);
        const z = this.topZ();
        this.sql.exec("UPDATE notes SET x = ?, y = ?, z = ? WHERE id = ?", op.x, op.y, z, op.id);
        return { ...op, z };
      }

      case "note.delete":
        this.liveNote(op.id);
        this.sql.exec("UPDATE notes SET deleted_at = ? WHERE id = ?", now, op.id);
        return op;

      case "note.restore": {
        const row = this.noteRow(op.id);
        if (!row || row.deleted_at === null) reject("Nothing to restore");
        this.checkNoteLimit();
        this.sql.exec("UPDATE notes SET deleted_at = NULL WHERE id = ?", op.id);
        return { kind: "note.restore", id: op.id, note: toNote({ ...row!, deleted_at: null }) };
      }

      case "board.permissions":
        // Who may send this is checked by the room; storage just records it.
        this.setMeta("permissions", JSON.stringify(op.permissions));
        return op;

      case "board.pin":
        if (op.noteId) this.liveNote(op.noteId);
        this.setMeta("pinned_note_id", op.noteId ?? "");
        return op;

      case "note.toCard": {
        const note = this.liveNote(op.id);
        if (this.cardRow(op.cardId)) reject("Card already exists");
        this.liveColumn(op.columnId);
        this.checkCardLimit();
        const position = this.freePosition("cards", op.position, op.cardId, op.columnId);
        const { title, description } = noteToCardFields(note.text);
        // Converted, not deleted: remove the note outright so the trash can't offer a duplicate.
        this.sql.exec("DELETE FROM notes WHERE id = ?", op.id);
        const number = this.takeNumber();
        this.sql.exec(
          `INSERT INTO cards (id, number, column_id, position, title, description, color, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          op.cardId,
          number,
          op.columnId,
          position,
          title,
          description,
          note.color,
          now,
          actor,
        );
        return { ...op, position, number };
      }

      case "checklist.add":
      case "checklist.update":
      case "checklist.delete": {
        const card = toCard(this.liveCard(op.id));
        if (op.kind === "checklist.add" && card.checklist.length >= LIMITS.checklist) {
          reject(`A card can have at most ${LIMITS.checklist} checklist items`);
        }
        const checklist = applyChecklistOp(card.checklist, op);
        if (!checklist) reject(op.kind === "checklist.add" ? "Checklist item already exists" : "That checklist item was removed");
        this.sql.exec(
          "UPDATE cards SET checklist = ?, updated_at = ?, updated_by = ? WHERE id = ?",
          JSON.stringify(checklist),
          now,
          actor,
          op.id,
        );
        return op;
      }

      case "label.color": {
        const colors = this.labelColors();
        const key = labelKey(op.label);
        if (op.color) {
          if (!(key in colors) && Object.keys(colors).length >= LIMITS.labelColors) {
            reject(`A board can have at most ${LIMITS.labelColors} label colors`);
          }
          colors[key] = op.color;
        } else delete colors[key];
        this.setMeta("label_colors", JSON.stringify(colors));
        return op;
      }

      case "card.toNote": {
        const card = toCard(this.liveCard(op.id));
        if (this.noteRow(op.noteId)) reject("Note already exists");
        this.checkNoteLimit();
        const z = this.topZ();
        this.sql.exec("DELETE FROM cards WHERE id = ?", op.id);
        const number = this.takeNumber();
        this.insertNote({
          id: op.noteId,
          number,
          createdAt: now,
          x: op.x,
          y: op.y,
          ...CONVERTED_NOTE_SIZE,
          z,
          color: card.color ?? "amber",
          text: cardToNoteText(card),
          updatedAt: now,
          updatedBy: actor,
        });
        return { ...op, z, number };
      }
    }
  }

  private updateNote(id: string, patch: NotePatch, actor: string, now: number) {
    const sets = ["updated_at = ?", "updated_by = ?"];
    const args: SqlStorageValue[] = [now, actor];
    if (patch.text !== undefined) sets.push("text = ?"), args.push(patch.text);
    if (patch.color !== undefined) sets.push("color = ?"), args.push(patch.color);
    if (patch.w !== undefined) sets.push("w = ?"), args.push(patch.w);
    if (patch.h !== undefined) sets.push("h = ?"), args.push(patch.h);
    this.sql.exec(`UPDATE notes SET ${sets.join(", ")} WHERE id = ?`, ...args, id);
  }

  private checkCardLimit() {
    if (this.count("SELECT COUNT(*) AS n FROM cards WHERE deleted_at IS NULL") >= LIMITS.cards) {
      reject(`A board can have at most ${LIMITS.cards} cards`);
    }
  }

  private updateColumn(id: string, patch: ColumnPatch) {
    const sets: string[] = [];
    const args: SqlStorageValue[] = [];
    if (patch.title !== undefined) sets.push("title = ?"), args.push(patch.title);
    if (patch.color !== undefined) sets.push("color = ?"), args.push(patch.color);
    if (patch.wipLimit !== undefined) sets.push("wip_limit = ?"), args.push(patch.wipLimit);
    this.sql.exec(`UPDATE columns SET ${sets.join(", ")} WHERE id = ?`, ...args, id);
  }

  private updateCard(id: string, patch: CardPatch, actor: string, now: number) {
    const sets = ["updated_at = ?", "updated_by = ?"];
    const args: SqlStorageValue[] = [now, actor];
    if (patch.title !== undefined) sets.push("title = ?"), args.push(patch.title);
    if (patch.description !== undefined) sets.push("description = ?"), args.push(patch.description);
    if (patch.color !== undefined) sets.push("color = ?"), args.push(patch.color);
    if (patch.labels !== undefined) sets.push("labels = ?"), args.push(JSON.stringify(patch.labels));
    if (patch.assignees !== undefined) sets.push("assignees = ?"), args.push(JSON.stringify(patch.assignees));
    if (patch.startDate !== undefined) sets.push("start_date = ?"), args.push(patch.startDate);
    if (patch.dueDate !== undefined) sets.push("due_date = ?"), args.push(patch.dueDate);
    this.sql.exec(`UPDATE cards SET ${sets.join(", ")} WHERE id = ?`, ...args, id);
  }
}
