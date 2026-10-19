import { Server, type Connection, type ConnectionContext } from "partyserver";
import { nanoid } from "nanoid";
import {
  CURSOR_TICK_MS,
  CloseCode,
  HISTORY_PAGE,
  MAX_CONNECTIONS,
  MAX_MESSAGE_LENGTH,
  encode,
  isAllowed,
  parseClientMessage,
  type ClientMessage,
  type CursorEntry,
  type Permissions,
  type Op,
  type OpKind,
  type Peer,
  type ServerMessage,
  type Sync,
} from "@livekanban/protocol";
import { roomTimings, type RoomTimings } from "./config";
import { hashPassword, verifyPassword } from "./password";
import { BoardStorage } from "./storage";

/** Connection state: the public peer plus this browser's client ID, which is never sent to others. */
type ConnState = Peer & { clientId: string };

/** What others may see of a connection. */
function publicPeer({ clientId: _, ...peer }: ConnState): Peer {
  return peer;
}

/** Wrong passwords allowed per board per window, before everyone has to wait. */
/**
 * Wrong-password limits. Per network address, so one person guessing (or
 * deliberately failing) can't lock everyone else out; plus a looser ceiling
 * per board that bounds the CPU spent on password checks.
 */
const PASSWORD_ATTEMPTS_PER_IP = 10;
const PASSWORD_ATTEMPTS_PER_BOARD = 60;
const PASSWORD_WINDOW_MS = 60_000;

/** What the create endpoint sends to /init. Already validated by the Worker. */
interface InitBody {
  ops?: Op[];
  hostKey?: string;
  title?: string;
  permissions?: Permissions;
  password?: string;
}

/** A drag lock lapses if its holder hasn't moved the pointer for this long. */
const LOCK_STALE_MS = 15_000;
/** Ops that a drag lock blocks for everyone but the holder. */
const HELD_KINDS = new Set<OpKind>(["card.move", "card.delete", "card.toNote", "note.move", "note.delete", "note.toCard"]);
/** Ops that put something in the trash, so the purge alarm may need to move earlier. */
const DELETE_KINDS = new Set<OpKind>(["column.delete", "card.delete", "note.delete"]);

/** Per-connection limits from the plan: 60 presence messages/s and 10 ops/s, with a little burst room. */
const RATE = {
  presence: { perSecond: 60, burst: 60 },
  ops: { perSecond: 10, burst: 20 },
  /** Dropped messages within 10 s before the socket is closed as abusive. */
  abuseDrops: 600,
} as const;

interface Bucket {
  presence: number;
  ops: number;
  at: number;
  dropped: number;
  windowStart: number;
}

/**
 * One Durable Object per board. Presence lives in each socket's attachment
 * (connection state); board data lives in this object's SQLite database.
 *
 * One alarm drives three jobs, always set to whichever is due first:
 * expiry (60 days without activity), trash purge (7 days after deletion)
 * and daily backups (when there was activity since the last one).
 */
export class BoardRoom extends Server<Env> {
  static options = { hibernate: true };

  private readonly store = new BoardStorage(this.ctx.storage.sql, (fn) => this.ctx.storage.transactionSync(fn));
  private readonly timings: RoomTimings = roomTimings(this.env);

  /**
   * Last cursor message time per connection, for lock staleness. In memory only:
   * after hibernation it is empty, which correctly treats every lock as stale
   * (nobody has sent anything for a while).
   */
  private readonly lastMove = new Map<string, number>();
  /** Connections whose password is being checked. */
  private readonly checkingPassword = new Set<string>();
  /** Recent wrong passwords for this board, from anyone; in memory (a restart forgets them, which only helps briefly). */
  private passwordFailures: { at: number; ip: string }[] = [];
  /** Network address per connection, for password limits. In memory: after hibernation, "unknown". */
  private readonly ips = new Map<string, string>();
  /** Rate-limit buckets; in memory, so they reset after hibernation (when nobody is sending). */
  private readonly buckets = new Map<string, Bucket>();
  /** Latest cursor per connection since the last flush (latest wins). */
  private readonly cursorBatch = new Map<string, CursorEntry>();
  private cursorFlush: ReturnType<typeof setTimeout> | null = null;
  private lastCursorFlush = 0;

