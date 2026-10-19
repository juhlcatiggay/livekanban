"use client";

import { useEffect } from "react";
import { locate } from "./anchors";
import { useBoard } from "./board-store";

/** At most 30 cursor messages per second (see "Cursor pipeline" in CLAUDE.md). */
const MIN_SEND_INTERVAL_MS = 1000 / 30;
/** Avatars show as idle after this long without input. */
export const IDLE_AFTER_MS = 60_000;

/**
 * Samples pointermove, coalesces to one update per animation frame, and sends
 * an anchor-relative position only when it changed. Nothing is sent while the
 * pointer is still, so a still cursor costs nothing.
 */
export function useCursorSender() {
  const sendCursor = useBoard((s) => s.sendCursor);

  useEffect(() => {
    let latest: { x: number; y: number } | null = null;
    let frame = 0;
    let lastSentAt = 0;
    let lastKey = "";

    const flush = () => {
      frame = 0;
      if (!latest) return;
      if (performance.now() - lastSentAt < MIN_SEND_INTERVAL_MS) {
        frame = requestAnimationFrame(flush);
        return;
      }
      const point = locate(latest.x, latest.y);
      latest = null;
      const round = (n: number) => Math.round(n * 1e4) / 1e4;
      const key = point ? `${point.anchor}:${round(point.fx)}:${round(point.fy)}` : "none";
      if (key === lastKey) return;
      lastKey = key;
      lastSentAt = performance.now();
      if (point) sendCursor(point.anchor, round(point.fx), round(point.fy));
      else sendCursor(null, 0, 0);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      latest = { x: e.clientX, y: e.clientY };
      if (!frame) frame = requestAnimationFrame(flush);
    };
    const onLeave = () => {
      latest = null;
      if (lastKey !== "none") {
        lastKey = "none";
        sendCursor(null, 0, 0);
      }
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, [sendCursor]);
}

/** Reports `idle` after a minute without input and `away` while the tab is hidden. */
export function useActivity() {
  const setPresence = useBoard((s) => s.setPresence);

  useEffect(() => {
    let idle = false;
    let timer: ReturnType<typeof setTimeout>;

    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        idle = true;
        setPresence({ idle: true });
      }, IDLE_AFTER_MS);
    };
    const onInput = () => {
      if (idle) {
        idle = false;
        setPresence({ idle: false });
      }
      arm();
    };
    const onVisibility = () => setPresence({ away: document.hidden });

    const events = ["pointermove", "pointerdown", "keydown", "wheel"] as const;
    for (const e of events) window.addEventListener(e, onInput, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    arm();
    if (document.hidden) setPresence({ away: true });
    return () => {
      clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, onInput);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [setPresence]);
}
