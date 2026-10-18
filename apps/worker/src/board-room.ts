import { Server, type Connection } from "partyserver";
import { nanoid } from "nanoid";
import {
  CloseCode,
  MAX_CONNECTIONS,
  MAX_MESSAGE_LENGTH,
  encode,
  parseClientMessage,
  type Peer,
  type ServerMessage,
  type Sync,
} from "@livekanban/protocol";
import { BoardStorage } from "./storage";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One Durable Object per board. Presence lives in each socket's attachment
 * (connection state); board data lives in this object's SQLite database.
 */
export class BoardRoom extends Server<Env> {
  static options = { hibernate: true };

  private readonly store = new BoardStorage(this.ctx.storage.sql, (fn) => this.ctx.storage.transactionSync(fn));

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

    switch (msg.t) {
      case "hello": {
        if (conn.state) return;
        const peer: Peer = {
          connectionId: conn.id,
          clientId: msg.clientId,
          name: msg.name,
          color: msg.color,
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
        const result = this.store.commit(msg.op, peer.name, Date.now());
        if (!result.ok) return this.send(conn, { t: "reject", cid: msg.cid, reason: result.reason });
        this.send(conn, { t: "ack", cid: msg.cid, op: result.committed });
        this.broadcast(encode({ t: "opb", op: result.committed }), [conn.id]);
        return;
      }
    }
  }

  onClose(conn: Connection<Peer>) {
    if (conn.state) this.broadcast(encode({ t: "leave", connectionId: conn.id }), [conn.id]);
  }
}
