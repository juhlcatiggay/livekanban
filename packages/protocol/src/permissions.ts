import type { Op } from "./board";

/**
 * What everyone except the host may change (issue #12). The host is whoever
 * holds the board's host key, minted when the board was created. All
 * default to true, so a board behaves as before until the host restricts it.
 */
export interface Permissions {
  /** Rename the board. */
  renameBoard: boolean;
  /** Add, edit, move, pin or delete sticky notes. */
  editBulletin: boolean;
  /** Add, edit or delete cards and columns. */
  editCards: boolean;
  /** Move cards and columns. */
  moveCards: boolean;
}

export type Permission = keyof Permissions;

export const DEFAULT_PERMISSIONS: Permissions = {
  renameBoard: true,
  editBulletin: true,
  editCards: true,
  moveCards: true,
};

export const PERMISSION_LABELS: Record<Permission, string> = {
  renameBoard: "rename the board",
  editBulletin: "edit the bulletin board",
  editCards: "add, edit and delete cards and columns",
  moveCards: "move cards and columns",
};

/**
 * Which permissions an op needs from a non-host. Shared by the room (which
 * enforces it) and the UI (which hides what you can't do), so they agree.
 * `board.permissions` returns null: only the host may send it.
 */
export function requiredPermissions(op: Op): Permission[] | null {
  switch (op.kind) {
    case "board.permissions":
      return null;
    case "board.update":
      return ["renameBoard"];
    case "column.move":
    case "card.move":
      return ["moveCards"];
    case "column.create":
    case "column.update":
    case "column.delete":
    case "column.restore":
    case "card.create":
    case "card.update":
    case "card.delete":
    case "card.restore":
      return ["editCards"];
    case "note.create":
    case "note.update":
    case "note.move":
    case "note.delete":
    case "note.restore":
    case "board.pin":
      return ["editBulletin"];
    case "note.toCard":
    case "card.toNote":
      return ["editBulletin", "editCards"];
  }
}

/** True if someone with these rights may send `op`. */
export function isAllowed(op: Op, permissions: Permissions, isHost: boolean): boolean {
  if (isHost) return true;
  const needed = requiredPermissions(op);
  return needed !== null && needed.every((p) => permissions[p]);
}

export function parsePermissions(v: unknown): Permissions | null {
  if (typeof v !== "object" || v === null) return null;
  const m = v as Record<string, unknown>;
  const keys = Object.keys(DEFAULT_PERMISSIONS) as Permission[];
  if (!keys.every((k) => typeof m[k] === "boolean")) return null;
  return Object.fromEntries(keys.map((k) => [k, m[k]])) as unknown as Permissions;
}