  /**
   * Leading-edge throttle: a cursor goes out immediately if nothing was sent in
   * the last tick, so quiet rooms add no delay; under load, cursors arriving
   * within a tick share the next flush.
   */
  private scheduleCursorFlush() {
    if (this.cursorFlush) return;
    const wait = this.lastCursorFlush + CURSOR_TICK_MS - Date.now();
    if (wait <= 0) this.flushCursors();
    else this.cursorFlush = setTimeout(() => this.flushCursors(), wait);
  }

  /** Sends everyone one message with every cursor that moved since the last flush. */
  private flushCursors() {
    this.cursorFlush = null;
    this.lastCursorFlush = Date.now();
    if (!this.cursorBatch.size) return;
    const msg = JSON.stringify(["C", [...this.cursorBatch.values()]]);
    this.cursorBatch.clear();
    this.broadcast(msg);
  }

  /** A board exists only if the create endpoint initialized it; visiting a URL never creates one. */
  private isInitialized(): boolean {
    return this.store.getMeta("created_at") !== undefined;
  }

  private keptUntil(): number {
    return this.store.lastActivityAt() + this.timings.expiryMs;
  }

  /** Drop anything an unknown or expired ID wrote (e.g. PartyServer's name record). */
  private async forget() {
    await this.ctx.storage.deleteAll();
  }

  private send(conn: Connection, msg: ServerMessage) {
    conn.send(encode(msg));
  }

  /** Updates a peer's state and tells everyone, including that peer. */
  private updatePeer(conn: Connection<ConnState>, patch: Partial<Peer>) {
    const prev = conn.state as ConnState;
    const next: ConnState = { ...prev, ...patch };
    if ((Object.keys(patch) as (keyof Peer)[]).every((k) => prev[k] === next[k])) return;
    conn.setState(next);
    this.broadcast(encode({ t: "peer", peer: publicPeer(next) }));
  }

  /** The other connection actively holding `cardId`, if any. Stale locks are released. */
  private holderOf(cardId: string, except: string): Connection<ConnState> | undefined {
    for (const other of this.getConnections<ConnState>()) {
      if (other.id === except || other.state?.holding !== cardId) continue;
      const moved = this.lastMove.get(other.id);
      if (moved !== undefined && Date.now() - moved < LOCK_STALE_MS) return other;
      this.updatePeer(other, { holding: null });
    }
    return undefined;
  }

  // ---- activity, expiry, trash and backups ----

  /**
   * Opening or changing the board counts as activity. last_activity_at is
   * written at most once per touch interval (an hour in production).
   */
  private touch(now = Date.now()) {
    if (now - this.store.lastActivityAt() < this.timings.touchEveryMs) return;
    this.store.touch(now);
    this.broadcast(encode({ t: "kept", keptUntil: this.keptUntil() }));
    this.ctx.waitUntil(this.schedule());
  }

  /**
   * Points the alarm at the earliest due job. An alarm write is billed, so it
   * only moves earlier: a later due time (the usual case, since activity
   * pushes expiry out) waits for the current alarm, which reschedules itself.
   */
  private async schedule() {
    const t = this.timings;
    const now = Date.now();
    const due = [this.keptUntil()];
    const oldest = this.store.oldestDeletedAt();
    if (oldest !== null) due.push(oldest + t.trashMs);
    const lastBackup = this.store.lastBackupAt();
    if (this.store.lastActivityAt() > lastBackup) {
      due.push((lastBackup || Number(this.store.getMeta("created_at"))) + t.backupEveryMs);
    }
    const next = Math.max(Math.min(...due), now + 1000);
    const current = await this.ctx.storage.getAlarm();
    if (current === null || next < current) await this.ctx.storage.setAlarm(next);
  }

  async onAlarm() {
    if (!this.isInitialized()) return;
    const now = Date.now();
    // Someone still connected is a visit, so the board stays.
    if ([...this.getConnections()].length > 0) this.touch(now);
    else if (now >= this.keptUntil()) {
      // Removes the database and the alarm; later visits find no created_at and see "expired".
      await this.ctx.storage.deleteAll();
      return;
    }
    this.store.purgeTrash(now - this.timings.trashMs);
    const lastBackup = this.store.lastBackupAt() || Number(this.store.getMeta("created_at"));
    if (this.store.lastActivityAt() > this.store.lastBackupAt() && now >= lastBackup + this.timings.backupEveryMs) {
      this.store.takeBackup(now);
    }
    await this.schedule();
  }

  // ---- rate limits ----

