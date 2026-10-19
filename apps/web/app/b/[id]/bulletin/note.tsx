"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  COLORS,
  LIMITS,
  NOTE_SIZE,
  positionBetween,
  type Color,
  type Column,
  type Note,
  type Peer,
} from "@livekanban/protocol";
import { newItemId, useBoard } from "@/lib/board-store";
import { closeMenu, useDismiss } from "@/lib/use-dismiss";
import { EditingBadge } from "../kanban/card";
import { COLOR_STYLES } from "../kanban/colors";
import { Markdown } from "../kanban/markdown";
import { clampToCanvas } from "./placement";

/** Sticky-note paper colors; text stays dark so notes read the same in both themes. */
const PAPER: Record<Color, string> = {
  gray: "bg-stone-100 border-stone-300",
  red: "bg-red-100 border-red-300",
  amber: "bg-amber-100 border-amber-300",
  green: "bg-green-100 border-green-300",
  teal: "bg-teal-100 border-teal-300",
  blue: "bg-blue-100 border-blue-300",
  purple: "bg-purple-100 border-purple-300",
  pink: "bg-pink-100 border-pink-300",
};

const SAVE_DEBOUNCE_MS = 300;
/** Arrow keys nudge a focused note by this many canvas pixels (Shift: 5×). */
const NUDGE = 20;

/**
 * Presentational note, shared by the canvas and the remote drag ghost. Text is
 * Markdown, rendered by the same safe renderer as card descriptions (bare
 * URLs become links via GFM autolinks).
 */
export function NoteFace({ note, lifted = false, className = "" }: { note: Note; lifted?: boolean; className?: string }) {
  return (
    <div
      className={`h-full w-full overflow-hidden break-words rounded-sm border p-3 text-sm text-stone-900 shadow ${PAPER[note.color]} ${
        lifted ? "rotate-2 shadow-xl" : ""
      } ${className}`}
      style={lifted ? { width: note.w, height: note.h } : undefined}
    >
      {note.text ? <Markdown text={note.text} compact onPaper /> : <span className="text-stone-400">Empty note</span>}
    </div>
  );
}

interface CanvasNoteProps {
  note: Note;
  zoom: number;
  columns: Column[];
  lastCardPosition: (columnId: string) => string | null;
  pinned: boolean;
  heldBy?: Peer;
  editors?: Peer[];
  /** Open the text editor as soon as the note mounts (for brand-new notes). */
  startEditing?: boolean;
  onEditingDone?: () => void;
  /** False when the host has made the bulletin view-only: no drag, resize, edit or menu. */
  canEdit?: boolean;
  onDelete: (note: Note) => void;
}

