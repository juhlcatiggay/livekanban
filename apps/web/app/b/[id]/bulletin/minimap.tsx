"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { CANVAS, type Note } from "@livekanban/protocol";
import { COLOR_STYLES } from "../kanban/colors";

/** Minimap width in screen pixels; height follows the canvas aspect ratio. */
const WIDTH = 200;
const SCALE = WIDTH / CANVAS.width;
const HEIGHT = Math.round(CANVAS.height * SCALE);

/** "left,top,width,height" of the scroller's visible area, for useSyncExternalStore. */
function viewportSnapshot(el: HTMLDivElement | null): string {
  if (!el) return "0,0,0,0";
  return `${el.scrollLeft},${el.scrollTop},${el.clientWidth},${el.clientHeight}`;
}

interface MinimapProps {
  notes: Note[];
  /** The canvas's scroll container. */
  scroller: HTMLDivElement | null;
  zoom: number;
}

/**
 * Overview of the whole bulletin canvas: every note, plus a frame for what you
 * can currently see. Click or drag to move the view there; arrow keys pan.
 */
export function Minimap({ notes, scroller, zoom }: MinimapProps) {
  const [hidden, setHidden] = useState(false);

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!scroller) return () => {};
      const resize = new ResizeObserver(onChange);
      resize.observe(scroller);
      scroller.addEventListener("scroll", onChange, { passive: true });
      return () => {
        resize.disconnect();
        scroller.removeEventListener("scroll", onChange);
      };
    },
    [scroller],
  );
  const snapshot = useSyncExternalStore(subscribe, () => viewportSnapshot(scroller), () => "0,0,0,0");
  const [left, top, width, height] = snapshot.split(",").map(Number);

  /** Centres the view on canvas point (x, y). */
  const centerOn = (x: number, y: number) => {
    scroller?.scrollTo({ left: x * zoom - scroller.clientWidth / 2, top: y * zoom - scroller.clientHeight / 2 });
  };

  const fromPointer = (e: React.PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    centerOn((e.clientX - r.left) / SCALE, (e.clientY - r.top) / SCALE);
  };

  if (hidden) {
    return (
      <button
        type="button"
        onClick={() => setHidden(false)}
        className="absolute right-3 top-3 z-20 material rounded-full border border-black/10 px-3 py-1 text-xs font-medium shadow-sm dark:border-white/10"
      >
        Show map
      </button>
    );
  }

  // The visible area, in minimap pixels.
  const frame = { left: (left / zoom) * SCALE, top: (top / zoom) * SCALE, width: (width / zoom) * SCALE, height: (height / zoom) * SCALE };

  return (
    <div className="absolute right-3 top-3 z-20 material rounded-xl border border-black/10 p-1.5 shadow-[0_8px_30px_-8px_rgb(0_0_0/0.25)] dark:border-white/10">
      <div className="mb-1 flex items-center justify-between px-0.5 text-[11px] text-gray-500">
        <span>Map</span>
        <button type="button" onClick={() => setHidden(true)} className="hover:text-gray-800 dark:hover:text-gray-200">
          Hide
        </button>
      </div>
      <button
        type="button"
        aria-label="Bulletin minimap: click or use arrow keys to move the view"
        data-minimap
        className="relative block cursor-crosshair touch-none overflow-hidden rounded bg-gray-100 outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:bg-gray-800"
        style={{ width: WIDTH, height: HEIGHT }}
        onPointerDown={(e: React.PointerEvent<HTMLElement>) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          fromPointer(e);
        }}
        onPointerMove={(e: React.PointerEvent<HTMLElement>) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e);
        }}
        onKeyDown={(e) => {
          const step = 0.1 * (e.shiftKey ? 3 : 1);
          const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
          if (!delta || !scroller) return;
          e.preventDefault();
          scroller.scrollBy({ left: delta[0] * scroller.clientWidth, top: delta[1] * scroller.clientHeight });
        }}
      >
        {notes.map((n) => (
          <span
            key={n.id}
            className={`absolute rounded-[1px] opacity-80 ${COLOR_STYLES[n.color].swatch}`}
            style={{ left: n.x * SCALE, top: n.y * SCALE, width: Math.max(2, n.w * SCALE), height: Math.max(2, n.h * SCALE) }}
          />
        ))}
        <span
          data-minimap-view
          className="pointer-events-none absolute rounded-sm border-2 border-accent-600 bg-accent-500/10"
          style={{ ...frame, width: Math.min(frame.width, WIDTH), height: Math.min(frame.height, HEIGHT) }}
        />
      </button>
    </div>
  );
}
