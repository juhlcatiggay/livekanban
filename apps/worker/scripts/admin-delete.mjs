// Takes a board down: disconnects everyone and permanently erases it.
//
//   ADMIN_TOKEN=... pnpm --filter worker admin:delete --host livekanban.example.workers.dev --board <board-id>
//
// The Worker must have the same ADMIN_TOKEN set (`wrangler secret put ADMIN_TOKEN`).
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { host: { type: "string" }, board: { type: "string" } } });
const token = process.env.ADMIN_TOKEN;
if (!values.host || !values.board || !token) {
  console.error("Usage: ADMIN_TOKEN=... admin:delete --host <worker-host> --board <board-id>");
  process.exit(2);
}

const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(values.host);
const res = await fetch(`${local ? "http" : "https"}://${values.host}/admin/boards/${encodeURIComponent(values.board)}`, {
  method: "DELETE",
  headers: { Authorization: `Bearer ${token}` },
});
console.log(`${res.status} ${await res.text()}`);
process.exit(res.ok ? 0 : 1);
