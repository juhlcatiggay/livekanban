import { PEOPLE_COLORS, type Identity } from "@livekanban/protocol";

const KEY = "lk:identity";

/**
 * A fresh browser identity. The name is only a placeholder until the room
 * answers: each board gives its members a unique Marvel name and keeps it.
 */
function randomIdentity(): Identity {
  return {
    clientId: crypto.randomUUID(),
    name: "Guest",
    color: PEOPLE_COLORS[crypto.getRandomValues(new Uint32Array(1))[0] % PEOPLE_COLORS.length],
  };
}

/** Returns this browser's identity, creating and storing one on first visit. Client-only. */
export function getIdentity(): Identity {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "null") as Identity | null;
    if (stored?.clientId && stored.name && stored.color) return stored;
  } catch {
    // Corrupt or blocked storage: fall through to a fresh identity.
  }
  const identity = randomIdentity();
  saveIdentity(identity);
  return identity;
}

export function saveIdentity(identity: Identity) {
  try {
    localStorage.setItem(KEY, JSON.stringify(identity));
  } catch {
    // Storage blocked (private mode): identity lasts for this tab only.
  }
}
