/**
 * Wire protocol shared by the web client and the BoardRoom Durable Object.
 * See "Message types" in CLAUDE.md.
 */

import type { BoardData, CommittedOp, Op } from "./board";
import { ITEM_ID_RE, parseOp } from "./ops";

export * from "./board";
export * from "./ops";

/** PartyServer namespace: the kebab-cased `BoardRoom` binding name. */
export const PARTY = "board-room";

/** Board IDs are 21-character nanoids (~126 bits). */
export const BOARD_ID_RE = /^[A-Za-z0-9_-]{21}$/;

/**
 * Max socket message length in UTF-16 units. The plan's 4 KB cap can't carry a
 * 10,000-character description, so ops get room for one plus the envelope.
 */
export const MAX_MESSAGE_LENGTH = 12_000;
export const MAX_CONNECTIONS = 50;
export const MAX_NAME_LENGTH = 40;

/** WebSocket close codes in the private 4000–4999 range. */
export const CloseCode = {
  Expired: 4404,
  RoomFull: 4429,
} as const;

export interface Identity {
  clientId: string;
  name: string;
  color: string;
}

/** A connected visitor. Lives in the room's per-connection state, never in SQLite. */
export interface Peer extends Identity {
  connectionId: string;
  /** Card or column id whose text this peer is editing. */
  editing: string | null;
  /** Card this peer has locked by picking it up. */
  holding: string | null;
  /** No input for a while. */
  idle: boolean;
  /** Tab hidden; their cursor is not shown. */
  away: boolean;
}

/** Peer fields a client may change about itself. */
export type PresencePatch = Partial<Pick<Peer, "editing" | "idle" | "away">>;

/**
 * Cursor position relative to what's under the pointer (see "Cursor accuracy"
 * in CLAUDE.md): `anchor` is a card, column or note id or "board"; fx/fy are
 * fractions of that element's box. A null anchor hides the cursor.
 * Sent as a bare array to keep the most frequent message tiny.
 */
export type CursorMessage = ["c", anchor: string | null, fx: number, fy: number];
/** As relayed by the room, stamped with the sender's connection id. */
export type CursorBroadcast = ["c", connectionId: string, anchor: string | null, fx: number, fy: number];

export type ClientMessage =
  | { t: "hello"; clientId: string; name: string; color: string; lastSeq: number }
  | { t: "ping"; at: number }
  /** `cid` is the client's id for this op, echoed back in ack/reject. */
  | { t: "op"; cid: string; op: Op }
  | CursorMessage
  | { t: "presence"; patch: PresencePatch }
  | { t: "profile"; name: string; color: string }
  | { t: "lock"; cardId: string }
  | { t: "unlock"; cardId: string };

/** How a (re)connecting client catches up: full state, or the ops it missed. */
export type Sync =
  | { type: "snapshot"; seq: number; board: BoardData }
  | { type: "replay"; ops: CommittedOp[] };

export type ServerMessage =
  | { t: "welcome"; self: string; peers: Peer[]; createdAt: number; keptUntil: number; sync: Sync }
  | { t: "join"; peer: Peer }
  /** A peer's presence, profile or lock changed (sent to everyone, including that peer). */
  | { t: "peer"; peer: Peer }
  | { t: "leave"; connectionId: string }
  | { t: "pong"; at: number }
  /** Your op was committed; `op` is the canonical form to apply (positions may be adjusted). */
  | { t: "ack"; cid: string; op: CommittedOp }
  | { t: "reject"; cid: string; reason: string }
  /** Someone else's committed op. */
  | { t: "opb"; op: CommittedOp }
  /** Someone else already holds the card you tried to pick up. */
  | { t: "lockDenied"; cardId: string; by: string }
  | CursorBroadcast
  | { t: "expired" };

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const ANCHOR_RE = /^[A-Za-z0-9_-]{1,32}$/;

function isShortString(v: unknown, max: number): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= max;
}

/** Display name and color as accepted from a client, or null if invalid. */
export function parseProfile(name: unknown, color: unknown): { name: string; color: string } | null {
  if (!isShortString(name, MAX_NAME_LENGTH) || typeof color !== "string" || !COLOR_RE.test(color)) return null;
  return { name: name.trim() || "Anonymous", color };
}

const isFraction = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= -1 && v <= 2;

function parseCursor(m: unknown[]): CursorMessage | null {
  const [, anchor, fx, fy] = m;
  if (anchor === null) return ["c", null, 0, 0];
  if (typeof anchor !== "string" || !ANCHOR_RE.test(anchor) || !isFraction(fx) || !isFraction(fy)) return null;
  return ["c", anchor, fx, fy];
}

function parsePresence(v: unknown): PresencePatch | null {
  if (typeof v !== "object" || v === null) return null;
  const m = v as Record<string, unknown>;
  const patch: PresencePatch = {};
  if ("editing" in m) {
    if (m.editing !== null && !(typeof m.editing === "string" && ANCHOR_RE.test(m.editing))) return null;
    patch.editing = m.editing as string | null;
  }
  if ("idle" in m) {
    if (typeof m.idle !== "boolean") return null;
    patch.idle = m.idle;
  }
  if ("away" in m) {
    if (typeof m.away !== "boolean") return null;
    patch.away = m.away;
  }
  return Object.keys(patch).length ? patch : null;
}

/** An op whose envelope parsed but whose body is invalid; the room rejects it by `cid`. */
export type ParsedClientMessage = ClientMessage | { t: "badOp"; cid: string };

/** Validates untrusted input from a socket. Returns null for anything malformed. */
export function parseClientMessage(raw: string): ParsedClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (Array.isArray(data)) return data[0] === "c" ? parseCursor(data) : null;
  if (typeof data !== "object" || data === null) return null;
  const m = data as Record<string, unknown>;

  switch (m.t) {
    case "hello": {
      const profile = parseProfile(m.name, m.color);
      if (!profile || !isShortString(m.clientId, 64) || !Number.isSafeInteger(m.lastSeq)) return null;
      return { t: "hello", clientId: m.clientId, ...profile, lastSeq: m.lastSeq as number };
    }
    case "ping":
      return Number.isFinite(m.at) ? { t: "ping", at: m.at as number } : null;
    case "op": {
      if (typeof m.cid !== "string" || m.cid.length === 0 || m.cid.length > 32) return null;
      const op = parseOp(m.op);
      return op ? { t: "op", cid: m.cid, op } : { t: "badOp", cid: m.cid };
    }
    case "presence": {
      const patch = parsePresence(m.patch);
      return patch ? { t: "presence", patch } : null;
    }
    case "profile": {
      const profile = parseProfile(m.name, m.color);
      return profile ? { t: "profile", ...profile } : null;
    }
    case "lock":
    case "unlock":
      return typeof m.cardId === "string" && ITEM_ID_RE.test(m.cardId) ? { t: m.t, cardId: m.cardId } : null;
    default:
      return null;
  }
}

export function encode(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}
