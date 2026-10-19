// Phase 5 gate: "expiry test passes". Boots Workers with tiny time windows
// (EXPIRY=4s, TRASH_RETENTION=2s, BACKUP_EVERY=2s) so the real alarm-driven
// flows run in seconds, plus Turnstile, creation limits, rate limits, import
// and admin takedown.
import assert from "node:assert/strict";
import { unstable_dev } from "wrangler";

const EXPIRY_MS = 4000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startWorker(vars) {
  const worker = await unstable_dev("src/index.ts", {
    config: "wrangler.jsonc",
    persist: false,
    logLevel: "warn",
    // Tests ignore any real keys in .dev.vars.
    vars: { CREATE_LIMIT_PER_HOUR: "100000", TURNSTILE_SECRET: "", ADMIN_TOKEN: "", ...vars },
    experimental: { disableExperimentalWarning: true },
  });
  const http = `http://${worker.address}:${worker.port}`;
  return { worker, http, ws: http.replace("http", "ws") };
}

function client(ws, boardId) {
  const socket = new WebSocket(`${ws}/parties/board-room/${boardId}`);
  const queue = [];
  const waiters = [];
  socket.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    const w = waiters.shift();
    w ? w(msg) : queue.push(msg);
  });
  const closed = new Promise((r) => socket.addEventListener("close", (e) => r(e.code)));
  const opened = new Promise((r, j) => {
    socket.addEventListener("open", r);
    socket.addEventListener("error", j);
  });
  const next = (timeout = 5000) =>
    queue.length
      ? Promise.resolve(queue.shift())
      : new Promise((r, j) => {
          waiters.push(r);
          setTimeout(() => j(new Error("timed out waiting for message")), timeout);
        });
  /** Next message matching `pred`, skipping others (join/peer/kept noise). */
  const until = async (pred, timeout = 5000) => {
    const end = Date.now() + timeout;
    for (;;) {
      const msg = await next(Math.max(1, end - Date.now()));
      if (pred(msg)) return msg;
    }
  };
  return { socket, opened, closed, next, until, send: (m) => socket.send(JSON.stringify(m)) };
}

async function join(ws, boardId, name = "Tester") {
  const c = client(ws, boardId);
  await c.opened;
  c.send({ t: "hello", clientId: `c-${name}`, name, color: "#0d9488", custom: true, lastSeq: 0 });
  const welcome = await c.until((m) => m.t === "welcome");
  return Object.assign(c, { welcome });
}

let cid = 0;
async function op(c, body) {
  const id = `h-${++cid}`;
  c.send({ t: "op", cid: id, op: body });
  return c.until((m) => m.cid === id);
}

