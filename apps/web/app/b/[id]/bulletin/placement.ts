import { CANVAS, NOTE_SIZE, type BoardData } from "@livekanban/protocol";

/** Keeps a note of size w×h inside the canvas, in whole canvas pixels. */
export function clampToCanvas(x: number, y: number, w: number = NOTE_SIZE.min, h: number = NOTE_SIZE.min) {
  return {
    x: Math.round(Math.min(Math.max(x, 0), CANVAS.width - Math.max(w, NOTE_SIZE.min))),
    y: Math.round(Math.min(Math.max(y, 0), CANVAS.height - Math.max(h, NOTE_SIZE.min))),
  };
}

/** A spot near `around` that no other note's corner sits on, cascading diagonally. */
export function freeNoteSpot(board: Pick<BoardData, "notes">, around = { x: 40, y: 40 }) {
  const notes = Object.values(board.notes);
  for (let i = 0; i < 40; i++) {
    const spot = clampToCanvas(around.x + i * 28, around.y + i * 28);
    if (!notes.some((n) => Math.abs(n.x - spot.x) < 12 && Math.abs(n.y - spot.y) < 12)) return spot;
  }
  return clampToCanvas(around.x, around.y);
}
