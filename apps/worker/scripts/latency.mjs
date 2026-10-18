// Cursor latency harness: one client sends cursor messages at 30/s, another
// receives them through the room, and we measure sender → room → receiver time.
// Both clients run in this process, so they share one clock.
//
//   node scripts/latency.mjs                      # boots the Worker locally
//   node scripts/latency.mjs --host livekanban.example.workers.dev --max-p95 100
//
// Exits 1 if p95 exceeds --max-p95 (default 100 ms, the plan's in-region target).
import { parseArgs } from "node:util";
import { unstable_dev } from "wrangler";

const { values: args } = parseArgs({
  options: {
    host: { type: "string" },
    samples: { type: "string", default: "300" },
    rate: { type: "string", default: "30" },
    "max-p95": { type: "string", default: "100" },
  },
});
const samples = Number(args.samples);
const intervalMs = 1000 / Number(args.rate);
const maxP95 = Number(args["max-p95"]);

let worker;
let http;
if (args.host) {
  http = `https://${args.host}`;
} else {
  worker = await unstable_dev("src/index.ts", {
    config: "wrangler.jsonc",
    persist: false,
    logLevel: "warn",
    experimental: { disableExperimentalWarning: true },
  });
  http = `http://${worker.address}:${worker.port}`;
}
const ws = http.replace(/^http/, "ws");

async function join(boardId, name) {
  const socket = new WebSocket(`${ws}/parties/board-room/${boardId}`);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const welcome = new Promise((resolve) =>
    socket.addEventListener("message", function onWelcome(e) {
      if (JSON.parse(e.data).t === "welcome") {
        socket.removeEventListener("message", onWelcome);
        resolve();
      }
    }),
  );
  socket.send(JSON.stringify({ t: "hello", clientId: name, name, color: "#0d9488", lastSeq: 0 }));
  await welcome;
  return socket;
}

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

try {
  const res = await fetch(`${http}/api/boards`, { method: "POST" });
  if (res.status !== 201) throw new Error(`Board creation failed: HTTP ${res.status}`);
  const { id } = await res.json();
  const sender = await join(id, "sender");
  const receiver = await join(id, "receiver");

  // The anchor carries a sequence number so each arrival maps to its send time.
  const sentAt = new Map();
  const latencies = [];
  const done = new Promise((resolve) => {
    receiver.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data);
      if (!Array.isArray(msg) || msg[0] !== "c") return;
      const start = sentAt.get(msg[2]);
      if (start === undefined) return;
      latencies.push(performance.now() - start);
      if (latencies.length === samples) resolve();
    });
  });

  for (let i = 0; i < samples; i++) {
    const anchor = `s${i}`;
    sentAt.set(anchor, performance.now());
    sender.send(JSON.stringify(["c", anchor, Math.random(), Math.random()]));
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  await Promise.race([done, new Promise((r) => setTimeout(r, 5000))]);
  sender.close();
  receiver.close();

  const sorted = latencies.sort((a, b) => a - b);
  const lost = samples - sorted.length;
  const fmt = (n) => `${n.toFixed(1)} ms`;
  console.log(`target   ${args.host ?? "local worker"}`);
  console.log(`samples  ${sorted.length}/${samples} received${lost ? ` (${lost} lost)` : ""}`);
  console.log(`p50      ${fmt(percentile(sorted, 50))}`);
  console.log(`p95      ${fmt(percentile(sorted, 95))}   (budget ${maxP95} ms)`);
  console.log(`max      ${fmt(sorted.at(-1))}`);
  process.exitCode = lost > 0 || percentile(sorted, 95) > maxP95 ? 1 : 0;
} finally {
  await worker?.stop();
}
