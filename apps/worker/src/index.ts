import { getServerByName, routePartykitRequest } from "partyserver";
import { nanoid } from "nanoid";
import { BOARD_ID_RE } from "@livekanban/protocol";

export { BoardRoom } from "./board-room";

function allowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  const allowed = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim());
  return allowed.includes(origin) ? origin : null;
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
    Vary: "Origin",
  };
}

async function createBoard(env: Env): Promise<string> {
  const id = nanoid();
  const room = await getServerByName(env.BoardRoom, id);
  const res = await room.fetch(new Request("https://room/init", { method: "POST" }));
  if (res.status !== 201) throw new Error(`Room init failed: ${res.status}`);
  return id;
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    if (url.pathname === "/api/boards" && request.method === "POST") {
      if (originRejected(request, env)) return new Response("Forbidden", { status: 403 });
      // TODO(phase 5): Turnstile check and per-IP creation limit.
      const id = await createBoard(env);
      return Response.json({ id }, { status: 201, headers: cors });
    }

    const routed = await routePartykitRequest(request, env, {
      onBeforeConnect(req, { name }) {
        if (!BOARD_ID_RE.test(name)) return new Response("Not found", { status: 404 });
        if (originRejected(req, env)) return new Response("Forbidden", { status: 403 });
      },
      onBeforeRequest(req, { name }) {
        // Only status reads are public; /init is reachable solely via createBoard().
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
