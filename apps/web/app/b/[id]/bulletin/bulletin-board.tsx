"use client";

import { useEffect, useMemo, useState } from "react";
import { CANVAS, LIMITS, NOTE_SIZE, cardsByColumn, sortedColumns, type BoardData, type Note } from "@livekanban/protocol";
import { newItemId, useBoard } from "@/lib/board-store";
import { confirmAction } from "@/lib/confirm";
import { clearJump, revealAndShake, useJump } from "@/lib/jump";
import { indexPresence } from "@/lib/presence-index";
import { useCan } from "@/lib/use-can";
import { useUndo } from "@/lib/undo";
import { setBulletinLayout, useBulletinLayout, type BulletinLayout } from "@/lib/bulletin-layout";
import { Minimap } from "./minimap";
import { NoteStack } from "./note-stack";
import { CanvasNote } from "./note";
import { clampToCanvas, freeNoteSpot } from "./placement";

const ZOOMS = [0.5, 0.75, 1, 1.25] as const;

/**
 * Free-form canvas of sticky notes. The canvas is CANVAS.width × CANVAS.height
 * canvas pixels, scaled by this viewer's zoom and scrolled by their pan. Its
 * element is the "canvas" cursor anchor, measured by its scaled box, so remote
 * cursors land on the same canvas point whatever each viewer's zoom or scroll.
 */
