import { Server, type Connection } from "partyserver";
import {
  CloseCode,
  MAX_CONNECTIONS,
  MAX_MESSAGE_BYTES,
  encode,
  parseClientMessage,
  type Peer,
  type ServerMessage,
} from "@livekanban/protocol";

const DAY_MS = 24 * 60 * 60 * 1000;
const SCHEMA_VERSION = "1";

/**
 * One Durable Object per board. Presence lives in each socket's attachment
 * (connection state); board data lives in this object's SQLite database.
 */
export class BoardRoom extends Server<Env> {
  static options = { hibernate: true };

  private get db() {
    return this.ctx.storage.sql;
  }

  private get expiryMs() {
    return Number(this.env.EXPIRY_DAYS) * DAY_MS;
  }

  private readMeta(key: string): string | undefined {
    const hasMeta = this.db
      .exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'")
      .toArray().length;
    if (!hasMeta) return undefined;
    const row = this.db.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key).toArray()[0];
    return row?.value;
  }

  /** A board exists only if the create endpoint initialized it; visiting a URL never creates one. */
  private isInitialized(): boolean {
    return this.readMeta("created_at") !== undefined;
  }

  private keptUntil(): number {
    return Number(this.readMeta("last_activity_at")) + this.expiryMs;
  }

  /** Drop anything an unknown or expired ID wrote (e.g. PartyServer's name record). */
  private async forget() {
    await this.ctx.storage.deleteAll();
  }

  private send(conn: Connection, msg: ServerMessage) {
    conn.send(encode(msg));
  }

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Internal only: the Worker's create endpoint calls this; external POSTs are blocked in the Worker.
    if (request.method === "POST" && url.pathname === "/init") {
      if (this.isInitialized()) return new Response("Board exists", { status: 409 });
      const now = String(Date.now());
      this.ctx.storage.transactionSync(() => {
        this.db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
        for (const [key, value] of [
          ["created_at", now],
          ["last_activity_at", now],
          ["schema_version", SCHEMA_VERSION],
        ]) {
          this.db.exec("INSERT INTO meta (key, value) VALUES (?, ?)", key, value);
        }
      });
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

  onMessage(conn: Connection<Peer>, raw: string | ArrayBuffer | ArrayBufferView) {
    if (typeof raw !== "string" || raw.length > MAX_MESSAGE_BYTES) return;
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
          createdAt: Number(this.readMeta("created_at")),
          keptUntil: this.keptUntil(),
        });
        this.broadcast(encode({ t: "join", peer }), [conn.id]);
        return;
      }
      case "ping":
        this.send(conn, { t: "pong", at: msg.at });
        return;
    }
  }

  onClose(conn: Connection<Peer>) {
    if (conn.state) this.broadcast(encode({ t: "leave", connectionId: conn.id }), [conn.id]);
  }
}
