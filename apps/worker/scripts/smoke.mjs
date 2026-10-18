// Phase 1 gate: "two tabs share one room". Boots the Worker locally and drives it with raw WebSockets.
import assert from "node:assert/strict";
import http from "node:http";
import { unstable_dev } from "wrangler";

const worker = await unstable_dev("src/index.ts", {
  config: "wrangler.jsonc",
  persist: false,
  experimental: { disableExperimentalWarning: true },
});
const base = `http://${worker.address}:${worker.port}`;
const wsBase = base.replace("http", "ws");

/** Opens a socket that queues every server message so tests can await them in order. */
function connect(boardId) {
  const ws = new WebSocket(`${wsBase}/parties/board-room/${boardId}`);
  const queue = [];
  const waiters = [];
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    const w = waiters.shift();
    w ? w(msg) : queue.push(msg);
  });
  const closed = new Promise((r) => ws.addEventListener("close", (e) => r(e.code)));
  const opened = new Promise((r, j) => {
    ws.addEventListener("open", r);
    ws.addEventListener("error", j);
  });
  const next = () =>
    queue.length
      ? Promise.resolve(queue.shift())
      : new Promise((r, j) => {
          waiters.push(r);
          setTimeout(() => j(new Error("timed out waiting for message")), 5000);
        });
  return { ws, opened, closed, next, send: (m) => ws.send(JSON.stringify(m)) };
}

const hello = (name, lastSeq = 0) => ({ t: "hello", clientId: `c-${name}`, name, color: "#0d9488", lastSeq });

async function newBoard() {
  const res = await fetch(`${base}/api/boards`, { method: "POST" });
  return (await res.json()).id;
}

/** Connects, says hello and resolves once `welcome` arrives. */
async function join(boardId, name, lastSeq = 0) {
  const c = connect(boardId);
  await c.opened;
  c.send(hello(name, lastSeq));
  const welcome = await c.next();
  assert.equal(welcome.t, "welcome");
  return Object.assign(c, { welcome });
}

let cidCounter = 0;
/** Sends an op and resolves with the room's ack/reject for it. */
async function op(client, body) {
  const cid = `cid-${++cidCounter}`;
  client.send({ t: "op", cid, op: body });
  const reply = await client.next();
  assert.equal(reply.cid, cid);
  return reply;
}

const firstColumnId = (welcome) =>
  Object.values(welcome.sync.board.columns).sort((a, b) => (a.position < b.position ? -1 : 1))[0].id;

