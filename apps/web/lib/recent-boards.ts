const KEY = "lk:recent";
const MAX = 20;
const EVENT = "lk:recent-change";

export interface RecentBoard {
  id: string;
  visitedAt: number;
}

export function readRecentRaw(): string {
  try {
    return localStorage.getItem(KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

export function parseRecent(raw: string): RecentBoard[] {
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(list: RecentBoard[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // Storage blocked: recent boards are a convenience only.
  }
}

export function rememberBoard(id: string) {
  const rest = parseRecent(readRecentRaw()).filter((b) => b.id !== id);
  write([{ id, visitedAt: Date.now() }, ...rest]);
}

export function forgetBoard(id: string) {
  write(parseRecent(readRecentRaw()).filter((b) => b.id !== id));
}

/** For useSyncExternalStore: fires on changes from this tab and from other tabs. */
export function subscribeRecent(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
