/**
 * Anchor-relative coordinates (see "Cursor accuracy" in CLAUDE.md). A point is
 * described by the card, column or board element under it plus fractions of
 * that element's box, so it lands on the same spot on every screen.
 *
 * Elements opt in with `data-anchor="<id>"`. The board container uses
 * "board" and is measured by its scrollable content, so scrolling doesn't
 * shift where others see you.
 */

export const BOARD_ANCHOR = "board";
/** The bulletin canvas. Measured by its scaled box, so fractions are canvas coordinates at any zoom. */
export const CANVAS_ANCHOR = "canvas";

/** The scrollable area on screen (kanban board or bulletin canvas viewport). */
export function presenceArea(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-presence-area]");
}

export interface AnchorPoint {
  anchor: string;
  fx: number;
  fy: number;
}

export function anchorElement(anchor: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(anchor)}"]`);
}

/** What's under viewport point (x, y), or null if it isn't over the board. */
export function locate(x: number, y: number): AnchorPoint | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-anchor]");
  const anchor = el?.dataset.anchor;
  if (!el || !anchor) return null;
  const r = el.getBoundingClientRect();
  if (anchor === BOARD_ANCHOR) {
    return {
      anchor,
      fx: (x - r.left + el.scrollLeft) / el.scrollWidth,
      fy: (y - r.top + el.scrollTop) / el.scrollHeight,
    };
  }
  return { anchor, fx: (x - r.left) / r.width, fy: (y - r.top) / r.height };
}

/** Converts an anchor point back to this viewer's viewport pixels. */
export function toViewport(anchor: string, fx: number, fy: number): { x: number; y: number } | null {
  const el = anchorElement(anchor);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (anchor === BOARD_ANCHOR) {
    return { x: r.left - el.scrollLeft + fx * el.scrollWidth, y: r.top - el.scrollTop + fy * el.scrollHeight };
  }
  return { x: r.left + fx * r.width, y: r.top + fy * r.height };
}

/** Scrolls so that an anchor point is centred in view. */
export function revealAnchor(anchor: string, fx: number, fy: number) {
  const el = anchorElement(anchor);
  const area = presenceArea();
  if (!el) return;
  // Board and canvas points: scroll the visible area so the point is centred.
  if ((anchor === BOARD_ANCHOR || anchor === CANVAS_ANCHOR) && area) {
    const p = toViewport(anchor, fx, fy);
    if (!p) return;
    const r = area.getBoundingClientRect();
    area.scrollBy({ left: p.x - (r.left + r.width / 2), top: p.y - (r.top + r.height / 2), behavior: "smooth" });
    return;
  }
  el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
}
