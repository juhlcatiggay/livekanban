import type { Permissions } from "@livekanban/protocol";
import { workerUrl } from "./config";
import { saveHostKey } from "./host";
import { rememberBoard } from "./recent-boards";

export interface NewBoard {
  title?: string;
  password?: string;
  permissions?: Permissions;
  /** A board export (see toExport) to restore into the new board. */
  import?: unknown;
  turnstileToken?: string;
}

/**
 * Creates a board and makes this browser its host. Resolves with its id;
 * rejects with a message fit to show.
 */
export async function createBoard(board: NewBoard): Promise<string> {
  let res: Response;
  try {
    res = await fetch(workerUrl("/api/boards"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(board),
    });
  } catch {
    throw new Error("Couldn't create a board. Check your connection and try again.");
  }
  const body = (await res.json().catch(() => ({}))) as { id?: string; hostKey?: string; error?: string };
  if (!res.ok || !body.id) throw new Error(body.error ?? "Couldn't create a board. Try again in a moment.");
  // You created it, so you're its host (issue #12).
  if (body.hostKey) saveHostKey(body.id, body.hostKey);
  rememberBoard(body.id, board.title || undefined);
  return body.id;
}
