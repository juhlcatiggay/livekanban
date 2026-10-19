import { Server, type Connection } from "partyserver";
import { nanoid } from "nanoid";
import {
  CloseCode,
  MAX_CONNECTIONS,
  MAX_MESSAGE_LENGTH,
  encode,
  parseClientMessage,
  type OpKind,
  type Peer,
  type ServerMessage,
  type Sync,
} from "@livekanban/protocol";
import { BoardStorage } from "./storage";

const DAY_MS = 24 * 60 * 60 * 1000;
/** A drag lock lapses if its holder hasn't moved the pointer for this long. */
const LOCK_STALE_MS = 15_000;
/** Ops that a drag lock blocks for everyone but the holder. */
const HELD_KINDS = new Set<OpKind>(["card.move", "card.delete", "card.toNote", "note.move", "note.delete", "note.toCard"]);

/**
 * One Durable Object per board. Presence lives in each socket's attachment
 * (connection state); board data lives in this object's SQLite database.
 */
export class BoardRoom extends Server<Env> {
  static options = { hibernate: true };

  private readonly store = new BoardStorage(this.ctx.storage.sql, (fn) => this.ctx.storage.transactionSync(fn));

  /**
   * Last cursor message time per connection, for lock staleness. In memory only:
   * after hibernation it is empty, which correctly treats every lock as stale
   * (nobody has sent anything for a while).
   */
  private readonly lastMove = new Map<string, number>();

  private get expiryMs() {
    return Number(this.env.EXPIRY_DAYS) * DAY_MS;
  }

  /** A board exists only if the create endpoint initialized it; visiting a URL never creates one. */
  private isInitialized(): boolean {
    return this.store.getMeta("created_at") !== undefined;
  }

  private keptUntil(): number {
    return Number(this.store.getMeta("last_activity_at")) + this.expiryMs;
  }

  /** Drop anything an unknown or expired ID wrote (e.g. PartyServer's name record). */
  private async forget() {
    await this.ctx.storage.deleteAll();
  }

  private send(conn: Connection, msg: ServerMessage) {
    conn.send(encode(msg));
  }

  /** Updates a peer's state and tells everyone, including that peer. */
  private updatePeer(conn: Connection<Peer>, patch: Partial<Peer>) {
    const prev = conn.state as Peer;
    const next: Peer = { ...prev, ...patch };
    if ((Object.keys(patch) as (keyof Peer)[]).every((k) => prev[k] === next[k])) return;
    conn.setState(next);
    this.broadcast(encode({ t: "peer", peer: next }));
  }

  /** The other connection actively holding `cardId`, if any. Stale locks are released. */
  private holderOf(cardId: string, except: string): Connection<Peer> | undefined {
    for (const other of this.getConnections<Peer>()) {
      if (other.id === except || other.state?.holding !== cardId) continue;
      const moved = this.lastMove.get(other.id);
      if (moved !== undefined && Date.now() - moved < LOCK_STALE_MS) return other;
      this.updatePeer(other, { holding: null });
    }
    return undefined;
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
      this.store.init(Date.now(), () => nanoid(10));
      return new Response(null, { status: 201 });
    }

    if (request.method === "GET") {
      if (!this.isInitialized()) {
        await this.forget();
        return Response.json({ status: "expired" });
      }
      return Response.json({ status: "active", keptUntil: this.keptUntil() });
    }

    return new Response("Method not allowed", { status: 405 });
  }

  async onConnect(conn: Connection<Peer>) {
    if (!this.isInitialized()) {
      this.send(conn, { t: "expired" });
      conn.close(CloseCode.Expired, "Board expired");
      await this.forget();
      return;
    }
    if ([...this.getConnections()].length > MAX_CONNECTIONS) {
      conn.close(CloseCode.RoomFull, "Board is full");
    }
    // The peer is announced once it sends `hello` with its name and color.
  }

  /** Missed ops if the log still covers `lastSeq`, otherwise a full snapshot. */
  private syncFor(lastSeq: number): Sync {
    const ops = this.store.opsSince(lastSeq);
    if (ops) return { type: "replay", ops };
    return { type: "snapshot", seq: this.store.currentSeq(), board: this.store.snapshot() };
  }

  onMessage(conn: Connection<Peer>, raw: string | ArrayBuffer | ArrayBufferView) {
    if (typeof raw !== "string" || raw.length > MAX_MESSAGE_LENGTH) return;
    const msg = parseClientMessage(raw);
    if (!msg) return;

    // Cursor: the most frequent message. Broadcast and forget, never stored in SQLite.
    if (Array.isArray(msg)) {
      if (!conn.state) return;
      const [, anchor, fx, fy] = msg;
      this.lastMove.set(conn.id, Date.now());
      // Rounded to keep relayed messages around 40 bytes.
      const round = (n: number) => Math.round(n * 1e4) / 1e4;
      this.broadcast(JSON.stringify(["c", conn.id, anchor, round(fx), round(fy)]), [conn.id]);
      return;
    }

    switch (msg.t) {
      case "hello": {
        if (conn.state) return;
        const peer: Peer = {
          connectionId: conn.id,
          clientId: msg.clientId,
          name: msg.name,
          color: msg.color,
          editing: null,
          holding: null,
          idle: false,
          away: false,
        };
        conn.setState(peer);
        const peers: Peer[] = [];
        for (const other of this.getConnections<Peer>()) {
          if (other.id !== conn.id && other.state) peers.push(other.state as Peer);
        }
        this.send(conn, {
          t: "welcome",
          self: conn.id,
          peers,
          createdAt: Number(this.store.getMeta("created_at")),
          keptUntil: this.keptUntil(),
          sync: this.syncFor(msg.lastSeq),
        });
        this.broadcast(encode({ t: "join", peer }), [conn.id]);
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
        return;
      }

      // ---- presence: kept in connection state, never in SQLite ----

      case "presence":
        if (conn.state) this.updatePeer(conn, msg.patch);
        return;

      case "profile":
        if (conn.state) this.updatePeer(conn, { name: msg.name, color: msg.color });
        return;

      case "lock": {
        if (!conn.state) return;
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

  onClose(conn: Connection<Peer>) {
    this.lastMove.delete(conn.id);
    // Leaving also releases the peer's lock, since locks live in peer state.
    if (conn.state) this.broadcast(encode({ t: "leave", connectionId: conn.id }), [conn.id]);
  }
}