async function newBoard(http, body) {
  const res = await fetch(`${http}/api/boards`, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { res, json: await res.json() };
}

const status = async (http, id) => (await (await fetch(`${http}/parties/board-room/${id}`)).json()).status;
const firstColumn = (welcome) =>
  Object.values(welcome.sync.board.columns).sort((a, b) => (a.position < b.position ? -1 : 1))[0].id;

const main = await startWorker({ EXPIRY: "4s", TRASH_RETENTION: "2s", BACKUP_EVERY: "2s", ADMIN_TOKEN: "test-admin" });
const { http, ws } = main;

const tests = {
  async "a board nobody visits is deleted when its window passes, and stays expired"() {
    const { json } = await newBoard(http);
    assert.equal(await status(http, json.id), "active");
    await sleep(EXPIRY_MS + 2500);
    assert.equal(await status(http, json.id), "expired");
    const c = client(ws, json.id);
    assert.deepEqual(await c.next(), { t: "expired" });
    assert.equal(await c.closed, 4404);
    assert.equal(await status(http, json.id), "expired", "visiting must not recreate it");
  },

  async "a visit pushes the expiry date back"() {
    const { json } = await newBoard(http);
    const created = Date.now();
    await sleep(2500);
    const c = await join(ws, json.id);
    assert.ok(c.welcome.keptUntil >= created + 2500 + EXPIRY_MS - 200, "keptUntil moved forward");
    c.socket.close();
    // Original window ends at 4 s, the extended one at 6.5 s: check in between, then well after.
    await sleep(created + EXPIRY_MS + 1000 - Date.now());
    assert.equal(await status(http, json.id), "active");
    await sleep(created + 2500 + EXPIRY_MS + 2500 - Date.now());
    assert.equal(await status(http, json.id), "expired");
  },

  async "someone connected keeps the board alive and sees the new date live"() {
    const { json } = await newBoard(http);
    const c = await join(ws, json.id);
    const kept = await c.until((m) => m.t === "kept", EXPIRY_MS + 4000);
    assert.ok(kept.keptUntil > c.welcome.keptUntil);
    assert.equal(await status(http, json.id), "active");
    c.socket.close();
  },

  async "trash lists deleted items, then purges them after the retention window"() {
    const { json } = await newBoard(http);
    const c = await join(ws, json.id);
    const col = firstColumn(c.welcome);
    await op(c, { kind: "card.create", id: "card00001", columnId: col, position: "a0", title: "Oops" });
    await op(c, { kind: "card.delete", id: "card00001" });
    await op(c, { kind: "note.create", id: "note00001", x: 0, y: 0, w: 200, h: 200, color: "amber", text: "Becomes a card" });
    await op(c, { kind: "note.toCard", id: "note00001", cardId: "card00002", columnId: col, position: "a5" });

    c.send({ t: "trash" });
    const before = await c.until((m) => m.t === "trash");
    assert.deepEqual(before.items.map((i) => [i.kind, i.id, i.label]), [["card", "card00001", "Oops"]], "converted notes aren't in the trash");

    await sleep(3500);
    c.send({ t: "trash" });
    const after = await c.until((m) => m.t === "trash");
    assert.deepEqual(after.items, []);
    assert.match((await op(c, { kind: "card.restore", id: "card00001" })).reason, /nothing to restore/i);

    // Activity since creation means a backup was taken by the same alarm.
    assert.ok(after.backups.length >= 1, "a daily backup exists");
    c.send({ t: "backup", day: after.backups[0].day });
    const backup = await c.until((m) => m.t === "backup");
    assert.equal(Object.keys(backup.board.columns).length, 3);
    c.socket.close();
  },

  async "per-connection rate limits reject op floods and close cursor floods"() {
    const { json } = await newBoard(http);
    const c = await join(ws, json.id);
    for (let i = 0; i < 60; i++) c.send({ t: "op", cid: `f-${i}`, op: { kind: "board.update", title: `T${i}` } });
    let slowed = 0;
    for (let i = 0; i < 60; i++) {
      const m = await c.until((x) => x.t === "ack" || x.t === "reject");
      if (m.t === "reject" && /too quickly/.test(m.reason)) slowed++;
    }
    assert.ok(slowed >= 30, `expected most of a 60-op burst rejected, got ${slowed}`);
    await sleep(1200);
    assert.equal((await op(c, { kind: "board.update", title: "Calm" })).t, "ack", "recovers after a pause");

    for (let i = 0; i < 1000; i++) c.socket.send(JSON.stringify(["c", "board", 0.5, 0.5]));
    assert.equal(await c.closed, 4008);
  },

  async "an export imports into a new board through the same validation"() {
    const exported = {
      format: "livekanban",
      version: 1,
      exportedAt: new Date().toISOString(),
      board: {
        title: "Imported plan",
        columns: {
          col0000001: { id: "col0000001", title: "Backlog", position: "a0", color: null, wipLimit: 3 },
          col0000002: { id: "col0000002", title: "Done", position: "a1", color: "green", wipLimit: null },
        },
        cards: {
          card00001: {
            id: "card00001", number: 7, columnId: "col0000001", position: "a0", title: "Keep", description: "See #3",
            color: "blue", labels: ["ux"], assignee: "Ada", startDate: "2026-11-15", dueDate: "2026-12-01", updatedAt: 0, updatedBy: "x",
            checklist: [{ id: "item00001", text: "Draft", done: true }, { id: "item00002", text: "Review", done: false }, { id: "!", text: "bad" }],
          },
          card00002: { id: "card00002", columnId: "nosuchcolumn", position: "a0", title: "Orphan" },
          bad: { id: "!", title: "<script>" },
        },
        notes: {
          note00001: { id: "note00001", number: 3, x: 99999, y: 10, w: 5, h: 200, z: 1, color: "pink", text: "Pinned" },
        },
        pinnedNoteId: "note00001",
        labelColors: { ux: "purple", nope: "neon" },
      },
    };
    const { res, json } = await newBoard(http, { import: exported });
    assert.equal(res.status, 201);
    assert.ok(json.skipped >= 1, "the orphan card is skipped by the room");

    const c = await join(ws, json.id);
    const board = c.welcome.sync.board;
    assert.equal(board.title, "Imported plan");
    assert.deepEqual(Object.values(board.columns).map((x) => x.title).sort(), ["Backlog", "Done"]);
    assert.equal(board.columns.col0000001.wipLimit, 3);
    assert.deepEqual(Object.keys(board.cards), ["card00001"]);
    assert.deepEqual(board.cards.card00001.labels, ["ux"]);
    assert.deepEqual(board.cards.card00001.assignees, ["Ada"], "a legacy single assignee imports as a list");
    assert.equal(board.pinnedNoteId, "note00001");
    assert.equal(board.notes.note00001.w, 120, "sizes are clamped");
    assert.deepEqual([board.cards.card00001.number, board.notes.note00001.number], [7, 3], "imports keep reference numbers, so #mentions still resolve");
    assert.equal(board.cards.card00001.startDate, "2026-11-15");
    assert.deepEqual(board.cards.card00001.checklist, [{ id: "item00001", text: "Draft", done: true }, { id: "item00002", text: "Review", done: false }]);
    assert.deepEqual(board.labelColors, { ux: "purple" }, "invalid label colors are dropped");
    c.socket.close();

    const bad = await newBoard(http, { import: { format: "trello" } });
    assert.equal(bad.res.status, 400);
  },

  async "admins can take a board down, disconnecting everyone"() {
    const { json } = await newBoard(http);
    const c = await join(ws, json.id);
    const del = (auth) => fetch(`${http}/admin/boards/${json.id}`, { method: "DELETE", headers: auth ? { Authorization: auth } : {} });
    assert.equal((await del()).status, 401);
    assert.equal((await del("Bearer wrong-token")).status, 401);
    assert.equal((await del("Bearer test-admin")).status, 200);
    await c.until((m) => m.t === "expired");
    assert.equal(await c.closed, 4404);
    assert.equal(await status(http, json.id), "expired");
  },
};

const separate = {
  async "with a Turnstile secret set, creating a board needs a token (or the admin token)"() {
    const w = await startWorker({ TURNSTILE_SECRET: "test-secret", ADMIN_TOKEN: "test-admin" });
    try {
      const { res, json } = await newBoard(w.http);
      assert.equal(res.status, 403);
      assert.match(json.error, /verification failed/i);
      const admin = await fetch(`${w.http}/api/boards`, { method: "POST", headers: { Authorization: "Bearer test-admin" } });
      assert.equal(admin.status, 201, "operator scripts skip Turnstile");
    } finally {
      await w.worker.stop();
    }
  },

  async "each network can create a limited number of boards per hour"() {
    const w = await startWorker({ CREATE_LIMIT_PER_HOUR: "3", ADMIN_TOKEN: "test-admin" });
    try {
      for (let i = 0; i < 3; i++) assert.equal((await newBoard(w.http)).res.status, 201);
      const { res, json } = await newBoard(w.http);
      assert.equal(res.status, 429);
      assert.match(json.error, /too many new boards/i);
      assert.ok(Number(res.headers.get("Retry-After")) > 3000);
      const admin = await fetch(`${w.http}/api/boards`, { method: "POST", headers: { Authorization: "Bearer test-admin" } });
      assert.equal(admin.status, 201, "operator scripts skip the per-IP limit");
    } finally {
      await w.worker.stop();
    }
  },
};

let failed = 0;
async function run(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL ${name}\n`, err);
  }
}

try {
  // Independent timing tests run concurrently to keep the suite short.
  const timed = ["a board nobody visits is deleted when its window passes, and stays expired", "a visit pushes the expiry date back", "someone connected keeps the board alive and sees the new date live", "trash lists deleted items, then purges them after the retention window"];
  await Promise.all(timed.map((name) => run(name, tests[name])));
  for (const [name, fn] of Object.entries(tests)) if (!timed.includes(name)) await run(name, fn);
} finally {
  await main.worker.stop();
}
for (const [name, fn] of Object.entries(separate)) await run(name, fn);
process.exit(failed ? 1 : 0);
