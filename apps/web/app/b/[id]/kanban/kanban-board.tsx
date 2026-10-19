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
  cardsByColumn,
  positionBetween,
  sortedColumns,
  type BoardData,
  type Column,
} from "@livekanban/protocol";
import { newItemId, useBoard } from "@/lib/board-store";
import { indexPresence } from "@/lib/presence-index";
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

export function KanbanBoard({ board }: { board: BoardData }) {
  const dispatch = useBoard((s) => s.dispatch);
  const lockCard = useBoard((s) => s.lockCard);
  const unlockCard = useBoard((s) => s.unlockCard);
  const peers = useBoard((s) => s.peers);
  const presence = useMemo(() => indexPresence(peers), [peers]);
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
  const offerUndo = useUndo((s) => s.offer);

  const order = dragOrder ?? baseOrder;

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

  const deleteColumn = (column: Column) => {
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
      setDragOrder(baseOrder);
      // Others see the card lift and follow our cursor; the room refuses a second holder.
      lockCard(String(active.id));
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
          setActiveId(null);
          setDragOrder(null);
          setColumnOrder(null);
        }}
      >
        <div className="flex flex-1 items-start gap-3 overflow-x-auto p-4" data-anchor="board" data-presence-area>
          <SortableContext items={shownColumns.map((c) => columnDragId(c.id))} strategy={horizontalListSortingStrategy}>
            {shownColumns.map((column) => (
              <SortableColumn
                key={column.id}
                column={column}
                cards={(order[column.id] ?? []).map((id) => board.cards[id]).filter(Boolean)}
                presence={presence}
                onOpenCard={setOpenCardId}
                onDelete={deleteColumn}
              />
            ))}
          </SortableContext>
          <AddColumn lastPosition={columns.at(-1)?.position ?? null} full={columns.length >= LIMITS.columns} />
        </div>
        {/* pointer-events-none so the cursor sender sees the card or column under the overlay. */}
        <DragOverlay className="pointer-events-none">
          {activeCard && <CardFace card={activeCard} lifted />}
          {activeColumn && <ColumnPreview column={activeColumn} count={cardsIn[activeColumn.id]?.length ?? 0} />}
        </DragOverlay>
      </DndContext>

      {openCardId && <CardDialogFor board={board} cardId={openCardId} onClose={() => setOpenCardId(null)} />}
    </>
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
