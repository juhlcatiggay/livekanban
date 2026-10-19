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
  if (!el) return;
  if (anchor === BOARD_ANCHOR) {
    el.scrollTo({
      left: fx * el.scrollWidth - el.clientWidth / 2,
      top: fy * el.scrollHeight - el.clientHeight / 2,
      behavior: "smooth",
    });
    return;
  }
  el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
}