export function CanvasNote({ note, zoom, columns, lastCardPosition, pinned, heldBy, editors = [], startEditing = false, onEditingDone, onDelete, canEdit = true }: CanvasNoteProps) {
  const dispatch = useBoard((s) => s.dispatch);
  const lockCard = useBoard((s) => s.lockCard);
  const unlockCard = useBoard((s) => s.unlockCard);
  const setPresence = useBoard((s) => s.setPresence);

  /** Live position while dragging, in canvas pixels. */
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const dragStart = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(null);
  /** Live size while resizing. */
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const resizeStart = useRef<{ px: number; py: number; w: number; h: number } | null>(null);
  const [editing, setEditing] = useState(startEditing && canEdit);
  const [draft, setDraft] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Others see "<you> is editing" while the text editor is open.
  useEffect(() => {
    if (!editing) return;
    setPresence({ editing: note.id });
    return () => setPresence({ editing: null });
  }, [editing, note.id, setPresence]);

  const flushText = useCallback(
    (text: string | null) => {
      clearTimeout(saveTimer.current);
      if (text !== null && text !== note.text) dispatch({ kind: "note.update", id: note.id, patch: { text } });
    },
    [dispatch, note.id, note.text],
  );

  const finishEditing = () => {
    flushText(draft);
    setDraft(null);
    setEditing(false);
    onEditingDone?.();
  };

  const move = (x: number, y: number) => {
    const p = clampToCanvas(x, y, note.w, note.h);
    if (p.x !== note.x || p.y !== note.y) dispatch({ kind: "note.move", id: note.id, ...p });
  };

  if (heldBy) {
    return (
      <div
        data-anchor={note.id}
        className="absolute flex items-center justify-center rounded-sm border-2 border-dashed p-3 text-center text-xs font-medium"
        style={{ left: note.x, top: note.y, width: note.w, height: note.h, zIndex: note.z, borderColor: heldBy.color, color: heldBy.color }}
        aria-label={`Note held by ${heldBy.name}`}
      >
        {heldBy.name} is moving this note
      </div>
    );
  }

  const pos = drag ?? note;
  const dims = size ?? note;
  const editor = editors[0];

  return (
    <div
      // While dragging, the note stops being a cursor anchor so others see the cursor travel across the canvas.
      data-anchor={drag ? undefined : note.id}
      role="group"
      aria-label={`Note: ${note.text.slice(0, 60) || "empty"}`}
      tabIndex={0}
      className="group absolute touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
      style={{
        left: pos.x,
        top: pos.y,
        width: dims.w,
        height: dims.h,
        zIndex: drag ? 100_000 : note.z,
        boxShadow: editor ? `0 0 0 3px ${editor.color}` : undefined,
        cursor: editing || !canEdit ? "auto" : drag ? "grabbing" : "grab",
      }}
      onPointerDown={(e) => {
        if (!canEdit || e.button !== 0 || editing || (e.target as HTMLElement).closest("button, a, textarea, details, [data-resize]")) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        dragStart.current = { px: e.clientX, py: e.clientY, x: note.x, y: note.y, moved: false };
      }}
      onPointerMove={(e) => {
        const s = dragStart.current;
        if (!s) return;
        const dx = (e.clientX - s.px) / zoom;
        const dy = (e.clientY - s.py) / zoom;
        if (!s.moved) {
          if (Math.hypot(dx, dy) < 4) return;
          s.moved = true;
          lockCard(note.id);
        }
        setDrag(clampToCanvas(s.x + dx, s.y + dy, note.w, note.h));
      }}
      onPointerUp={() => {
        const s = dragStart.current;
        dragStart.current = null;
        if (!s?.moved) return;
        if (drag && useBoard.getState().lockDenied !== note.id) move(drag.x, drag.y);
        unlockCard(note.id);
        setDrag(null);
      }}
      onPointerCancel={() => {
        if (dragStart.current?.moved) unlockCard(note.id);
        dragStart.current = null;
        setDrag(null);
      }}
      onDoubleClick={() => canEdit && setEditing(true)}
      onKeyDown={(e) => {
        if (!canEdit || editing || e.target !== e.currentTarget) return;
        const step = e.shiftKey ? NUDGE * 5 : NUDGE;
        const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (delta) {
          e.preventDefault();
          move(note.x + delta[0], note.y + delta[1]);
        }
        if (e.key === "Enter") {
          e.preventDefault();
          setEditing(true);
        }
      }}
    >
      {editing ? (
        <textarea
          autoFocus
          aria-label="Note text"
          value={draft ?? note.text}
          maxLength={LIMITS.description}
          onChange={(e) => {
            const text = e.target.value;
            setDraft(text);
            clearTimeout(saveTimer.current);
            saveTimer.current = setTimeout(() => flushText(text), SAVE_DEBOUNCE_MS);
          }}
          onBlur={finishEditing}
          onKeyDown={(e) => e.key === "Escape" && finishEditing()}
          className={`h-full w-full resize-none rounded-sm border p-3 text-sm text-stone-900 shadow outline-none ${PAPER[note.color]}`}
        />
      ) : (
        <NoteFace note={note} className={drag ? "rotate-1 shadow-xl" : ""} />
      )}
      {pinned && (
        <span className="pointer-events-none absolute -top-2 left-2 rounded bg-stone-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
          Pinned
        </span>
      )}
      {editor && <EditingBadge peers={editors} />}
      {canEdit && !editing && (
        <NoteMenu note={note} pinned={pinned} columns={columns} lastCardPosition={lastCardPosition} onEdit={() => setEditing(true)} onDelete={() => onDelete(note)} />
      )}
      {canEdit && (
        <div
          data-resize
          aria-hidden
          className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize opacity-0 group-hover:opacity-100"
          style={{ background: "linear-gradient(135deg, transparent 50%, rgba(0,0,0,0.25) 50%)" }}
          onPointerDown={(e) => {
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            resizeStart.current = { px: e.clientX, py: e.clientY, w: note.w, h: note.h };
          }}
          onPointerMove={(e) => {
            const s = resizeStart.current;
            if (!s) return;
            const clampSize = (v: number) => Math.round(Math.min(Math.max(v, NOTE_SIZE.min), NOTE_SIZE.max));
            setSize({ w: clampSize(s.w + (e.clientX - s.px) / zoom), h: clampSize(s.h + (e.clientY - s.py) / zoom) });
          }}
          onPointerUp={() => {
            resizeStart.current = null;
            if (size && (size.w !== note.w || size.h !== note.h)) dispatch({ kind: "note.update", id: note.id, patch: size });
            setSize(null);
          }}
        />
      )}
    </div>
  );
}

