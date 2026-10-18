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

const hello = (name) => ({ t: "hello", clientId: `c-${name}`, name, color: "#0d9488", lastSeq: 0 });

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
