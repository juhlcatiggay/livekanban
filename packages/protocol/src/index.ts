/**
 * Wire protocol shared by the web client and the BoardRoom Durable Object.
 * See "Message types" in CLAUDE.md.
 */

import type { BoardData, CommittedOp, Op } from "./board";
import { ITEM_ID_RE, parseOp } from "./ops";

export * from "./board";
export * from "./export";
export * from "./ops";
export * from "./permissions";

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
/** Board passwords: optional, set by the host. */
export const PASSWORD = { min: 4, max: 128 } as const;
/** History entries per page. */
export const HISTORY_PAGE = 50;

/** WebSocket close codes in the private 4000–4999 range. */
export const CloseCode = {
  /** Repeatedly exceeded the per-connection message rate. */
  RateLimited: 4008,
  Expired: 4404,
  RoomFull: 4429,
} as const;

/** Something in the 7-day trash. A deleted column's cards come back with it. */
export interface TrashItem {
  kind: "column" | "card" | "note";
  id: string;
  /** Title, or the start of a note's text. */
  label: string;
  deletedAt: number;
  /** For columns: how many cards will be restored with it. */
  cardCount?: number;
}

/** One of the board's daily backups (UTC day, YYYY-MM-DD). */
export interface BackupInfo {
  day: string;
  at: number;
}

/** Cursor and avatar colors: saturated enough to read on light and dark backgrounds. */
export const PEOPLE_COLORS = ["#0d9488", "#d97706", "#e11d48", "#4f46e5", "#65a30d", "#9333ea", "#0284c7", "#c2410c", "#db2777", "#059669"];

/** This browser's identity, kept in localStorage. Never shared with other people. */
export interface Identity {
  clientId: string;
  name: string;
  color: string;
  /**
   * True once the person has chosen their own name and color. Otherwise each
   * board's room assigns a name (unique on that board) and keeps it for them.
   */
  custom?: boolean;
}

/**
 * A connected visitor as everyone sees them. Lives in the room's
 * per-connection state, never in SQLite. Has no client ID, so nobody can copy
 * someone else's ID to take over their name.
 */
export interface Peer {
  name: string;
  color: string;
  connectionId: string;
  /** Card or column id whose text this peer is editing. */
  editing: string | null;
  /** Card this peer has locked by picking it up. */
  holding: string | null;
  /** No input for a while. */
  idle: boolean;
  /** Tab hidden; their cursor is not shown. */
  away: boolean;
  /** Holds the board's host key (issue #12). */
  host: boolean;
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
export type CursorEntry = [connectionId: string, anchor: string | null, fx: number, fy: number];
/**
 * The room batches cursors: at most once per CURSOR_TICK_MS it sends everyone
 * one message with the latest position of each person who moved (immediately
 * if nothing was sent in the last tick). Relaying every cursor to every viewer
 * grows with the square of the room size (50 people at 30/s is ~73,500
 * messages/s); batching keeps it to one message per viewer per tick. The batch
 * includes your own cursor; clients skip it.
 */
export type CursorBroadcast = ["C", entries: CursorEntry[]];

/** Minimum gap between cursor flushes (~60 Hz); under load adds at most this much latency, when quiet none. */
export const CURSOR_TICK_MS = 16;

export type ClientMessage =
  /** `hostKey`, if this browser created the board (or opened a host link), makes it the host. */
  | { t: "hello"; clientId: string; name: string; color: string; custom: boolean; lastSeq: number; hostKey?: string; password?: string }
  | { t: "ping"; at: number }
  /** `cid` is the client's id for this op, echoed back in ack/reject. */
  | { t: "op"; cid: string; op: Op }
  | CursorMessage
  | { t: "presence"; patch: PresencePatch }
  | { t: "profile"; name: string; color: string }
  | { t: "lock"; cardId: string }
  | { t: "unlock"; cardId: string }
  /** Asks for the trash and backup list; answered with `trash`. */
  | { t: "trash" }
  /** Asks for one daily backup; answered with `backup`. */
  | { t: "backup"; day: string }
  /** Host only: deletes the whole board for everyone, permanently. */
  | { t: "deleteBoard" }
  /** Host only: sets (or with null removes) the password needed to open the board. */
  | { t: "setPassword"; password: string | null }
  /** Asks for history, newest first, older than `before` (a seq); `id` limits it to one card or note. */
  | { t: "history"; before?: number; id?: string };

/** How a (re)connecting client catches up: full state, or the ops it missed. */
export type Sync =
  | { type: "snapshot"; seq: number; board: BoardData }
  | { type: "replay"; ops: CommittedOp[] };

export type ServerMessage =
  | { t: "welcome"; self: string; you: Peer; peers: Peer[]; createdAt: number; keptUntil: number; sync: Sync; locked: boolean }
  /** The board has a password and `hello` didn't carry the right one (`wrong`: one was given). Send hello again. */
  | { t: "passwordRequired"; wrong: boolean; retryAfterMs?: number }
  /** The host set or removed the board's password. */
  | { t: "locked"; locked: boolean }
  /** A page of history, newest first; `more` if older entries exist. */
  | { t: "history"; id?: string; entries: CommittedOp[]; more: boolean }
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
  /** Activity moved the expiry date. */
  | { t: "kept"; keptUntil: number }
  | { t: "trash"; items: TrashItem[]; backups: BackupInfo[] }
  /** A daily backup's board, or null if it no longer exists. */
  | { t: "backup"; day: string; board: BoardData | null }
  /** Your rename was refused (e.g. someone on this board already has that name). */
  | { t: "profileRejected"; reason: string }
  /** Someone else already holds the card you tried to pick up. */
  | { t: "lockDenied"; cardId: string; by: string }
  | CursorBroadcast
  | { t: "expired" }
  /** The host deleted the board; `by` is their name. The connection closes next. */
  | { t: "deleted"; by: string }
  /** A host-only request (deleteBoard, setPassword) from someone who isn't the host. */
  | { t: "refused"; reason: string };

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
      const hostKey = typeof m.hostKey === "string" && m.hostKey.length <= 64 ? m.hostKey : undefined;
      const password = typeof m.password === "string" && m.password.length <= PASSWORD.max ? m.password : undefined;
      return { t: "hello", clientId: m.clientId, ...profile, custom: m.custom === true, lastSeq: m.lastSeq as number, hostKey, password };
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
    case "trash":
      return { t: "trash" };
    case "deleteBoard":
      return { t: "deleteBoard" };
    case "setPassword":
      if (m.password === null) return { t: "setPassword", password: null };
      return typeof m.password === "string" && m.password.length >= PASSWORD.min && m.password.length <= PASSWORD.max
        ? { t: "setPassword", password: m.password }
        : null;
    case "history": {
      const before = m.before === undefined || (Number.isSafeInteger(m.before) && (m.before as number) > 0) ? (m.before as number | undefined) : null;
      const id = m.id === undefined || (typeof m.id === "string" && ITEM_ID_RE.test(m.id)) ? (m.id as string | undefined) : null;
      return before === null || id === null ? null : { t: "history", before, id };
    }
    case "backup":
      return typeof m.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(m.day) ? { t: "backup", day: m.day } : null;
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
