"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import {
  LIMITS,
  byPosition,
  cardsByColumn,
  positionBetween,
  positionsBetween,
  sortedColumns,
  type BoardData,
  type Column,
  type Op,
} from "@livekanban/protocol";
import { newItemId, useBoard } from "@/lib/board-store";
import { confirmAction } from "@/lib/confirm";
import { SHAKE_MS, clearJump, revealAndShake, useJump } from "@/lib/jump";
import { indexPresence } from "@/lib/presence-index";
import { clearSelection, selectCards, useSelection } from "@/lib/selection";
import { isFiltering, matchesFilter, useCardFilter } from "@/lib/card-filter";
import { useCan } from "@/lib/use-can";
import { useUndo } from "@/lib/undo";
import { CardFace } from "./card";
import { CardDialogFor } from "./card-dialog-for";
import { ColumnPreview, SortableColumn, columnDragId } from "./column";

const isColumnDragId = (id: UniqueIdentifier) => String(id).startsWith("col:");
const columnIdOf = (dragId: UniqueIdentifier) => String(dragId).slice(4);

/** Card ids per column, in display order. */
type Order = Record<string, string[]>;

function findColumn(order: Order, id: UniqueIdentifier): string | undefined {
  if (isColumnDragId(id)) return columnIdOf(id);
  return Object.keys(order).find((col) => order[col].includes(String(id)));
}

/**
 * Columns only collide with columns. Cards prefer the card under the pointer,
 * then the column (to drop at its end).
 */
const collisionDetection: CollisionDetection = (args) => {
  // Keyboard drags set the order directly (see keyboardCoordinates), so nothing to resolve.
  if (!args.pointerCoordinates) return [{ id: args.active.id }];
  if (isColumnDragId(args.active.id)) {
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter((c) => isColumnDragId(c.id)),
    });
  }
  const hits = pointerWithin(args);
  if (hits.length) return [hits.find((h) => !isColumnDragId(h.id)) ?? hits[0]];
  return closestCorners(args);
};

/** Neighbour positions around index `i` of `ids`, skipping the moving item itself. */
function neighbours(ids: string[], i: number, positionOf: (id: string) => string | undefined) {
  return { before: i > 0 ? positionOf(ids[i - 1]) : null, after: i < ids.length - 1 ? positionOf(ids[i + 1]) : null };
}

const fitsBetween = (pos: string, before: string | null | undefined, after: string | null | undefined) =>
  (!before || before < pos) && (!after || pos < after);

/** What a box selection must not start on: cards, controls and dialogs. */
const NOT_EMPTY_SPACE = 'li[aria-roledescription="card"], button, a, input, textarea, select, summary, details, form, dialog, [role="dialog"], [role="toolbar"]';

