// Phase 1 gate: "two tabs share one room". Boots the Worker locally and drives it with raw WebSockets.
import assert from "node:assert/strict";
import http from "node:http";
import { unstable_dev } from "wrangler";

const worker = await unstable_dev("src/index.ts", {
  config: "wrangler.jsonc",
  persist: false,
  // Tests ignore any real keys in .dev.vars.
  vars: {
    CREATE_LIMIT_PER_HOUR: "100000",
    TURNSTILE_SECRET: "",
    ADMIN_TOKEN: "",
    ALLOWED_ORIGINS: "http://localhost:3000,https://lk-*.vercel.app",
  },
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
  /** Next message matching `pred`, skipping others. */
  const until = async (pred) => {
    for (;;) {
      const msg = await next();
      if (pred(msg)) return msg;
    }
  };
  return { ws, opened, closed, next, until, send: (m) => ws.send(JSON.stringify(m)) };
}

const hello = (name, lastSeq = 0, hostKey) => ({ t: "hello", clientId: `c-${name}`, name, color: "#0d9488", lastSeq, hostKey });

async function newBoard() {
  const res = await fetch(`${base}/api/boards`, { method: "POST" });
  return (await res.json()).id;
}

/** Connects, says hello and resolves once `welcome` arrives. */
async function join(boardId, name, lastSeq = 0, hostKey) {
  const c = connect(boardId);
  await c.opened;
  c.send(hello(name, lastSeq, hostKey));
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

  async "cursors are batched per tick with the sender's id, latest position wins"() {
    const id = await newBoard();
    const a = await join(id, "Teal Otter");
    const b = await join(id, "Amber Fox");
    await a.next(); // join(b)
    const me = a.welcome.self;
    a.ws.send(JSON.stringify(["c", "board", 0.123456, 0.5]));
    a.ws.send(JSON.stringify(["c", "bad anchor!", 0.1, 0.1])); // dropped
    a.ws.send(JSON.stringify(["c", "board", 5, 0.1])); // out of range, dropped
    assert.deepEqual(await b.next(), ["C", [[me, "board", 0.1235, 0.5]]]);
    assert.deepEqual(await a.next(), ["C", [[me, "board", 0.1235, 0.5]]], "the sender gets the batch too and skips itself");

    // A burst of moves is coalesced: fewer entries arrive than were sent, and the last one wins.
    for (let i = 1; i <= 20; i++) a.ws.send(JSON.stringify(["c", "board", i / 100, 0.5]));
    a.ws.send(JSON.stringify(["c", null, 0, 0]));
    const mine = [];
    while (mine.at(-1)?.[1] !== null) {
      const batch = await b.until((m) => Array.isArray(m));
      assert.equal(new Set(batch[1].map((e) => e[0])).size, batch[1].length, "one entry per person per batch");
      mine.push(...batch[1].filter((e) => e[0] === me));
    }
    assert.ok(mine.length < 21, `expected coalescing, got ${mine.length} entries for 21 moves`);

    // People moving at the same time share batches.
    for (let i = 1; i <= 20; i++) {
      a.ws.send(JSON.stringify(["c", "board", i / 100, 0.3]));
      b.ws.send(JSON.stringify(["c", "board", i / 100, 0.7]));
    }
    const both = await a.until((m) => Array.isArray(m) && m[1].length === 2);
    assert.deepEqual(both[1].map((e) => e[0]).sort(), [me, b.welcome.self].sort());
    a.ws.close();
    b.ws.close();
  },

  async "presence and profile changes reach everyone, including the sender"() {
    const id = await newBoard();
    const a = await join(id, "Teal Otter");
    const b = await join(id, "Amber Fox");
    await a.next(); // join(b)
    a.send({ t: "presence", patch: { editing: "card00001", idle: true } });
    for (const c of [a, b]) {
      const { t, peer } = await c.next();
      assert.equal(t, "peer");
      assert.equal(peer.editing, "card00001");
      assert.equal(peer.idle, true);
    }
    a.send({ t: "profile", name: "  Ada  ", color: "#4f46e5" });
    const { peer } = await b.next();
    assert.deepEqual([peer.name, peer.color], ["Ada", "#4f46e5"]);
    await a.next();

    const c = await join(id, "Plum Owl");
    const ada = c.welcome.peers.find((p) => p.name === "Ada");
    assert.equal(ada.editing, "card00001");
    for (const x of [a, b, c]) x.ws.close();
  },

  async "only one person can hold a card, and others can't move it meanwhile"() {
    const id = await newBoard();
    const a = await join(id, "Teal Otter");
    const b = await join(id, "Amber Fox");
    await a.next(); // join(b)
    const col = firstColumnId(a.welcome);
    await op(a, { kind: "card.create", id: "card00001", columnId: col, position: "a0", title: "Hot" });
    await b.next(); // opb

    a.send({ t: "lock", cardId: "card00001" });
    assert.equal((await a.next()).peer.holding, "card00001");
    assert.equal((await b.next()).peer.holding, "card00001");

    b.send({ t: "lock", cardId: "card00001" });
    assert.deepEqual(await b.next(), { t: "lockDenied", cardId: "card00001", by: "Teal Otter" });
    const blocked = await op(b, { kind: "card.move", id: "card00001", columnId: col, position: "a5" });
    assert.equal(blocked.t, "reject");
    assert.match(blocked.reason, /Teal Otter is moving/);

    // Dropping commits the move and releases the lock.
    const moved = await op(a, { kind: "card.move", id: "card00001", columnId: col, position: "a1" });
    assert.equal(moved.t, "ack");
    assert.equal((await a.next()).peer.holding, null);
    assert.equal((await b.next()).t, "opb");
    assert.equal((await b.next()).peer.holding, null);

    b.send({ t: "lock", cardId: "card00001" });
    assert.equal((await b.next()).peer.holding, "card00001");
    a.ws.close();
    b.ws.close();
  },

  async "notes stack, move to the top, pin, and survive a reconnect"() {
    const id = await newBoard();
    const a = await join(id, "Teal Otter");
    const note = (nid, x, y) => ({ kind: "note.create", id: nid, x, y, w: 220, h: 180, color: "amber", text: "Hello" });
    const first = await op(a, note("note00001", 100, 100));
    const second = await op(a, note("note00002", 150, 150));
    assert.deepEqual([first.op.op.z, second.op.op.z], [1, 2]);

    const moved = await op(a, { kind: "note.move", id: "note00001", x: 400, y: 300 });
    assert.equal(moved.op.op.z, 3, "moving brings a note to the top");
    await op(a, { kind: "note.update", id: "note00001", patch: { text: "Standup at 10", color: "blue", w: 300 } });
    await op(a, { kind: "board.pin", noteId: "note00001" });

    const bad = [
      { kind: "note.move", id: "note00001", x: -5, y: 0 },
      { kind: "note.update", id: "note00001", patch: { w: 50 } },
      { kind: "note.create", id: "note00003", x: 0, y: 0, w: 220, h: 180, color: "neon", text: "" },
    ];
    for (const b of bad) assert.equal((await op(a, b)).reason, "Invalid change");
    assert.match((await op(a, { kind: "board.pin", noteId: "nosuchnote" })).reason, /note not found/i);

    a.ws.close();
    const b = await join(id, "Amber Fox");
    const { notes, pinnedNoteId } = b.welcome.sync.board;
    assert.equal(pinnedNoteId, "note00001");
    assert.deepEqual(
      { x: notes.note00001.x, y: notes.note00001.y, z: notes.note00001.z, w: notes.note00001.w },
      { x: 400, y: 300, z: 3, w: 300 },
    );
    assert.equal(notes.note00001.text, "Standup at 10");
    assert.equal(notes.note00001.color, "blue");
    b.ws.close();
  },

  async "a note becomes a card and a card becomes a note"() {
    const id = await newBoard();
    const a = await join(id, "Teal Otter");
    const col = firstColumnId(a.welcome);
    await op(a, { kind: "note.create", id: "note00001", x: 0, y: 0, w: 220, h: 180, color: "green", text: "\n  Ship v1  \nwith docs" });
    const toCard = await op(a, { kind: "note.toCard", id: "note00001", cardId: "card00001", columnId: col, position: "a0" });
    assert.equal(toCard.t, "ack");

    await op(a, { kind: "card.create", id: "card00002", columnId: col, position: "a1", title: "Retro" });
    await op(a, { kind: "card.update", id: "card00002", patch: { description: "What went well" } });
    const toNote = await op(a, { kind: "card.toNote", id: "card00002", noteId: "note00002", x: 40, y: 40 });
    assert.equal(toNote.t, "ack");
    assert.equal(toNote.op.op.z, 1);

    const b = await join(id, "Amber Fox");
    await a.next(); // join(b)
    const board = b.welcome.sync.board;
    assert.equal(board.notes.note00001, undefined);
    assert.deepEqual(
      { title: board.cards.card00001.title, description: board.cards.card00001.description, color: board.cards.card00001.color },
      { title: "Ship v1", description: "Ship v1  \nwith docs", color: "green" },
    );
    assert.equal(board.cards.card00002, undefined);
    assert.equal(board.notes.note00002.text, "Retro\n\nWhat went well");

    // Deleted notes come back with their data.
    await op(a, { kind: "note.delete", id: "note00002" });
    const restored = await op(a, { kind: "note.restore", id: "note00002" });
    assert.equal(restored.op.op.note.text, "Retro\n\nWhat went well");
    a.ws.close();
    b.ws.close();
  },

  async "a held note can't be moved or converted by someone else"() {
    const id = await newBoard();
    const a = await join(id, "Teal Otter");
    const b = await join(id, "Amber Fox");
    await a.next(); // join(b)
    await op(a, { kind: "note.create", id: "note00001", x: 0, y: 0, w: 220, h: 180, color: "amber", text: "Mine" });
    await b.next(); // opb
    a.send({ t: "lock", cardId: "note00001" });
    await a.next();
    await b.next();
    const col = firstColumnId(b.welcome);
    for (const blocked of [
      { kind: "note.move", id: "note00001", x: 50, y: 50 },
      { kind: "note.toCard", id: "note00001", cardId: "card00001", columnId: col, position: "a0" },
      { kind: "note.delete", id: "note00001" },
    ]) {
      assert.match((await op(b, blocked)).reason, /Teal Otter is moving/);
    }
    a.ws.close();
    b.ws.close();
  },

  async "the creator is host and can make parts of the board view-only for others"() {
    const res = await fetch(`${base}/api/boards`, { method: "POST" });
    const { id, hostKey } = await res.json();
    assert.match(hostKey, /^[A-Za-z0-9_-]{32}$/);

    const host = await join(id, "Hana", 0, hostKey);
    const guest = await join(id, "Gus");
    const impostor = await join(id, "Ivy", 0, "x".repeat(32));
    await host.next(); // join(guest)
    await host.next(); // join(impostor)
    await guest.next(); // join(impostor)
    assert.equal(host.welcome.you.host, true);
    assert.equal(guest.welcome.you.host, false);
    assert.equal(impostor.welcome.you.host, false, "a wrong key doesn't make you host");
    assert.equal(guest.welcome.peers.find((p) => p.name === "Hana").host, true, "others see who the host is");
    assert.equal(host.welcome.sync.board.hasHost, true);
    assert.deepEqual(host.welcome.sync.board.permissions, { renameBoard: true, editBulletin: true, editCards: true, moveCards: true });

    const col = firstColumnId(host.welcome);
    await op(host, { kind: "card.create", id: "card00001", columnId: col, position: "a0", title: "Plan" });
    await guest.next(); // opb
    await impostor.next(); // opb

    const lockdown = { renameBoard: true, editBulletin: false, editCards: false, moveCards: false };
    const denied = await op(guest, { kind: "board.permissions", permissions: lockdown });
    assert.equal(denied.reason, "Only the host can change permissions");
    assert.equal((await op(host, { kind: "board.permissions", permissions: lockdown })).t, "ack");
    assert.deepEqual((await guest.next()).op.op.permissions, lockdown);
    await impostor.next(); // opb

    const viewOnly = "The host has made this view-only";
    for (const blocked of [
      { kind: "card.create", id: "card00002", columnId: col, position: "a1", title: "Sneaky" },
      { kind: "card.update", id: "card00001", patch: { title: "Changed" } },
      { kind: "card.move", id: "card00001", columnId: col, position: "a5" },
      { kind: "column.create", id: "col0000009", title: "Extra", position: "a9" },
      { kind: "note.create", id: "note00001", x: 0, y: 0, w: 200, h: 200, color: "amber", text: "" },
    ]) {
      assert.equal((await op(guest, blocked)).reason, viewOnly, blocked.kind);
    }
    guest.send({ t: "lock", cardId: "card00001" });
    assert.equal((await guest.next()).t, "lockDenied", "can't even pick the card up");
    assert.equal((await op(guest, { kind: "board.update", title: "Renamed by guest" })).t, "ack", "renaming is still allowed");

    // The host isn't restricted, and the settings persist.
    assert.equal((await host.next()).op.op.title, "Renamed by guest");
    assert.equal((await op(host, { kind: "card.update", id: "card00001", patch: { title: "Host edit" } })).t, "ack");
    for (const c of [host, guest, impostor]) c.ws.close();
    const later = await join(id, "Late");
    assert.deepEqual(later.welcome.sync.board.permissions, lockdown);
    later.ws.close();
  },

  async "cards and notes share one reference counter the room controls"() {
    const id = await newBoard();
    const a = await join(id, "Teal Otter");
    const col = firstColumnId(a.welcome);
    const before = Date.now();
    const card = await op(a, { kind: "card.create", id: "card00001", columnId: col, position: "a0", title: "One", number: 99 });
    const note = await op(a, { kind: "note.create", id: "note00001", x: 0, y: 0, w: 200, h: 200, color: "amber", text: "Two", number: 5 });
    const card2 = await op(a, { kind: "card.create", id: "card00002", columnId: col, position: "a1", title: "Three" });
    assert.deepEqual([card.op.op.number, note.op.op.number, card2.op.op.number], [1, 2, 3], "clients can't pick numbers");

    // Converting gives the new item a fresh number; numbers are never reused.
    const converted = await op(a, { kind: "note.toCard", id: "note00001", cardId: "card00003", columnId: col, position: "a2" });
    assert.equal(converted.op.op.number, 4);

    a.ws.close();
    const b = await join(id, "Amber Fox");
    const board = b.welcome.sync.board;
    assert.deepEqual(Object.values(board.cards).map((c) => c.number).sort(), [1, 3, 4]);
    await op(b, { kind: "note.create", id: "note00002", x: 0, y: 0, w: 200, h: 200, color: "blue", text: "Five" });
    b.ws.close();
    const c = await join(id, "Plum Owl");
    const n = c.welcome.sync.board.notes.note00002;
    assert.equal(n.number, 5);
    assert.ok(n.createdAt >= before && n.createdAt <= Date.now(), "notes record when they were created");
    c.ws.close();
  },

  async "create endpoint enforces allowed origins"() {
    assert.equal(await rawPost("/api/boards", "https://evil.example"), 403);
    assert.equal(await rawPost("/api/boards", "http://localhost:3000"), 201);
    // Wildcards match one hostname label: Vercel previews yes, look-alikes no.
    assert.equal(await rawPost("/api/boards", "https://lk-git-feature-juhl.vercel.app"), 201);
    assert.equal(await rawPost("/api/boards", "https://evil.lk-x.vercel.app"), 403);
    assert.equal(await rawPost("/api/boards", "https://lk-x.vercel.app.evil.example"), 403);
    assert.equal(await rawPost("/api/boards", "http://lk-x.vercel.app"), 403);
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
