import { create } from "zustand";
import { setView } from "@/app/b/[id]/view";

export interface JumpTarget {
  kind: "card" | "note";
  id: string;
}

interface JumpState {
  /** Where a #mention click wants to go; the kanban or bulletin view picks it up. */
  target: JumpTarget | null;
}

export const useJump = create<JumpState>(() => ({ target: null }));

/** How long the target shakes before (for cards) its dialog opens. */
export const SHAKE_MS = 1000;

/**
 * Follows a #mention: switch to the item's tab, glide it into view, shake it
 * for a second so the eye finds it, and (for cards) only then open it.
 */
export function jumpTo(target: JumpTarget) {
  setView(target.kind === "card" ? "kanban" : "bulletin");
  useJump.setState({ target });
}

export function clearJump() {
  useJump.setState({ target: null });
}

/** Scrolls an anchored element into view smoothly and shakes it. Returns false if it isn't on screen yet. */
export function revealAndShake(id: string): boolean {
  const el = document.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(id)}"]`);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  el.classList.remove("lk-shake");
  // Restart the animation even if it was just played.
  void el.offsetWidth;
  el.classList.add("lk-shake");
  setTimeout(() => el.classList.remove("lk-shake"), SHAKE_MS + 200);
  return true;
}