function NoteMenu({
  note,
  pinned,
  columns,
  lastCardPosition,
  onEdit,
  onDelete,
}: {
  note: Note;
  pinned: boolean;
  columns: Column[];
  lastCardPosition: (columnId: string) => string | null;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const dispatch = useBoard((s) => s.dispatch);
  const menu = useDismiss();
  const item = "w-full rounded px-2 py-1 text-left hover:bg-stone-100 dark:hover:bg-stone-800";
  // Actions close the menu; recoloring keeps it open so colors can be compared.
  const act = (fn: () => void) => () => {
    closeMenu(menu);
    fn();
  };

  return (
    <details ref={menu} className="absolute right-1 top-1 opacity-0 focus-within:opacity-100 group-hover:opacity-100 group-focus-visible:opacity-100 open:opacity-100">
      <summary className="cursor-pointer list-none rounded px-1.5 text-stone-600 hover:bg-black/10" aria-label="Note options">
        ⋯
      </summary>
      <div className="absolute right-0 z-10 mt-1 w-52 rounded-lg border border-stone-200 bg-white p-1.5 text-sm text-stone-900 shadow-lg dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100">
        <button type="button" className={item} onClick={act(onEdit)}>
          Edit text
        </button>
        <button type="button" className={item} onClick={act(() => dispatch({ kind: "board.pin", noteId: pinned ? null : note.id }))}>
          {pinned ? "Unpin announcement" : "Pin as announcement"}
        </button>
        <div className="flex flex-wrap gap-1.5 px-2 py-1.5" role="group" aria-label="Note color">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Note color ${COLOR_STYLES[c].label}`}
              aria-pressed={note.color === c}
              onClick={() => dispatch({ kind: "note.update", id: note.id, patch: { color: c } })}
              className={`h-5 w-5 rounded-full ${COLOR_STYLES[c].swatch} ${note.color === c ? "ring-2 ring-stone-900 ring-offset-1 dark:ring-white" : ""}`}
            />
          ))}
        </div>
        {columns.length > 0 && (
          <div className="border-t border-stone-200 pt-1 dark:border-stone-700">
            <p className="px-2 py-1 text-xs text-stone-500">Convert to a card in</p>
            {columns.map((col) => (
              <button
                key={col.id}
                type="button"
                className={item}
                onClick={act(() =>
                  dispatch({
                    kind: "note.toCard",
                    id: note.id,
                    cardId: newItemId(),
                    columnId: col.id,
                    position: positionBetween(lastCardPosition(col.id), null),
                  }),
                )}
              >
                → {col.title}
              </button>
            ))}
          </div>
        )}
        <button type="button" className={`${item} mt-1 border-t border-stone-200 text-red-600 dark:border-stone-700 dark:text-red-400`} onClick={act(onDelete)}>
          Delete note
        </button>
      </div>
    </details>
  );
}
