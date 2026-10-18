import type { Identity } from "@livekanban/protocol";

const KEY = "lk:identity";

const ADJECTIVES = ["Teal", "Amber", "Coral", "Indigo", "Olive", "Plum", "Saffron", "Slate", "Ruby", "Jade", "Copper", "Azure"];
const ANIMALS = ["Otter", "Fox", "Heron", "Lynx", "Panda", "Gecko", "Owl", "Badger", "Koala", "Marten", "Puffin", "Ibex"];
const COLORS = ["#0d9488", "#d97706", "#e11d48", "#4f46e5", "#65a30d", "#9333ea", "#0284c7", "#c2410c", "#db2777", "#059669"];

function pick<T>(items: readonly T[]): T {
  return items[crypto.getRandomValues(new Uint32Array(1))[0] % items.length];
}

function randomIdentity(): Identity {
  return {
    clientId: crypto.randomUUID(),
    name: `${pick(ADJECTIVES)} ${pick(ANIMALS)}`,
    color: pick(COLORS),
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
  try {
    localStorage.setItem(KEY, JSON.stringify(identity));
  } catch {
    // Storage blocked (private mode): identity lasts for this tab only.
  }
  return identity;
}