  /** Token bucket per connection. Repeated flooding closes the socket. */
  private allow(conn: Connection, kind: "presence" | "ops"): boolean {
    const now = Date.now();
    const b = this.buckets.get(conn.id) ?? {
      presence: RATE.presence.burst,
      ops: RATE.ops.burst,
      at: now,
      dropped: 0,
      windowStart: now,
    };
    const elapsed = (now - b.at) / 1000;
    b.presence = Math.min(RATE.presence.burst, b.presence + elapsed * RATE.presence.perSecond);
    b.ops = Math.min(RATE.ops.burst, b.ops + elapsed * RATE.ops.perSecond);
    b.at = now;
    this.buckets.set(conn.id, b);
    if (b[kind] >= 1) {
      b[kind] -= 1;
      return true;
    }
    if (now - b.windowStart > 10_000) {
      b.windowStart = now;
      b.dropped = 0;
    }
    if (++b.dropped > RATE.abuseDrops) conn.close(CloseCode.RateLimited, "Too many messages");
    return false;
  }

  // ---- lifecycle ----

  /** Lets `conn` in: picks its name, then sends the board and announces it. */
  private welcome(conn: Connection<ConnState>, msg: Extract<ClientMessage, { t: "hello" }>) {
    if (conn.state) return;
    // Names are per board and unique on it: the room decides, and remembers it for next time.
    const { name, color } = this.store.joinMember(msg.clientId, msg, Date.now());
    const state: ConnState = {
      connectionId: conn.id,
      clientId: msg.clientId,
      name,
      color,
      editing: null,
      holding: null,
      idle: false,
      away: false,
      host: this.store.isHostKey(msg.hostKey),
    };
    conn.setState(state);
    const peer = publicPeer(state);
    this.touch();
    const peers: Peer[] = [];
    for (const other of this.getConnections<ConnState>()) {
      if (other.id !== conn.id && other.state) peers.push(publicPeer(other.state as ConnState));
    }
    this.send(conn, {
      t: "welcome",
      self: conn.id,
      you: peer,
      peers,
      createdAt: Number(this.store.getMeta("created_at")),
      keptUntil: this.keptUntil(),
      sync: this.syncFor(msg.lastSeq),
      locked: this.store.passwordRecord() !== null,
    });
    this.broadcast(encode({ t: "join", peer }), [conn.id]);
  }

  onStart() {
    // Boards created before a schema change are upgraded on first wake.
    if (this.isInitialized() && this.store.needsMigration()) this.store.migrate();
  }

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Internal only: the Worker's create endpoint calls this; external POSTs are blocked in the Worker.
    if (request.method === "POST" && url.pathname === "/init") {
      if (this.isInitialized()) return new Response("Board exists", { status: 409 });
      const { ops = [], hostKey, title, permissions, password } = (await request.json().catch(() => ({}))) as InitBody;
      const now = Date.now();
      this.store.init(now, () => nanoid(10), {
        starterColumns: ops.length === 0,
        hostKey,
        title,
        permissions,
        password: password ? await hashPassword(password) : undefined,
      });
      // Imports replay as ordinary ops, so they get the same validation and limits as live edits.
      let skipped = 0;
      for (const op of ops) if (!this.store.commit(op, "Import", now).ok) skipped++;
      await this.schedule();
      return Response.json({ imported: ops.length - skipped, skipped }, { status: 201 });
    }

    // Internal only (admin takedown via the Worker): disconnect everyone and erase the board.
    if (request.method === "POST" && url.pathname === "/admin/delete") {
      if (!this.isInitialized()) return new Response("Not found", { status: 404 });
      for (const conn of this.getConnections()) {
        this.send(conn, { t: "expired" });
        conn.close(CloseCode.Expired, "Board removed");
      }
      await this.ctx.storage.deleteAll();
      return new Response(null, { status: 204 });
    }

    if (request.method === "GET") {
      if (!this.isInitialized()) {
        await this.forget();
        return Response.json({ status: "expired" });
      }
      return Response.json({ status: "active", keptUntil: this.keptUntil(), locked: this.store.passwordRecord() !== null });
    }

