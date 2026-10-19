/**
 * Remote cursor samples, kept outside React so ~30 updates/s per person never
 * re-render anything. The cursor layer reads them from a requestAnimationFrame loop.
 */

export interface CursorSample {
  /** Arrival time (performance.now()). */
  at: number;
  /** null = pointer left the board; hide the cursor. */
  anchor: string | null;
  fx: number;
  fy: number;
}

const MAX_SAMPLES = 12;
const buffers = new Map<string, CursorSample[]>();

export function pushCursor(connectionId: string, anchor: string | null, fx: number, fy: number) {
  const list = buffers.get(connectionId) ?? [];
  list.push({ at: performance.now(), anchor, fx, fy });
  if (list.length > MAX_SAMPLES) list.splice(0, list.length - MAX_SAMPLES);
  buffers.set(connectionId, list);
}

export function cursorSamples(connectionId: string): readonly CursorSample[] {
  return buffers.get(connectionId) ?? [];
}

export function dropCursor(connectionId: string) {
  buffers.delete(connectionId);
}

export function clearCursors() {
  buffers.clear();
}
