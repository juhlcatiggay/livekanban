"use client";

import { DEFAULT_PERMISSIONS, type Permissions } from "@livekanban/protocol";
import { useBoard } from "./board-store";

export interface Can extends Permissions {
  isHost: boolean;
}

/**
 * What this tab may change right now: everything if it's the host, otherwise
 * whatever the host allows. The room enforces the same rules
 * (requiredPermissions in the protocol); this only hides controls that would
 * be rejected.
 */
export function useCan(): Can {
  const isHost = useBoard((s) => s.selfPeer?.host ?? false);
  const permissions = useBoard((s) => s.board?.permissions ?? DEFAULT_PERMISSIONS);
  if (isHost) return { isHost, renameBoard: true, editBulletin: true, editCards: true, moveCards: true };
  return { isHost, ...permissions };
}
