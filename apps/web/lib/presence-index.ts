import type { Peer } from "@livekanban/protocol";

/** Other people's presence, keyed by the card, column or note id it concerns. */
export interface PresenceIndex {
  heldBy: Record<string, Peer>;
  editors: Record<string, Peer[]>;
}

export function indexPresence(peers: Record<string, Peer>): PresenceIndex {
  const index: PresenceIndex = { heldBy: {}, editors: {} };
  for (const p of Object.values(peers)) {
    if (p.holding) index.heldBy[p.holding] = p;
    if (p.editing) (index.editors[p.editing] ??= []).push(p);
  }
  return index;
}
