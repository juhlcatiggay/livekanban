/**
 * Board passwords this browser has entered, so a protected board opens
 * straight away next time. Kept in localStorage per board, like host keys;
 * a wrong or changed password is forgotten when the room refuses it.
 */
const keyFor = (boardId: string) => `lk:password:${boardId}`;

export function getBoardPassword(boardId: string): string | undefined {
  try {
    return localStorage.getItem(keyFor(boardId)) ?? undefined;
  } catch {
    return undefined;
  }
}

export function saveBoardPassword(boardId: string, password: string) {
  try {
    localStorage.setItem(keyFor(boardId), password);
  } catch {
    // Storage blocked: asked again next visit.
  }
}

export function forgetBoardPassword(boardId: string) {
  try {
    localStorage.removeItem(keyFor(boardId));
  } catch {
    // Nothing to forget.
  }
}