function rawPost(path, origin) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${path}`, { method: "POST", headers: { Origin: origin } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on("error", reject);
    req.end();
  });
}

const tests = {
  async "creates a board and two tabs see each other"() {
    const res = await fetch(`${base}/api/boards`, { method: "POST" });
    assert.equal(res.status, 201);
    const { id } = await res.json();
    assert.match(id, /^[A-Za-z0-9_-]{21}$/);

    const status = await (await fetch(`${base}/parties/board-room/${id}`)).json();
    assert.equal(status.status, "active");
    assert.ok(status.keptUntil > Date.now() + 59 * 864e5);

    const a = connect(id);
    await a.opened;
    a.send(hello("Teal Otter"));
    const aWelcome = await a.next();
    assert.equal(aWelcome.t, "welcome");
    assert.deepEqual(aWelcome.peers, []);

    const b = connect(id);
    await b.opened;
    b.send(hello("Amber Fox"));
    const bWelcome = await b.next();
    assert.equal(bWelcome.peers.length, 1);
    assert.equal(bWelcome.peers[0].name, "Teal Otter");

    const join = await a.next();
    assert.equal(join.t, "join");
    assert.equal(join.peer.name, "Amber Fox");
    assert.equal(join.peer.connectionId, bWelcome.self);

    a.send({ t: "ping", at: 123 });
    assert.deepEqual(await a.next(), { t: "pong", at: 123 });

    b.ws.close();
    assert.deepEqual(await a.next(), { t: "leave", connectionId: bWelcome.self });
    a.ws.close();
  },

  async "unknown board id is reported expired, never created"() {
    const id = "A".repeat(21);
    const c = connect(id);
    assert.deepEqual(await c.next(), { t: "expired" });
    assert.equal(await c.closed, 4404);
    const status = await (await fetch(`${base}/parties/board-room/${id}`)).json();
    assert.equal(status.status, "expired");
  },

  async "rooms reject external writes and malformed ids"() {
    const id = "B".repeat(21);
    assert.equal((await fetch(`${base}/parties/board-room/${id}`, { method: "POST" })).status, 404);
    assert.equal((await fetch(`${base}/parties/board-room/short`)).status, 404);
  },

  async "new boards start with three columns in a snapshot"() {
    const a = await join(await newBoard(), "Teal Otter");
    assert.equal(a.welcome.sync.type, "snapshot");
    assert.equal(a.welcome.sync.seq, 0);
    const titles = Object.values(a.welcome.sync.board.columns)
      .sort((x, y) => (x.position < y.position ? -1 : 1))
      .map((c) => c.title);
    assert.deepEqual(titles, ["To do", "Doing", "Done"]);
    a.ws.close();
  },

  async "ops are acked, broadcast to others and persisted"() {
    const id = await newBoard();
    const a = await join(id, "Teal Otter");
    const b = await join(id, "Amber Fox");
    await a.next(); // join(b)
    const col = firstColumnId(a.welcome);

    const ack = await op(a, { kind: "card.create", id: "card00001", columnId: col, position: "a0", title: "  Write spec  " });
    assert.equal(ack.t, "ack");
    assert.equal(ack.op.seq, 1);
    assert.equal(ack.op.op.title, "Write spec");
    assert.equal(ack.op.by, "Teal Otter");

    const opb = await b.next();
    assert.equal(opb.t, "opb");
    assert.deepEqual(opb.op, ack.op);

    const upd = await op(a, { kind: "card.update", id: "card00001", patch: { description: "# Hi", labels: ["ux", "ux", "api"], dueDate: "2026-11-30" } });
    assert.equal(upd.t, "ack");
    assert.deepEqual(upd.op.op.patch.labels, ["ux", "api"]);
    await b.next();

    a.ws.close();
    b.ws.close();
    const c = await join(id, "Plum Owl");
    assert.equal(c.welcome.sync.type, "snapshot");
    assert.equal(c.welcome.sync.seq, 2);
    const card = c.welcome.sync.board.cards.card00001;
    assert.equal(card.title, "Write spec");
    assert.equal(card.description, "# Hi");
    assert.deepEqual(card.labels, ["ux", "api"]);
    assert.equal(card.dueDate, "2026-11-30");
    assert.equal(card.updatedBy, "Teal Otter");
    c.ws.close();
  },

  async "invalid ops are rejected or ignored"() {
    const a = await join(await newBoard(), "Teal Otter");
    const col = firstColumnId(a.welcome);
    const missing = await op(a, { kind: "card.create", id: "card00001", columnId: "nosuchcol1", position: "a0", title: "x" });
    assert.equal(missing.t, "reject");
    assert.match(missing.reason, /column not found/i);

    await op(a, { kind: "card.create", id: "card00001", columnId: col, position: "a0", title: "x" });
    const dup = await op(a, { kind: "card.create", id: "card00001", columnId: col, position: "a1", title: "y" });
    assert.equal(dup.t, "reject");

    // Malformed ops (bad position key, bad date, empty title) are rejected as invalid.
    for (const bad of [
      { kind: "card.move", id: "card00001", columnId: col, position: "!!" },
      { kind: "card.update", id: "card00001", patch: { dueDate: "2026-02-30" } },
      { kind: "column.update", id: col, patch: { title: "   " } },
    ]) {
      assert.deepEqual(await op(a, bad), { t: "reject", cid: `cid-${cidCounter}`, reason: "Invalid change" });
    }
    // Messages without a usable cid are dropped without a reply.
    a.send({ t: "op", op: { kind: "board.update", title: "x" } });
    a.send({ t: "ping", at: 1 });
    assert.deepEqual(await a.next(), { t: "pong", at: 1 });
    a.ws.close();
  },

  async "ops before hello are rejected"() {
    const c = connect(await newBoard());
    await c.opened;
    c.send({ t: "op", cid: "early", op: { kind: "board.update", title: "Hi" } });
    const reply = await c.next();
    assert.equal(reply.t, "reject");
    c.ws.close();
  },

  async "two cards dropped at the same position get distinct positions"() {
    const id = await newBoard();
    const a = await join(id, "Teal Otter");
    const b = await join(id, "Amber Fox");
    await a.next(); // join(b)
    const col = firstColumnId(a.welcome);
    const first = await op(a, { kind: "card.create", id: "cardAAAAA", columnId: col, position: "a5", title: "A" });
    await b.next(); // opb
    const second = await op(b, { kind: "card.create", id: "cardBBBBB", columnId: col, position: "a5", title: "B" });
    assert.equal(first.op.op.position, "a5");
    assert.notEqual(second.op.op.position, "a5");
    assert.ok(second.op.op.position > "a5");
    a.ws.close();
    b.ws.close();
  },

  async "reconnect replays only the missed ops"() {
    const id = await newBoard();
    const a = await join(id, "Teal Otter");
    const col = firstColumnId(a.welcome);
    await op(a, { kind: "card.create", id: "card00001", columnId: col, position: "a0", title: "One" });
    await op(a, { kind: "card.create", id: "card00002", columnId: col, position: "a1", title: "Two" });
    await op(a, { kind: "board.update", title: "Roadmap" });

    const b = await join(id, "Amber Fox", 1);
    assert.equal(b.welcome.sync.type, "replay");
    assert.deepEqual(b.welcome.sync.ops.map((o) => o.seq), [2, 3]);

    const upToDate = await join(id, "Plum Owl", 3);
    assert.deepEqual(upToDate.welcome.sync, { type: "replay", ops: [] });

    const ahead = await join(id, "Jade Ibex", 99);
    assert.equal(ahead.welcome.sync.type, "snapshot");
    assert.equal(ahead.welcome.sync.board.title, "Roadmap");
    for (const c of [a, b, upToDate, ahead]) c.ws.close();
  },

  async "deleted columns hide their cards and restore with them"() {
    const id = await newBoard();
    const a = await join(id, "Teal Otter");
    const col = firstColumnId(a.welcome);
    await op(a, { kind: "card.create", id: "card00001", columnId: col, position: "a0", title: "Keep me" });
    assert.equal((await op(a, { kind: "column.delete", id: col })).t, "ack");
    const updateInDeleted = await op(a, { kind: "card.update", id: "card00001", patch: { title: "x" } });
    assert.equal(updateInDeleted.t, "reject");

    const hidden = await join(id, "Amber Fox");
    assert.equal(hidden.welcome.sync.board.columns[col], undefined);
    assert.equal(hidden.welcome.sync.board.cards.card00001, undefined);
    await a.next(); // join(hidden)

    const restored = await op(a, { kind: "column.restore", id: col });
    assert.equal(restored.t, "ack");
    assert.equal(restored.op.op.column.id, col);
    assert.deepEqual(restored.op.op.cards.map((c) => c.title), ["Keep me"]);
    for (const c of [a, hidden]) c.ws.close();
  },

  async "create endpoint enforces allowed origins"() {
    assert.equal(await rawPost("/api/boards", "https://evil.example"), 403);
    assert.equal(await rawPost("/api/boards", "http://localhost:3000"), 201);
  },
};

let failed = 0;
try {
  for (const [name, fn] of Object.entries(tests)) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (err) {
      failed++;
      console.error(`FAIL ${name}\n`, err);
    }
  }
} finally {
  await worker.stop();
}
process.exit(failed ? 1 : 0);