export function KanbanBoard({ board }: { board: BoardData }) {
  const dispatch = useBoard((s) => s.dispatch);
  const dispatchAll = useBoard((s) => s.dispatchAll);
  const lockCard = useBoard((s) => s.lockCard);
  const unlockCard = useBoard((s) => s.unlockCard);
  const peers = useBoard((s) => s.peers);
  const presence = useMemo(() => indexPresence(peers), [peers]);
  const can = useCan();
  const columns = useMemo(() => sortedColumns(board), [board]);
  const cardsIn = useMemo(() => cardsByColumn(board), [board]);
  const baseOrder = useMemo<Order>(
    () => Object.fromEntries(Object.entries(cardsIn).map(([col, cards]) => [col, cards.map((c) => c.id)])),
    [cardsIn],
  );

  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  /** While a card is dragged, its tentative column and slot; null otherwise. */
  const [dragOrder, setDragOrderState] = useState<Order | null>(null);
  // Mirrors dragOrder for event handlers that run before the next render.
  const dragOrderRef = useRef<Order | null>(null);
  const setDragOrder = (next: Order | null) => {
    dragOrderRef.current = next;
    setDragOrderState(next);
  };
  /** While a column is dragged by keyboard, the tentative column order; null otherwise. */
  const [columnOrder, setColumnOrderState] = useState<string[] | null>(null);
  const columnOrderRef = useRef<string[] | null>(null);
  const setColumnOrder = (next: string[] | null) => {
    columnOrderRef.current = next;
    setColumnOrderState(next);
  };
  const columnIdsRef = useRef<string[]>([]);
  useEffect(() => {
    columnIdsRef.current = columns.map((c) => c.id);
  }, [columns]);
  const [openCardId, setOpenCardId] = useState<string | null>(null);

  const selection = useSelection((s) => s.ids);
  /** Selected cards that still exist, in board order (column, then position). */
  const selected = useMemo(() => {
    const columnIndex = new Map(columns.map((c, i) => [c.id, i]));
    return [...selection]
      .map((id) => board.cards[id])
      .filter((c) => c && columnIndex.has(c.columnId))
      .sort((a, b) => columnIndex.get(a.columnId)! - columnIndex.get(b.columnId)! || byPosition(a, b))
      .map((c) => c.id);
  }, [selection, board.cards, columns]);
  /** The other selected cards travelling with the one being dragged; empty for a single-card drag. */
  const companionsRef = useRef<string[]>([]);
  const [dragCount, setDragCount] = useState(1);

  // Box selection: drag on empty space to draw a box; cards it touches are selected.
  const boardRef = useRef<HTMLDivElement>(null);
  const boxStart = useRef<{ x: number; y: number; base: Set<string>; moved: boolean } | null>(null);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  const onBoxDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || e.pointerType === "touch" || (e.target as HTMLElement).closest(NOT_EMPTY_SPACE)) return;
    // No text selection while drawing the box. That also stops the click from blurring a field, so do it here.
    e.preventDefault();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    e.currentTarget.setPointerCapture(e.pointerId);
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    boxStart.current = { x: e.clientX, y: e.clientY, base: new Set(additive ? selected : []), moved: false };
  };
  const onBoxMove = (e: React.PointerEvent) => {
    const start = boxStart.current;
    if (!start) return;
    if (!start.moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 4) return;
    start.moved = true;
    const left = Math.min(start.x, e.clientX);
    const top = Math.min(start.y, e.clientY);
    const right = Math.max(start.x, e.clientX);
    const bottom = Math.max(start.y, e.clientY);
    setBox({ left, top, width: right - left, height: bottom - top });
    const hits = new Set(start.base);
    for (const el of boardRef.current?.querySelectorAll<HTMLElement>('li[aria-roledescription="card"][data-anchor]') ?? []) {
      const r = el.getBoundingClientRect();
      if (r.right > left && r.left < right && r.bottom > top && r.top < bottom) hits.add(el.dataset.anchor!);
    }
    selectCards(hits);
  };
  const onBoxEnd = () => {
    const start = boxStart.current;
    boxStart.current = null;
    setBox(null);
    // A plain click on empty space clears the selection.
    if (start && !start.moved && !start.base.size) clearSelection();
  };

  const deleteSelected = async () => {
    if (!selected.length || !can.editCards) return;
    const ok = await confirmAction({
      title: `Delete ${selected.length} card${selected.length === 1 ? "" : "s"}?`,
      body: "You can undo this, or restore them from the Trash for 7 days.",
      confirmLabel: `Delete ${selected.length === 1 ? "card" : "cards"}`,
    });
    if (!ok) return;
    dispatchAll(selected.map((id): Op => ({ kind: "card.delete", id })));
    clearSelection();
  };

  const moveSelectedTo = (columnId: string) => {
    if (!selected.length || !can.moveCards) return;
    const staying = (cardsIn[columnId] ?? []).filter((c) => !selection.has(c.id));
    const positions = positionsBetween(staying.at(-1)?.position ?? null, null, selected.length);
    dispatchAll(selected.map((id, i): Op => ({ kind: "card.move", id, columnId, position: positions[i] })));
  };

  // Escape clears the selection; Delete removes the selected cards.
  const deleteSelectedRef = useRef(deleteSelected);
  useEffect(() => {
    deleteSelectedRef.current = deleteSelected;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!useSelection.getState().ids.size || document.querySelector("dialog[open]")) return;
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "Escape") clearSelection();
      else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        void deleteSelectedRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Leaving the kanban (e.g. to the bulletin) drops the selection.
  useEffect(() => () => void clearSelection(), []);

  // A #mention click (here, from the bulletin or calendar) asks to show a card:
  // close any open card, glide to it, shake it for a second, then open it.
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const follow = () => {
      const target = useJump.getState().target;
      if (target?.kind !== "card") return;
      clearJump();
      timers.push(
        setTimeout(() => {
          setOpenCardId(null);
          // Wait a frame so a just-mounted board (after switching tabs) is laid out.
          requestAnimationFrame(() => {
            if (!revealAndShake(target.id)) return;
            timers.push(setTimeout(() => setOpenCardId(target.id), SHAKE_MS));
          });
        }, 0),
      );
    };
    follow();
    const unsubscribe = useJump.subscribe(follow);
    return () => {
      unsubscribe();
      timers.forEach(clearTimeout);
    };
  }, []);
  const offerUndo = useUndo((s) => s.offer);

  const order = dragOrder ?? baseOrder;
  // Search and filters hide cards; drags still work on the full order, so hidden cards keep their places.
  const filter = useCardFilter();
  const filtering = isFiltering(filter);

  /**
   * Keyboard moves are exact rather than geometric: cards swap with the
   * neighbouring card (Up/Down) or move to the same slot in the adjacent column
   * (Left/Right); columns swap with their neighbour. Returns where the drag
   * preview should go.
   */
  const keyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
    const { active, collisionRect, droppableRects } = args.context;
    if (!active || !collisionRect) return undefined;
    if (isColumnDragId(active.id)) {
      const ids = columnOrderRef.current;
      const step = event.code === "ArrowLeft" ? -1 : event.code === "ArrowRight" ? 1 : 0;
      if (!ids || !step) return undefined;
      event.preventDefault();
      const id = columnIdOf(active.id);
      const i = ids.indexOf(id);
      const neighbour = ids[i + step];
      if (!neighbour) return { x: collisionRect.left, y: collisionRect.top };
      const rect = droppableRects.get(columnDragId(neighbour));
      setColumnOrder(arrayMove(ids, i, i + step));
      return rect ? { x: rect.left, y: collisionRect.top } : { x: collisionRect.left, y: collisionRect.top };
    }

    const current = dragOrderRef.current;
    const id = String(active.id);
    const from = current && findColumn(current, id);
    if (!current || !from) return undefined;
    const columnIds = columnIdsRef.current;
    const list = current[from];
    const i = list.indexOf(id);

    let to: string | undefined = from;
    let index = i;
    if (event.code === "ArrowUp") index = i - 1;
    else if (event.code === "ArrowDown") index = i + 1;
    else if (event.code === "ArrowLeft") to = columnIds[columnIds.indexOf(from) - 1];
    else if (event.code === "ArrowRight") to = columnIds[columnIds.indexOf(from) + 1];
    else return undefined;
    event.preventDefault();

    const stay = { x: collisionRect.left, y: collisionRect.top };
    if (!to || (to === from && (index < 0 || index >= list.length))) return stay;

    const target = current[to].filter((x) => x !== id);
    const slot = to === from ? index : Math.min(i, target.length);
    // The card now in the destination slot marks where the preview should land.
    const anchor = to === from ? list[index] : target[slot];
    target.splice(slot, 0, id);
    setDragOrder({ ...current, [from]: current[from].filter((x) => x !== id), [to]: target });

    const rect = anchor ? droppableRects.get(anchor) : droppableRects.get(columnDragId(to));
    if (!rect) return stay;
    return anchor ? { x: rect.left, y: rect.top } : { x: rect.left + 8, y: rect.top + 44 };
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: keyboardCoordinates,
      // Space picks up and drops; Enter is left free to open a card.
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    }),
  );

  const deleteColumn = async (column: Column) => {
    const count = cardsIn[column.id]?.length ?? 0;
    const ok = await confirmAction({
      title: `Delete column “${column.title}”?`,
      body: count
        ? `Its ${count} card${count === 1 ? "" : "s"} will be deleted with it. You can restore them from the Trash for 7 days.`
        : "You can restore it from the Trash for 7 days.",
      confirmLabel: "Delete column",
    });
    if (!ok) return;
    dispatch({ kind: "column.delete", id: column.id });
    offerUndo(`Column “${column.title}” deleted`, {
      kind: "column.restore",
      id: column.id,
      column,
      cards: cardsIn[column.id] ?? [],
    });
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    setActiveId(active.id);
    if (isColumnDragId(active.id)) {
      setColumnOrder(columns.map((c) => c.id));
    } else {
      const id = String(active.id);
      // Dragging a selected card takes the rest of the selection along; dragging another card drops the selection.
      const companions = selection.has(id) ? selected.filter((x) => x !== id) : [];
      if (!selection.has(id)) clearSelection();
      companionsRef.current = companions;
      setDragCount(companions.length + 1);
      const travelling = new Set(companions);
      setDragOrder(
        companions.length ? Object.fromEntries(Object.entries(baseOrder).map(([col, ids]) => [col, ids.filter((x) => !travelling.has(x))])) : baseOrder,
      );
      // Others see the card lift and follow our cursor; the room refuses a second holder.
      lockCard(id);
    }
  };

  // Moving a card into another column happens live during the drag, so the list makes room for it.
  const onDragOver = ({ active, over }: DragOverEvent) => {
    const prev = dragOrderRef.current;
    if (!over || !prev || isColumnDragId(active.id)) return;
    const from = findColumn(prev, active.id);
    const to = findColumn(prev, over.id);
    if (!from || !to || from === to) return;
    const target = prev[to].filter((id) => id !== active.id);
    let index = isColumnDragId(over.id) ? target.length : target.indexOf(String(over.id));
    if (index < 0) index = target.length;
    const translated = active.rect.current.translated;
    if (!isColumnDragId(over.id) && translated && translated.top > over.rect.top + over.rect.height / 2) index += 1;
    target.splice(index, 0, String(active.id));
    setDragOrder({ ...prev, [from]: prev[from].filter((id) => id !== active.id), [to]: target });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const finalOrder = dragOrderRef.current;
    const finalColumns = columnOrderRef.current;
    const companions = companionsRef.current;
    companionsRef.current = [];
    setActiveId(null);
    setDragOrder(null);
    setColumnOrder(null);

    if (isColumnDragId(active.id)) {
      const id = columnIdOf(active.id);
      let ids = finalColumns ?? columns.map((c) => c.id);
      // Pointer drags resolve the slot from `over`; keyboard drags already reordered `ids`.
      if (over && over.id !== active.id) ids = arrayMove(ids, ids.indexOf(id), ids.indexOf(columnIdOf(over.id)));
      const { before, after } = neighbours(ids, ids.indexOf(id), (cid) => board.columns[cid]?.position);
      const column = board.columns[id];
      if (!column || fitsBetween(column.position, before, after)) return;
      dispatch({ kind: "column.move", id, position: positionBetween(before, after) });
      return;
    }

    const card = board.cards[String(active.id)];
    // The room only auto-releases on a committed move, so always release explicitly too.
    const release = () => unlockCard(String(active.id));
    // Someone else picked it up first: drop nothing.
    if (!card || !finalOrder || useBoard.getState().lockDenied === card.id) return release();
    const columnId = findColumn(finalOrder, active.id);
    if (!columnId) return release();
    let ids = finalOrder[columnId];
    if (over && !isColumnDragId(over.id) && findColumn(finalOrder, over.id) === columnId) {
      ids = arrayMove(ids, ids.indexOf(card.id), ids.indexOf(String(over.id)));
    }
    const { before, after } = neighbours(ids, ids.indexOf(card.id), (id) => board.cards[id]?.position);
    if (companions.length) {
      // The whole selection lands together where the dragged card was dropped, in board order; one undo puts it back.
      const group = selected.includes(card.id) ? selected : [card.id, ...companions];
      const positions = positionsBetween(before, after, group.length);
      dispatchAll(group.map((id, i): Op => ({ kind: "card.move", id, columnId, position: positions[i] })));
      return release();
    }
    if (!(columnId === card.columnId && fitsBetween(card.position, before, after))) {
      dispatch({ kind: "card.move", id: card.id, columnId, position: positionBetween(before, after) });
    }
    release();
  };

  const shownColumns = columnOrder ? columnOrder.map((id) => board.columns[id]).filter(Boolean) : columns;
  const activeCard = activeId && !isColumnDragId(activeId) ? board.cards[String(activeId)] : undefined;
  const activeColumn = activeId && isColumnDragId(activeId) ? board.columns[columnIdOf(activeId)] : undefined;

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={({ active }) => {
          if (!isColumnDragId(active.id)) unlockCard(String(active.id));
          companionsRef.current = [];
          setActiveId(null);
          setDragOrder(null);
          setColumnOrder(null);
        }}
      >
        <div
          ref={boardRef}
          className="flex flex-1 items-start gap-3 overflow-x-auto p-4"
          data-anchor="board"
          data-presence-area
          onPointerDown={onBoxDown}
          onPointerMove={onBoxMove}
          onPointerUp={onBoxEnd}
          onPointerCancel={onBoxEnd}
        >
          <SortableContext items={shownColumns.map((c) => columnDragId(c.id))} strategy={horizontalListSortingStrategy}>
            {shownColumns.map((column) => (
              <SortableColumn
                key={column.id}
                column={column}
                cards={(order[column.id] ?? []).map((id) => board.cards[id]).filter((c) => c && (!filtering || c.id === activeId || matchesFilter(c, filter)))}
                presence={presence}
                can={can}
                onOpenCard={setOpenCardId}
                onDelete={deleteColumn}
              />
            ))}
          </SortableContext>
          {can.editCards && <AddColumn lastPosition={columns.at(-1)?.position ?? null} full={columns.length >= LIMITS.columns} />}
        </div>
        {/* pointer-events-none so the cursor sender sees the card or column under the overlay. */}
        <DragOverlay className="pointer-events-none">
          {activeCard && (
            <div className="relative">
              {dragCount > 1 && (
                <>
                  <div className="absolute inset-0 translate-x-2 translate-y-2 rotate-3 rounded-lg border border-stone-200 bg-white shadow dark:border-stone-700 dark:bg-stone-900" />
                  <div className="absolute inset-0 translate-x-1 translate-y-1 rotate-[2.5deg] rounded-lg border border-stone-200 bg-white shadow dark:border-stone-700 dark:bg-stone-900" />
                </>
              )}
              <CardFace card={activeCard} lifted />
              {dragCount > 1 && (
                <span className="absolute -right-2 -top-2 z-10 rounded-full bg-teal-600 px-2 py-0.5 text-xs font-semibold text-white shadow">{dragCount} cards</span>
              )}
            </div>
          )}
          {activeColumn && <ColumnPreview column={activeColumn} count={cardsIn[activeColumn.id]?.length ?? 0} />}
        </DragOverlay>
      </DndContext>

      {box && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-30 rounded-sm border border-blue-500 bg-blue-500/10"
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
        />
      )}

      {selected.length > 0 && (
        <SelectionBar
          count={selected.length}
          columns={columns}
          canMove={can.moveCards}
          canDelete={can.editCards}
          onMove={moveSelectedTo}
          onDelete={deleteSelected}
        />
      )}

      {openCardId && <CardDialogFor board={board} cardId={openCardId} onClose={() => setOpenCardId(null)} />}
    </>
  );
}

