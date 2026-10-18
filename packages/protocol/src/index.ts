/**
 * Wire protocol shared by the web client and the BoardRoom Durable Object.
 * See "Message types" in CLAUDE.md; later phases add cursor, editing and lock messages.
 */

import type { BoardData, CommittedOp, Op } from "./board";
import { parseOp } from "./ops";

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

export interface Peer extends Identity {
  connectionId: string;
}

export type ClientMessage =
  | { t: "hello"; clientId: string; name: string; color: string; lastSeq: number }
  | { t: "ping"; at: number }
  /** `cid` is the client's id for this op, echoed back in ack/reject. */
  | { t: "op"; cid: string; op: Op };

/** How a (re)connecting client catches up: full state, or the ops it missed. */
export type Sync =
  | { type: "snapshot"; seq: number; board: BoardData }
  | { type: "replay"; ops: CommittedOp[] };

export type ServerMessage =
  | { t: "welcome"; self: string; peers: Peer[]; createdAt: number; keptUntil: number; sync: Sync }
  | { t: "join"; peer: Peer }
  | { t: "leave"; connectionId: string }
  | { t: "pong"; at: number }
  /** Your op was committed; `op` is the canonical form to apply (positions may be adjusted). */
  | { t: "ack"; cid: string; op: CommittedOp }
  | { t: "reject"; cid: string; reason: string }
  /** Someone else's committed op. */
  | { t: "opb"; op: CommittedOp }
  | { t: "expired" };

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function isShortString(v: unknown, max: number): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= max;
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
  if (typeof data !== "object" || data === null) return null;
  const m = data as Record<string, unknown>;

  switch (m.t) {
    case "hello":
      if (
        isShortString(m.clientId, 64) &&
        isShortString(m.name, MAX_NAME_LENGTH) &&
        typeof m.color === "string" &&
        COLOR_RE.test(m.color) &&
        Number.isSafeInteger(m.lastSeq)
      ) {
        return {
          t: "hello",
          clientId: m.clientId,
          name: m.name.trim() || "Anonymous",
          color: m.color,
          lastSeq: m.lastSeq as number,
        };
      }
      return null;
    case "ping":
      return Number.isFinite(m.at) ? { t: "ping", at: m.at as number } : null;
    case "op": {
      if (typeof m.cid !== "string" || m.cid.length === 0 || m.cid.length > 32) return null;
      const op = parseOp(m.op);
      return op ? { t: "op", cid: m.cid, op } : { t: "badOp", cid: m.cid };
    }
    default:
      return null;
  }
}

export function encode(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}
