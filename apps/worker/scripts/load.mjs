// Load test from the plan: "50 simulated clients on one board at 30 cursor
// messages/s each, and 1,000 boards with 2 clients each."
//
//   node scripts/load.mjs                                   # both scenarios against a local Worker
//   ADMIN_TOKEN=... node scripts/load.mjs --host livekanban-staging.<you>.workers.dev
//   node scripts/load.mjs --scenario one-board --clients 50 --seconds 30
//
// Every cursor carries a sequence number in its anchor, so receivers can match
// it to its send time (all clients share this process's clock). Reports
// delivery and sender → room → receiver latency, and exits 1 if p95 exceeds
// --max-p95 or delivery drops below --min-delivery.
//
// Against a deployed Worker, ADMIN_TOKEN lets board creation skip Turnstile
// and the per-IP limit. Run it from a machine near where your users are: each
// board's room is created close to its first visitor.
import { parseArgs } from "node:util";
import { unstable_dev } from "wrangler";

const { values: args } = parseArgs({
  options: {
    host: { type: "string" },
    scenario: { type: "string", default: "all" },
    clients: { type: "string", default: "50" },
    rate: { type: "string", default: "30" },
    boards: { type: "string", default: "1000" },
    "board-rate": { type: "string", default: "10" },
    seconds: { type: "string", default: "20" },
    "max-p95": { type: "string", default: "100" },
    // Cursors are latest-wins per 16 ms tick, so a superseded position may never be sent.
    "min-delivery": { type: "string", default: "0.95" },
  },
});
const seconds = Number(args.seconds);
const maxP95 = Number(args["max-p95"]);
const minDelivery = Number(args["min-delivery"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let worker;
let http;
if (args.host) {
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(args.host);
  http = `${local ? "http" : "https"}://${args.host}`;
} else {
  worker = await unstable_dev("src/index.ts", {
    config: "wrangler.jsonc",
    persist: false,
    logLevel: "warn",
    vars: { CREATE_LIMIT_PER_HOUR: "100000", TURNSTILE_SECRET: "", ADMIN_TOKEN: "" },
    experimental: { disableExperimentalWarning: true },
  });
  http = `http://${worker.address}:${worker.port}`;
}
const wsBase = http.replace(/^http/, "ws");

async function createBoard() {
  const headers = process.env.ADMIN_TOKEN ? { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` } : {};
  const res = await fetch(`${http}/api/boards`, { method: "POST", headers });
  if (res.status !== 201) throw new Error(`Board creation failed: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()).id;
}

/** Runs `fn` over `items` with at most `limit` in flight. */
async function pool(items, limit, fn) {
  const out = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/**
 * A client that joins a board and records every cursor it receives.
 * `measure` clients also parse each message for latency; the rest only count,
 * so the load generator itself doesn't become the bottleneck.
 */
function join(boardId, name, stats, measure) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${wsBase}/parties/board-room/${boardId}`);
    const client = { socket, self: null, received: 0, batches: 0, closedEarly: null };
    socket.addEventListener("error", () => reject(new Error(`socket error for ${name}`)), { once: true });
    socket.addEventListener("close", (e) => (client.closedEarly ??= e.code));
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ t: "hello", clientId: name, name, color: "#0d9488", custom: true, lastSeq: 0 }));
    });
    socket.addEventListener("message", (e) => {
      const data = e.data;
      if (data.startsWith('["C"')) {
        client.batches++;
        for (const [id, anchor] of JSON.parse(data)[1]) {
          if (id === client.self) continue;
          client.received++;
          if (measure) {
            const start = stats.sentAt.get(anchor);
            if (start !== undefined) stats.latencies.push(performance.now() - start);
          }
        }
      } else if (data.includes('"t":"welcome"')) {
        client.self = JSON.parse(data).self;
        resolve(client);
      }
    });
  });
}

/** Each client sends `rate` cursors per second for `seconds`; anchors encode sender and sequence. */
async function drive(clients, rate, stats) {
  const interval = 1000 / rate;
  const end = performance.now() + seconds * 1000;
  await Promise.all(
    clients.map(async (c, i) => {
      await sleep(Math.random() * interval); // spread senders across the interval
      for (let seq = 0; performance.now() < end; seq++) {
        const anchor = `L${i}x${seq}`;
        stats.sentAt.set(anchor, performance.now());
        if (c.socket.readyState === WebSocket.OPEN) {
          c.socket.send(JSON.stringify(["c", anchor, Math.random(), Math.random()]));
          c.sent = (c.sent ?? 0) + 1;
        }
        await sleep(interval);
      }
    }),
  );
  await sleep(2000); // let the last messages arrive
}

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? NaN;

function report(name, groups, stats) {
  let expected = 0;
  let received = 0;
  let dropped = 0;
  let batches = 0;
  for (const group of groups) {
    for (const c of group) batches += c.batches;
    const sent = group.reduce((n, c) => n + (c.sent ?? 0), 0);
    for (const c of group) {
      expected += sent - (c.sent ?? 0); // everyone else's cursors
      received += c.received;
      if (c.closedEarly) dropped++;
    }
  }
  const sorted = stats.latencies.sort((a, b) => a - b);
  const delivery = expected ? received / expected : 0;
  const p95 = percentile(sorted, 95);
  const fmt = (n) => `${n.toFixed(1)} ms`;
  console.log(`\n== ${name}`);
  console.log(`delivered  ${received.toLocaleString()} / ${expected.toLocaleString()} cursor messages (${(delivery * 100).toFixed(2)}%)`);
  console.log(`latency    p50 ${fmt(percentile(sorted, 50))}   p95 ${fmt(p95)}   max ${fmt(sorted.at(-1) ?? NaN)}   (budget p95 ${maxP95} ms, ${sorted.length.toLocaleString()} samples)`);
  console.log(`messages   ${batches.toLocaleString()} batched messages delivered to clients (${(batches / seconds).toFixed(0)}/s)`);
  if (dropped) console.log(`closed     ${dropped} sockets closed during the run`);
  const ok = delivery >= minDelivery && p95 <= maxP95 && !dropped;
  console.log(ok ? "result     PASS" : "result     FAIL");
  return ok;
}

async function oneBoard() {
  const n = Number(args.clients);
  const stats = { sentAt: new Map(), latencies: [] };
  const id = await createBoard();
  const clients = await pool([...Array(n).keys()], 25, (i) => join(id, `load-${i}`, stats, i < 5));
  console.log(`one board: ${n} clients joined, sending ${args.rate} cursors/s each for ${seconds}s…`);
  await drive(clients, Number(args.rate), stats);
  for (const c of clients) c.socket.close();
  return report(`One board, ${n} clients × ${args.rate}/s`, [clients], stats);
}

async function manyBoards() {
  const b = Number(args.boards);
  const stats = { sentAt: new Map(), latencies: [] };
  const ids = await pool([...Array(b).keys()], 20, () => createBoard());
  console.log(`many boards: ${b} boards created, joining 2 clients each…`);
  const pairs = await pool(ids, 50, async (id, i) => [
    await join(id, `b${i}-a`, stats, true),
    await join(id, `b${i}-b`, stats, true),
  ]);
  console.log(`many boards: ${b * 2} clients joined, sending ${args["board-rate"]} cursors/s each for ${seconds}s…`);
  await drive(pairs.flat(), Number(args["board-rate"]), stats);
  for (const c of pairs.flat()) c.socket.close();
  return report(`${b} boards × 2 clients × ${args["board-rate"]}/s`, pairs, stats);
}

let passed = true;
try {
  console.log(`target     ${args.host ?? "local worker (numbers show room overhead only; run against staging for real latency)"}`);
  if (args.scenario === "all" || args.scenario === "one-board") passed = (await oneBoard()) && passed;
  if (args.scenario === "all" || args.scenario === "many-boards") passed = (await manyBoards()) && passed;
} finally {
  await worker?.stop();
}
process.exit(passed ? 0 : 1);