export function BulletinBoard({ board }: { board: BoardData }) {
  const dispatch = useBoard((s) => s.dispatch);
  const peers = useBoard((s) => s.peers);
  const offerUndo = useUndo((s) => s.offer);
  const presence = useMemo(() => indexPresence(peers), [peers]);
  const canEdit = useCan().editBulletin;
  const notes = useMemo(() => Object.values(board.notes).sort((a, b) => a.z - b.z), [board.notes]);
  const columns = useMemo(() => sortedColumns(board), [board]);
  const cardsIn = useMemo(() => cardsByColumn(board), [board]);
  const [zoom, setZoom] = useState<number>(1);
  const [justCreated, setJustCreated] = useState<string | null>(null);
  // State rather than a ref so the minimap re-subscribes once the element exists.
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const full = notes.length >= LIMITS.notes;
  const layout = useBulletinLayout();

  // A #mention click asks to show a note: glide to it and shake it.
  useEffect(() => {
    const follow = () => {
      const target = useJump.getState().target;
      if (target?.kind !== "note") return;
      clearJump();
      requestAnimationFrame(() => revealAndShake(target.id));
    };
    follow();
    return useJump.subscribe(follow);
  }, []);

  const createNote = (x: number, y: number) => {
    if (full) return;
    const id = newItemId();
    const spot = clampToCanvas(x, y, NOTE_SIZE.defaultW, NOTE_SIZE.defaultH);
    dispatch({ kind: "note.create", id, ...spot, w: NOTE_SIZE.defaultW, h: NOTE_SIZE.defaultH, color: "amber", text: "" });
    setJustCreated(id);
  };

  /** New notes go near the middle of what this viewer can currently see. */
  const addNoteInView = () => {
    const el = scroller;
    if (!el || layout === "stack") {
      // The card stack has no visible canvas area: put it where it won't cover other notes.
      const spot = freeNoteSpot(board);
      createNote(spot.x, spot.y);
      return;
    }
    const cx = (el.scrollLeft + el.clientWidth / 2) / zoom - NOTE_SIZE.defaultW / 2;
    const cy = (el.scrollTop + el.clientHeight / 2) / zoom - NOTE_SIZE.defaultH / 2;
    const spot = freeNoteSpot(board, clampToCanvas(cx, cy, NOTE_SIZE.defaultW, NOTE_SIZE.defaultH));
    createNote(spot.x, spot.y);
  };

  const deleteNote = async (note: Note) => {
    const ok = await confirmAction({
      title: "Delete this note?",
      body: "You can restore it from the Trash for 7 days.",
      confirmLabel: "Delete note",
    });
    if (!ok) return;
    dispatch({ kind: "note.delete", id: note.id });
    offerUndo("Note deleted", { kind: "note.restore", id: note.id, note });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-2 text-sm dark:border-gray-800">
        {canEdit ? (
          <>
            <button
              type="button"
              onClick={addNoteInView}
              disabled={full}
              className="rounded-md bg-amber-400 px-3 py-1 font-medium text-gray-900 hover:bg-amber-300 disabled:opacity-50"
            >
              + Add note
            </button>
            {layout === "canvas" && (
              <span className="hidden text-xs text-gray-500 lg:inline">Double-click the canvas to add a note there. Drag notes anywhere.</span>
            )}
          </>
        ) : (
          <span className="text-xs text-gray-500">The host has made the bulletin board view-only.</span>
        )}
        <div className="ml-auto flex items-center gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800" role="group" aria-label="Layout">
          {(
            [
              ["canvas", "Sticky notes"],
              ["stack", "Card stack"],
            ] as [BulletinLayout, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={layout === value}
              onClick={() => setBulletinLayout(value)}
              className={`rounded-md px-2.5 py-0.5 text-sm ${
                layout === value ? "bg-white font-semibold shadow-sm dark:bg-gray-700" : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {layout === "canvas" && (
          <div className="flex items-center gap-1" role="group" aria-label="Zoom">
            {ZOOMS.map((z) => (
              <button
                key={z}
                type="button"
                aria-pressed={zoom === z}
                onClick={() => setZoom(z)}
                className={`rounded px-2 py-0.5 tabular-nums ${zoom === z ? "bg-gray-200 font-semibold dark:bg-gray-700" : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"}`}
              >
                {z * 100}%
              </button>
            ))}
          </div>
        )}
      </div>
      {layout === "stack" ? (
        <NoteStack
          notes={notes}
          columns={columns}
          lastCardPosition={(columnId) => cardsIn[columnId]?.at(-1)?.position ?? null}
          pinnedNoteId={board.pinnedNoteId}
          editors={presence.editors}
          canEdit={canEdit}
          justCreated={justCreated}
          onEditingDone={() => setJustCreated(null)}
          onDelete={deleteNote}
        />
      ) : (
        <div className="relative flex min-h-0 flex-1">
          <Minimap notes={notes} scroller={scroller} zoom={zoom} />
          <div ref={setScroller} className="relative min-h-0 flex-1 overflow-auto bg-gray-100 dark:bg-gray-900" data-presence-area>
            <div className="relative" style={{ width: CANVAS.width * zoom, height: CANVAS.height * zoom }}>
              <div
                data-anchor="canvas"
                aria-label="Bulletin canvas"
                className="absolute left-0 top-0 origin-top-left bg-white dark:bg-gray-950"
                style={{
                  width: CANVAS.width,
                  height: CANVAS.height,
                  transform: `scale(${zoom})`,
                  backgroundImage: "radial-gradient(circle, rgba(120,113,108,0.25) 1px, transparent 1px)",
                  backgroundSize: "24px 24px",
                }}
                onDoubleClick={(e) => {
                  if (!canEdit || e.target !== e.currentTarget) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  createNote((e.clientX - r.left) / zoom - NOTE_SIZE.defaultW / 2, (e.clientY - r.top) / zoom - 20);
                }}
              >
                {notes.map((note) => (
                  <CanvasNote
                    key={note.id}
                    note={note}
                    zoom={zoom}
                    columns={columns}
                    lastCardPosition={(columnId) => cardsIn[columnId]?.at(-1)?.position ?? null}
                    pinned={board.pinnedNoteId === note.id}
                    heldBy={presence.heldBy[note.id]}
                    editors={presence.editors[note.id]}
                    startEditing={note.id === justCreated}
                    onEditingDone={() => setJustCreated(null)}
                    onDelete={deleteNote}
                    canEdit={canEdit}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