    return new Response("Method not allowed", { status: 405 });
  }

  async onConnect(conn: Connection<ConnState>, ctx: ConnectionContext) {
    if (!this.isInitialized()) {
      this.send(conn, { t: "expired" });
      conn.close(CloseCode.Expired, "Board expired");
      await this.forget();
      return;
    }
    this.ips.set(conn.id, ctx.request.headers.get("CF-Connecting-IP") ?? "unknown");
    const connections = [...this.getConnections<ConnState>()];
    if (connections.length > MAX_CONNECTIONS) {
      // Sockets that never got in (e.g. stuck at the password) make room before anyone who did.
      const idle = connections.find((c) => c.id !== conn.id && !c.state && !this.checkingPassword.has(c.id));
      if (idle) idle.close(CloseCode.RoomFull, "Board is full");
      else conn.close(CloseCode.RoomFull, "Board is full");
    }
    // The peer is announced once it sends `hello` with its name and color.
  }

  /** Missed ops if the log still covers `lastSeq`, otherwise a full snapshot. */
  private syncFor(lastSeq: number): Sync {
    const ops = this.store.opsSince(lastSeq);
    if (ops) return { type: "replay", ops };
    return { type: "snapshot", seq: this.store.currentSeq(), board: this.store.snapshot() };
  }

  onMessage(conn: Connection<ConnState>, raw: string | ArrayBuffer | ArrayBufferView) {
    if (typeof raw !== "string" || raw.length > MAX_MESSAGE_LENGTH) return;
    const msg = parseClientMessage(raw);
    if (!msg) return;

    // Cursor: the most frequent message. Batched per tick and forgotten, never stored in SQLite.
    if (Array.isArray(msg)) {
      if (!conn.state || !this.allow(conn, "presence")) return;
      const [, anchor, fx, fy] = msg;
      this.lastMove.set(conn.id, Date.now());
      // Rounded to keep each entry small.
      const round = (n: number) => Math.round(n * 1e4) / 1e4;
      this.cursorBatch.set(conn.id, [conn.id, anchor, round(fx), round(fy)]);
      this.scheduleCursorFlush();
      return;
    }

    if (msg.t === "op" || msg.t === "badOp") {
      if (!this.allow(conn, "ops")) {
        return this.send(conn, { t: "reject", cid: msg.cid, reason: "You're making changes too quickly; slow down" });
      }
    } else if (msg.t !== "hello" && !this.allow(conn, "presence")) {
      return;
    }

    switch (msg.t) {
      case "hello": {
        if (conn.state || this.checkingPassword.has(conn.id)) return;
        // A socket opened just before the board was deleted can still say hello afterwards.
        if (!this.isInitialized()) {
          this.send(conn, { t: "expired" });
          return conn.close(CloseCode.Expired, "Board expired");
        }
        const record = this.store.passwordRecord();
        // The host never needs the password; everyone else does when one is set.
        if (!record || this.store.isHostKey(msg.hostKey)) return this.welcome(conn, msg);
        if (msg.password === undefined) return this.send(conn, { t: "passwordRequired", wrong: false });
        const now = Date.now();
        const ip = this.ips.get(conn.id) ?? "unknown";
        this.passwordFailures = this.passwordFailures.filter((f) => now - f.at < PASSWORD_WINDOW_MS);
        const mine = this.passwordFailures.filter((f) => f.ip === ip);
        const limited = mine.length >= PASSWORD_ATTEMPTS_PER_IP ? mine : this.passwordFailures.length >= PASSWORD_ATTEMPTS_PER_BOARD ? this.passwordFailures : null;
        if (limited) {
          const retryAfterMs = limited[0].at + PASSWORD_WINDOW_MS - now;
          return this.send(conn, { t: "passwordRequired", wrong: true, retryAfterMs });
        }
        // Checked asynchronously; until it passes, the connection has no state, so anything else it sends is ignored.
        this.checkingPassword.add(conn.id);
        this.ctx.waitUntil(
          verifyPassword(msg.password, record)
            .then((ok) => {
              if (ok) return this.welcome(conn, msg);
              this.passwordFailures.push({ at: Date.now(), ip });
              this.send(conn, { t: "passwordRequired", wrong: true });
            })
            .finally(() => this.checkingPassword.delete(conn.id)),
        );
        return;
      }

      case "ping":
        this.send(conn, { t: "pong", at: msg.at });
        return;

      case "badOp":
        return this.send(conn, { t: "reject", cid: msg.cid, reason: "Invalid change" });

      case "op": {
        const peer = conn.state;
        if (!peer) return this.send(conn, { t: "reject", cid: msg.cid, reason: "Say hello first" });
        const op = msg.op;
        if (!isAllowed(op, this.store.permissions(), peer.host)) {
          const reason = op.kind === "board.permissions" ? "Only the host can change permissions" : "The host has made this view-only";
          return this.send(conn, { t: "reject", cid: msg.cid, reason });
        }
        // Someone holding a card or note blocks others from moving, deleting or converting it.
        if (HELD_KINDS.has(op.kind) && "id" in op) {
          const holder = this.holderOf(op.id, conn.id);
          if (holder) return this.send(conn, { t: "reject", cid: msg.cid, reason: `${holder.state!.name} is moving this` });
        }
        const result = this.store.commit(op, peer.name, Date.now());
        if (!result.ok) return this.send(conn, { t: "reject", cid: msg.cid, reason: result.reason });
        this.send(conn, { t: "ack", cid: msg.cid, op: result.committed });
        this.broadcast(encode({ t: "opb", op: result.committed }), [conn.id]);
        // Dropping a held card or note commits the move and releases the lock in one step.
        if ((op.kind === "card.move" || op.kind === "note.move") && peer.holding === op.id) {
          this.updatePeer(conn, { holding: null });
        }
        this.touch();
        if (DELETE_KINDS.has(op.kind)) this.ctx.waitUntil(this.schedule());
        return;
      }

      case "trash":
        if (conn.state) this.send(conn, { t: "trash", items: this.store.trash(), backups: this.store.backups() });
        return;

      case "backup":
        if (conn.state) this.send(conn, { t: "backup", day: msg.day, board: this.store.backup(msg.day) });
        return;

      case "deleteBoard": {
        if (!conn.state) return;
        if (!conn.state.host) return this.send(conn, { t: "refused", reason: "Only the host can delete this board" });
        const by = conn.state.name;
        for (const other of this.getConnections()) {
          this.send(other, { t: "deleted", by });
          other.close(CloseCode.Expired, "Board deleted");
        }
        // Like expiry: the database and alarm go, and the link shows "expired" from now on.
        this.ctx.waitUntil(this.ctx.storage.deleteAll());
        return;
      }

      case "setPassword": {
        if (!conn.state) return;
        if (!conn.state.host) return this.send(conn, { t: "refused", reason: "Only the host can change the password" });
        const { password } = msg;
        this.ctx.waitUntil(
          (password ? hashPassword(password) : Promise.resolve(null)).then((record) => {
            this.store.setPasswordRecord(record);
            this.broadcast(encode({ t: "locked", locked: record !== null }));
          }),
        );
        return;
      }

      case "history":
        if (conn.state) this.send(conn, { t: "history", id: msg.id, ...this.store.history(msg.before, msg.id, HISTORY_PAGE) });
        return;

      // ---- presence: kept in connection state, never in SQLite ----

      case "presence":
        if (conn.state) this.updatePeer(conn, msg.patch);
        return;

      case "profile": {
        if (!conn.state) return;
        const renamed = this.store.renameMember(conn.state.clientId, msg.name, msg.color);
        if (!renamed.ok) return this.send(conn, { t: "profileRejected", reason: renamed.reason });
        // Every tab of this browser on the board shows the new name.
        for (const other of this.getConnections<ConnState>()) {
          if (other.state?.clientId === conn.state.clientId) this.updatePeer(other, { name: msg.name, color: msg.color });
        }
        return;
      }

      case "lock": {
        if (!conn.state) return;
        if (!conn.state.host) {
          const perms = this.store.permissions();
          const allowed = this.store.isNote(msg.cardId) ? perms.editBulletin : perms.moveCards;
          if (!allowed) return this.send(conn, { t: "lockDenied", cardId: msg.cardId, by: "the host's settings" });
        }
        const holder = this.holderOf(msg.cardId, conn.id);
        if (holder) return this.send(conn, { t: "lockDenied", cardId: msg.cardId, by: holder.state!.name });
        this.lastMove.set(conn.id, Date.now());
        this.updatePeer(conn, { holding: msg.cardId });
        return;
      }

      case "unlock":
        if (conn.state?.holding === msg.cardId) this.updatePeer(conn, { holding: null });
        return;
    }
  }

  onClose(conn: Connection<ConnState>) {
    this.ips.delete(conn.id);
    this.lastMove.delete(conn.id);
    this.buckets.delete(conn.id);
    this.cursorBatch.delete(conn.id);
    // Leaving also releases the peer's lock, since locks live in peer state.
    if (conn.state) this.broadcast(encode({ t: "leave", connectionId: conn.id }), [conn.id]);
  }
}
