/**
 * Host keys (issue #12). Creating a board returns a key that makes this
 * browser its host; it's kept in localStorage per board. A host link
 * (/b/<id>#host=<key>) carries it to another device: the fragment is never
 * sent to servers or logs, and is removed from the address bar once saved.
 */

const keyFor = (boardId: string) => `lk:host:${boardId}`;

export function getHostKey(boardId: string): string | undefined {
  try {
    return localStorage.getItem(keyFor(boardId)) ?? undefined;
  } catch {
    return undefined;
  }
}

export function saveHostKey(boardId: string, hostKey: string) {
  try {
    localStorage.setItem(keyFor(boardId), hostKey);
  } catch {
    // Storage blocked: you're host for this tab only (the key is still sent in hello).
  }
}

/** If the URL is a host link, saves its key and strips it from the address bar. Returns the key. */
export function claimHostFromUrl(boardId: string): string | undefined {
  const match = /^#host=([A-Za-z0-9_-]{16,64})$/.exec(window.location.hash);
  if (!match) return undefined;
  saveHostKey(boardId, match[1]);
  history.replaceState(null, "", window.location.pathname + window.location.search);
  return match[1];
}

export function hostLink(boardId: string, hostKey: string): string {
  return `${window.location.origin}/b/${boardId}#host=${hostKey}`;
}
