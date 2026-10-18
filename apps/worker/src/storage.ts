import {
  LIMITS,
  positionBetween,
  type BoardData,
  type Card,
  type CardPatch,
  type Color,
  type Column,
  type ColumnPatch,
  type CommittedOp,
  type Op,
} from "@livekanban/protocol";

export const SCHEMA_VERSION = 2;
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
  column_id: string;
  position: string;
  title: string;
  description: string;
  color: string | null;
  labels: string;
  assignee: string;
  due_date: string | null;
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
  columnId: r.column_id,
  position: r.position,
  title: r.title,
  description: r.description,
  color: r.color as Color | null,
  labels: JSON.parse(r.labels) as string[],
  assignee: r.assignee,
  dueDate: r.due_date,
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
          column_id TEXT NOT NULL,
          position TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          color TEXT,
          labels TEXT NOT NULL DEFAULT '[]',
          assignee TEXT NOT NULL DEFAULT '',
          due_date TEXT,
          updated_at INTEGER NOT NULL,
          updated_by TEXT NOT NULL,
          deleted_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS cards_by_column ON cards (column_id, position);
        CREATE TABLE IF NOT EXISTS ops_log (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          op TEXT NOT NULL,
          actor_name TEXT NOT NULL,
          at INTEGER NOT NULL
        );
      `);
      this.setMeta("schema_version", String(SCHEMA_VERSION));
    });
  }

  needsMigration(): boolean {
    return Number(this.getMeta("schema_version") ?? 0) < SCHEMA_VERSION;
  }

  /** Initializes a brand-new board with starter columns. */
  init(now: number, newId: () => string) {
    this.migrate();
    this.transaction(() => {
      this.setMeta("created_at", String(now));
      this.setMeta("last_activity_at", String(now));
      this.setMeta("title", "Untitled board");
      let position: string | null = null;
      for (const title of ["To do", "Doing", "Done"]) {
        position = positionBetween(position, null);
        this.sql.exec("INSERT INTO columns (id, title, position) VALUES (?, ?, ?)", newId(), title, position);
      }
    });
  }

  // ---- reads ----

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
    return { title: this.getMeta("title") ?? "Untitled board", columns, cards };
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
        this.sql.exec(
          "INSERT INTO cards (id, column_id, position, title, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)",
          op.id,
          op.columnId,
          position,
          op.title,
          now,
          actor,
        );
        return { ...op, position };
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
    }
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
    if (patch.assignee !== undefined) sets.push("assignee = ?"), args.push(patch.assignee);
    if (patch.dueDate !== undefined) sets.push("due_date = ?"), args.push(patch.dueDate);
    this.sql.exec(`UPDATE cards SET ${sets.join(", ")} WHERE id = ?`, ...args, id);
  }
}