/** Actions for the selected cards; also the keyboard-friendly way to move several at once. */
function SelectionBar({
  count,
  columns,
  canMove,
  canDelete,
  onMove,
  onDelete,
}: {
  count: number;
  columns: Column[];
  canMove: boolean;
  canDelete: boolean;
  onMove: (columnId: string) => void;
  onDelete: () => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Selected cards"
      className="fixed bottom-14 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm shadow-xl dark:border-stone-700 dark:bg-stone-900"
    >
      <span className="whitespace-nowrap font-medium">
        {count} card{count === 1 ? "" : "s"} selected
      </span>
      {canMove && (
        <select
          aria-label="Move selected cards to column"
          value=""
          onChange={(e) => e.target.value && onMove(e.target.value)}
          className="rounded-md border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700 dark:bg-stone-900"
        >
          <option value="">Move to…</option>
          {columns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      )}
      {canDelete && (
        <button type="button" onClick={onDelete} className="rounded-md px-2 py-1 font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950">
          Delete
        </button>
      )}
      <button type="button" onClick={() => clearSelection()} className="rounded-md px-2 py-1 text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800">
        Clear
      </button>
      <span className="hidden whitespace-nowrap text-xs text-stone-400 lg:inline">Drag any selected card to move them all · Esc clears</span>
    </div>
  );
}

function AddColumn({ lastPosition, full }: { lastPosition: string | null; full: boolean }) {
  const dispatch = useBoard((s) => s.dispatch);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  if (full) return null;
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-72 shrink-0 rounded-xl border-2 border-dashed border-stone-300 px-3 py-2.5 text-left text-sm text-stone-500 hover:border-stone-400 hover:text-stone-700 dark:border-stone-700 dark:hover:text-stone-300"
      >
        + Add column
      </button>
    );
  }

  return (
    <form
      className="flex w-72 shrink-0 flex-col gap-2 rounded-xl bg-stone-100 p-2 dark:bg-stone-900/60"
      onSubmit={(e) => {
        e.preventDefault();
        const t = title.trim();
        if (!t) return;
        dispatch({ kind: "column.create", id: newItemId(), title: t, position: positionBetween(lastPosition, null) });
        setTitle("");
        setOpen(false);
      }}
    >
      <input
        autoFocus
        value={title}
        maxLength={LIMITS.title}
        placeholder="Column title"
        aria-label="New column title"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        className="rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-teal-500 dark:border-stone-700 dark:bg-stone-900"
      />
      <div className="flex gap-2">
        <button type="submit" className="rounded-md bg-teal-600 px-3 py-1 text-sm font-medium text-white hover:bg-teal-700">
          Add column
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md px-3 py-1 text-sm text-stone-500 hover:bg-stone-200 dark:hover:bg-stone-800">
          Cancel
        </button>
      </div>
    </form>
  );
}
