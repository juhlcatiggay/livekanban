"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { Card, Peer } from "@livekanban/protocol";
import { BOARD_ANCHOR, anchorElement, revealAnchor, toViewport } from "@/lib/anchors";
import { useBoard } from "@/lib/board-store";
import { cursorSamples, type CursorSample } from "@/lib/cursors";
import { CardFace } from "../kanban/card";

/**
 * Render this far in the past and interpolate between samples, so 30 Hz input
 * looks smooth at 60–120 Hz. Smaller is more current, larger is smoother.
 */
const INTERPOLATION_DELAY_MS = 40;
/** Keep off-screen indicators this far from the edge of the board area. */
const EDGE_MARGIN = 20;

type Point = { x: number; y: number };

function samplePoint(s: CursorSample, cache: Map<string, Point | null>): Point | null {
  if (!s.anchor) return null;
  const key = `${s.anchor}:${s.fx}:${s.fy}`;
  if (!cache.has(key)) cache.set(key, toViewport(s.anchor, s.fx, s.fy));
  return cache.get(key)!;
}

/** Interpolated position at time `t`, or null when the cursor should be hidden. */
function positionAt(samples: readonly CursorSample[], t: number, cache: Map<string, Point | null>): Point | null {
  const last = samples.at(-1);
  if (!last || !last.anchor) return null;
  if (t >= last.at) return samplePoint(last, cache);
  let i = samples.length - 1;
  while (i > 0 && samples[i - 1].at > t) i--;
  const b = samples[i];
  const a = samples[i - 1];
  const pb = samplePoint(b, cache);
  const pa = a ? samplePoint(a, cache) : null;
  if (!pa || !pb) return pb ?? pa;
  const alpha = Math.min(1, Math.max(0, (t - a.at) / (b.at - a.at)));
  return { x: pa.x + (pb.x - pa.x) * alpha, y: pa.y + (pb.y - pa.y) * alpha };
}

interface Handles {
  cursor: HTMLDivElement | null;
  edge: HTMLButtonElement | null;
  arrow: HTMLSpanElement | null;
}

/** Everyone else's cursors, drag ghosts and off-screen indicators, in one fixed overlay. */
export function CursorLayer() {
  const peers = useBoard((s) => s.peers);
  const board = useBoard((s) => s.board);
  const handles = useRef(new Map<string, Handles>());

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const t = performance.now() - INTERPOLATION_DELAY_MS;
      const cache = new Map<string, Point | null>();
      const area = anchorElement(BOARD_ANCHOR)?.getBoundingClientRect();
      for (const [id, h] of handles.current) {
        if (!h.cursor || !h.edge || !h.arrow) continue;
        const p = positionAt(cursorSamples(id), t, cache);
        if (!p || !area) {
          h.cursor.style.display = "none";
          h.edge.style.display = "none";
          continue;
        }
        const inside = p.x >= area.left && p.x <= area.right && p.y >= area.top && p.y <= area.bottom;
        if (inside) {
          h.cursor.style.display = "block";
          h.cursor.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
          h.edge.style.display = "none";
          continue;
        }
        // Off-screen: pin an indicator to the nearest edge, pointing at them.
        const ex = Math.min(Math.max(p.x, area.left + EDGE_MARGIN), area.right - EDGE_MARGIN);
        const ey = Math.min(Math.max(p.y, area.top + EDGE_MARGIN), area.bottom - EDGE_MARGIN);
        const angle = Math.atan2(p.y - ey, p.x - ex);
        h.cursor.style.display = "none";
        h.edge.style.display = "flex";
        h.edge.style.transform = `translate3d(${ex}px, ${ey}px, 0) translate(-50%, -50%)`;
        h.arrow.style.transform = `rotate(${angle}rad)`;
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const visible = Object.values(peers).filter((p) => !p.away);

  return (
    <div className="pointer-events-none fixed inset-0 z-30 overflow-hidden">
      {visible.map((peer) => (
        <RemoteCursor
          key={peer.connectionId}
          peer={peer}
          held={peer.holding ? board?.cards[peer.holding] : undefined}
          handles={handles}
        />
      ))}
    </div>
  );
}

function RemoteCursor({
  peer,
  held,
  handles,
}: {
  peer: Peer;
  held: Card | undefined;
  handles: RefObject<Map<string, Handles>>;
}) {
  const cursor = useRef<HTMLDivElement>(null);
  const edge = useRef<HTMLButtonElement>(null);
  const arrow = useRef<HTMLSpanElement>(null);
  const id = peer.connectionId;

  // Hand the DOM nodes to the animation loop, which positions them without re-rendering.
  useEffect(() => {
    const map = handles.current;
    map.set(id, { cursor: cursor.current, edge: edge.current, arrow: arrow.current });
    return () => {
      map.delete(id);
    };
  }, [handles, id]);

  const jump = () => {
    const last = cursorSamples(peer.connectionId).at(-1);
    if (last?.anchor) revealAnchor(last.anchor, last.fx, last.fy);
  };

  return (
    <>
      <div
        ref={cursor}
        data-cursor={peer.name}
        className="absolute left-0 top-0 hidden will-change-transform"
        style={{ opacity: peer.idle ? 0.5 : 1 }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" className="absolute -left-px -top-px drop-shadow">
          <path d="M1 1 L1 15 L5 11 L8 17 L10.5 16 L7.5 10 L13 10 Z" fill={peer.color} stroke="white" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
        <span
          className="absolute left-3.5 top-4 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium text-white shadow"
          style={{ backgroundColor: peer.color }}
        >
          {peer.name}
        </span>
        {held && (
          <div className="absolute left-4 top-10 w-64" data-ghost={held.id}>
            <CardFace card={held} lifted />
            <span className="mt-1 inline-block rounded px-1.5 py-0.5 text-xs font-medium text-white" style={{ backgroundColor: peer.color }}>
              {peer.name} is moving
            </span>
          </div>
        )}
      </div>
      <button
        ref={edge}
        type="button"
        onClick={jump}
        aria-label={`Jump to ${peer.name}`}
        className="pointer-events-auto absolute left-0 top-0 hidden items-center gap-1 rounded-full py-0.5 pl-1 pr-2 text-xs font-medium text-white shadow-md"
        style={{ backgroundColor: peer.color }}
      >
        <span ref={arrow} className="inline-block leading-none">
          ➜
        </span>
        {peer.name}
      </button>
    </>
  );
}
