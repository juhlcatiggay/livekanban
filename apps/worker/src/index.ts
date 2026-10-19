import { getServerByName, routePartykitRequest } from "partyserver";
import { nanoid } from "nanoid";
import { BOARD_ID_RE, MAX_IMPORT_BYTES, importToOps, type Op } from "@livekanban/protocol";
import { HOUR_MS } from "./config";
import { originMatcher } from "./origins";

export { BoardRoom } from "./board-room";
export { CreationLimiter } from "./limiter";

let matcher: { source: string; matches: (origin: string) => boolean } | undefined;

function allowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  if (matcher?.source !== env.ALLOWED_ORIGINS) {
    matcher = { source: env.ALLOWED_ORIGINS, matches: originMatcher(env.ALLOWED_ORIGINS) };
  }
  return matcher.matches(origin) ? origin : null;
}

/** Browsers always send Origin; reject cross-site pages. Non-browser clients omit it. */
function originRejected(request: Request, env: Env): boolean {
  return request.headers.has("Origin") && !allowedOrigin(request, env);
}

function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = allowedOrigin(request, env);
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Expose-Headers": "Retry-After",
    Vary: "Origin",
  };
}

const clientIp = (request: Request) => request.headers.get("CF-Connecting-IP") ?? "local";

async function verifyTurnstile(token: unknown, request: Request, secret: string): Promise<boolean> {
  if (typeof token !== "string" || !token || token.length > 2048) return false;
  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  body.append("remoteip", clientIp(request));
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  const result = (await res.json()) as { success?: boolean };
  return result.success === true;
}

interface CreateBody {
  turnstileToken?: string;
  /** A board export (see toExport) to restore into the new board. */
  import?: unknown;
}

async function createBoard(request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const error = (status: number, message: string, headers: HeadersInit = {}) =>
    Response.json({ error: message }, { status, headers: { ...cors, ...headers } });

  if (Number(request.headers.get("Content-Length") ?? 0) > MAX_IMPORT_BYTES) return error(413, "Import is too large");
  const text = await request.text();
  if (text.length > MAX_IMPORT_BYTES) return error(413, "Import is too large");
  let body: CreateBody = {};
  if (text) {
    try {
      body = JSON.parse(text) as CreateBody;
    } catch {
      return error(400, "Body must be JSON");
    }
  }

  // Operator scripts (load tests, restores) authenticate with the admin token instead.
  const trusted = isAdmin(request, env);

  if (!trusted && env.TURNSTILE_SECRET && !(await verifyTurnstile(body.turnstileToken, request, env.TURNSTILE_SECRET))) {
    return error(403, "Verification failed. Reload the page and try again.");
  }

  if (!trusted) {
    const limiter = env.CreationLimiter.get(env.CreationLimiter.idFromName(clientIp(request)));
    const slot = await limiter.take(Number(env.CREATE_LIMIT_PER_HOUR), HOUR_MS);
    if (!slot.ok) {
      return error(429, "Too many new boards from your network. Try again later.", {
        "Retry-After": String(Math.ceil(slot.retryAfterMs / 1000)),
      });
    }
  }

  let ops: Op[] = [];
  if (body.import !== undefined) {
    const parsed = importToOps(body.import);
    if (!parsed) return error(400, "That file isn't a LiveKanban export");
    ops = parsed.ops;
  }

  const id = nanoid();
  const room = await getServerByName(env.BoardRoom, id);
  const res = await room.fetch(
    new Request("https://room/init", { method: "POST", body: JSON.stringify({ ops }), headers: { "Content-Type": "application/json" } }),
  );
  if (res.status !== 201) throw new Error(`Room init failed: ${res.status}`);
  const { imported, skipped } = (await res.json()) as { imported: number; skipped: number };
  return Response.json({ id, imported, skipped }, { status: 201, headers: cors });
}

/** Constant-time comparison so the admin token can't be guessed byte by byte. */
function sameToken(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  return crypto.subtle.timingSafeEqual(x, y);
}

function isAdmin(request: Request, env: Env): boolean {
  const auth = request.headers.get("Authorization");
  return !!env.ADMIN_TOKEN && !!auth && sameToken(auth, `Bearer ${env.ADMIN_TOKEN}`);
}

/** DELETE /admin/boards/:id, for takedowns. Only exists when ADMIN_TOKEN is set. */
async function adminDelete(request: Request, env: Env, id: string): Promise<Response> {
  if (!isAdmin(request, env)) return new Response("Unauthorized", { status: 401 });
  if (!BOARD_ID_RE.test(id)) return new Response("Not found", { status: 404 });
  const room = await getServerByName(env.BoardRoom, id);
  const res = await room.fetch(new Request("https://room/admin/delete", { method: "POST" }));
  return new Response(res.status === 204 ? "Deleted" : "Not found", { status: res.status === 204 ? 200 : 404 });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    if (url.pathname === "/api/boards" && request.method === "POST") {
      if (originRejected(request, env)) return new Response("Forbidden", { status: 403 });
      return createBoard(request, env, cors);
    }

    const admin = /^\/admin\/boards\/([^/]+)$/.exec(url.pathname);
    if (admin && env.ADMIN_TOKEN && request.method === "DELETE") return adminDelete(request, env, admin[1]);

    const routed = await routePartykitRequest(request, env, {
      onBeforeConnect(req, { name }) {
        if (!BOARD_ID_RE.test(name)) return new Response("Not found", { status: 404 });
        if (originRejected(req, env)) return new Response("Forbidden", { status: 403 });
      },
      onBeforeRequest(req, { name }) {
        // Only status reads are public; /init and /admin/delete are reachable solely from this Worker.
        if (!BOARD_ID_RE.test(name) || req.method !== "GET") {
          return new Response("Not found", { status: 404 });
        }
      },
    });
    if (routed) {
      if (routed.status === 101) return routed;
      const headers = new Headers(routed.headers);
      for (const [k, v] of Object.entries(cors)) headers.set(k, v);
      return new Response(routed.body, { status: routed.status, headers });
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
