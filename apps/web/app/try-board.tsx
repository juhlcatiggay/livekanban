"use client";

import { useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/** A demo card: drag only, nothing to edit. Colors are Apple's system colors. */
interface DemoCard {
  id: string;
  title: string;
  stripe: string;
  label?: { text: string; className: string };
  progress?: number;
}

type ColumnId = "todo" | "doing" | "done";

const TITLES: Record<ColumnId, string> = { todo: "To Do", doing: "Doing", done: "Done" };

const START: Record<ColumnId, DemoCard[]> = {
  todo: [
    { id: "email", title: "Plan launch email", stripe: "bg-[#ff2d55]", label: { text: "Marketing", className: "bg-pink-100 text-pink-800" } },
    { id: "domain", title: "Pick a domain", stripe: "bg-[#ff9500]" },
    { id: "invite", title: "Invite the team", stripe: "bg-[#30b0c7]", label: { text: "Team", className: "bg-cyan-100 text-cyan-800" } },
  ],
  doing: [
    { id: "landing", title: "Landing page", stripe: "bg-[#0071e3]", label: { text: "Design", className: "bg-blue-100 text-blue-800" }, progress: 0.6 },
    { id: "signin", title: "Fix sign-in", stripe: "bg-[#ff3b30]", label: { text: "Bug", className: "bg-red-100 text-red-800" } },
  ],
  done: [{ id: "brand", title: "Brand colors", stripe: "bg-[#af52de]", progress: 1 }],
};

/** Apple's spring-like curve, critically damped: the card settles without overshoot. */
const SETTLE = { duration: 280, easing: "cubic-bezier(0.32, 0.72, 0, 1)" };

/**
 * The landing page's "try it" board: real drag and drop between three
 * columns, nothing saved and nothing to edit. Pointer (with the grab
 * offset kept, 1:1) and keyboard (Space to lift, arrows to move).
 */
export function TryBoard() {
  const [columns, setColumnsState] = useState(START);
  // Mirrors `columns` for the keyboard handler, which runs between renders.
  const columnsRef = useRef(START);
  const setColumns = (next: Record<ColumnId, DemoCard[]> | ((prev: Record<ColumnId, DemoCard[]>) => Record<ColumnId, DemoCard[]>)) => {
    const value = typeof next === "function" ? next(columnsRef.current) : next;
    columnsRef.current = value;
    setColumnsState(value);
  };
  const [activeId, setActiveId] = useState<string | null>(null);

  /**
   * Keyboard moves are exact, not geometric: Left/Right move the card to the
   * same slot in the next column, Up/Down swap it with its neighbour.
   */
  const keyboardCoordinates: KeyboardCoordinateGetter = (event, { active, context }) => {
    const rect = context.collisionRect;
    if (!rect) return undefined;
    const order = Object.keys(columnsRef.current) as ColumnId[];
    const id = String(active);
    const from = order.find((c) => columnsRef.current[c].some((card) => card.id === id));
    if (!from) return undefined;
    const list = columnsRef.current[from];
    const index = list.findIndex((c) => c.id === id);
    const stay = { x: rect.left, y: rect.top };
    if (event.code === "ArrowUp" || event.code === "ArrowDown") {
      event.preventDefault();
      const to = index + (event.code === "ArrowUp" ? -1 : 1);
      if (to < 0 || to >= list.length) return stay;
      setColumns((prev) => ({ ...prev, [from]: arrayMove(prev[from], index, to) }));
      const neighbour = context.droppableRects.get(list[to].id);
      return neighbour ? { x: rect.left, y: neighbour.top } : stay;
    }
    if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
      event.preventDefault();
      const to = order[order.indexOf(from) + (event.code === "ArrowLeft" ? -1 : 1)];
      if (!to) return stay;
      setColumns((prev) => {
        const card = prev[from][index];
        const target = [...prev[to]];
        target.splice(Math.min(index, target.length), 0, card);
        return { ...prev, [from]: prev[from].filter((c) => c.id !== id), [to]: target };
      });
      const column = context.droppableRects.get(to);
      return column ? { x: column.left + 8, y: column.top + 28 } : stay;
    }
    return undefined;
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates }),
  );

  const columnOf = (id: string): ColumnId | undefined =>
    id in columns ? (id as ColumnId) : (Object.keys(columns) as ColumnId[]).find((c) => columns[c].some((card) => card.id === id));
  const active = activeId ? Object.values(columns).flat().find((c) => c.id === activeId) : undefined;

  const onDragStart = ({ active }: DragStartEvent) => setActiveId(String(active.id));

  // Crossing into another column moves the card there right away, so the list opens a gap for it.
  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const from = columnOf(String(active.id));
    const to = columnOf(String(over.id));
    if (!from || !to || from === to) return;
    setColumns((prev) => {
      const card = prev[from].find((c) => c.id === active.id);
      if (!card) return prev;
      const target = prev[to].filter((c) => c.id !== card.id);
      const overIndex = target.findIndex((c) => c.id === over.id);
      target.splice(overIndex < 0 ? target.length : overIndex, 0, card);
      return { ...prev, [from]: prev[from].filter((c) => c.id !== card.id), [to]: target };
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    if (!over) return;
    const column = columnOf(String(active.id));
    if (!column || column !== columnOf(String(over.id))) return;
    setColumns((prev) => {
      const list = prev[column];
      const from = list.findIndex((c) => c.id === active.id);
      const to = list.findIndex((c) => c.id === over.id);
      return from < 0 || to < 0 || from === to ? prev : { ...prev, [column]: arrayMove(list, from, to) };
    });
  };

  const moved = JSON.stringify(columns) !== JSON.stringify(START);

  return (
    <div
      role="group"
      aria-label="Try it: drag cards between To Do, Doing and Done"
      className="relative select-none rounded-[22px] border border-black/5 bg-gray-100 p-4 text-left shadow-[0_30px_80px_-20px_rgb(0_0_0/0.25)] sm:p-5 dark:border-white/10 dark:bg-gray-900"
    >
      <div className="mb-4 flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          {["bg-[#ff5f57]", "bg-[#febc2e]", "bg-[#28c840]"].map((c) => (
            <span key={c} aria-hidden className={`h-2.5 w-2.5 rounded-full ${c}`} />
          ))}
          <span className="ml-3 text-sm font-semibold">Website relaunch</span>
        </span>
        <span className="flex items-center gap-3">
          {moved && (
            <button type="button" onClick={() => setColumns(START)} className="rounded-full px-2 py-0.5 text-xs font-medium text-accent-600 hover:bg-accent-600/10 dark:text-accent-400">
              Reset
            </button>
          )}
          <span aria-hidden className="flex -space-x-1.5">
            {[
              ["bg-accent-600", "S"],
              ["bg-[#ff9500]", "T"],
              ["bg-[#af52de]", "W"],
            ].map(([c, l]) => (
              <span key={l} className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-2 ring-gray-100 dark:ring-gray-900 ${c}`}>
                {l}
              </span>
            ))}
          </span>
        </span>
      </div>

      <DndContext
        id="try-board"
        // A demo shouldn't scroll the landing page when a card nears the window's edge.
        autoScroll={false}
        sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {(Object.keys(columns) as ColumnId[]).map((id) => (
            <DemoColumn key={id} id={id} cards={columns[id]} />
          ))}
        </div>
        <DragOverlay dropAnimation={SETTLE}>{active && <DemoCardFace card={active} lifted />}</DragOverlay>
      </DndContext>

      {/* Two make-believe teammates; they never get in the way of the pointer. */}
      <Cursor name="Storm" color="#0071e3" className="left-[24%] top-[52%]" />
      <Cursor name="Thor" color="#ff9500" className="left-[62%] top-[78%]" />
    </div>
  );
}

function DemoColumn({ id, cards }: { id: ColumnId; cards: DemoCard[] }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section
      ref={setNodeRef}
      aria-label={`Demo column ${TITLES[id]}`}
      className={`rounded-xl p-2 transition-colors sm:p-2.5 ${isOver ? "bg-accent-600/10" : "bg-black/[0.04] dark:bg-white/[0.06]"}`}
    >
      <p className="mb-2 flex items-center justify-between px-1 text-xs font-semibold text-gray-600 dark:text-gray-300">
        {TITLES[id]}
        <span className="rounded-full bg-black/[0.06] px-1.5 text-[10px] font-medium tabular-nums dark:bg-white/10">{cards.length}</span>
      </p>
      <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <ul className="flex min-h-14 flex-col gap-2">
          {cards.map((card) => (
            <SortableDemoCard key={card.id} card={card} />
          ))}
        </ul>
      </SortableContext>
    </section>
  );
}

function SortableDemoCard({ card }: { card: DemoCard }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      aria-roledescription="draggable card"
      aria-label={`${card.title}. Press Space to pick up, arrow keys to move.`}
      className={`cursor-grab touch-none rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent-500 active:cursor-grabbing ${isDragging ? "opacity-30" : ""}`}
    >
      <DemoCardFace card={card} />
    </li>
  );
}

function DemoCardFace({ card, lifted = false }: { card: DemoCard; lifted?: boolean }) {
  return (
    <div
      className={`relative overflow-hidden rounded-lg bg-white py-2 pl-3 pr-2 text-xs transition-shadow dark:bg-gray-800 ${
        lifted ? "rotate-2 scale-[1.03] shadow-[0_18px_40px_-12px_rgb(0_0_0/0.35)]" : "shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_0.5px_rgb(0_0_0/0.06)] hover:shadow-[0_6px_16px_-6px_rgb(0_0_0/0.2)]"
      }`}
    >
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${card.stripe}`} />
      <p className="font-medium">{card.title}</p>
      {card.label && <span className={`mt-1.5 inline-block rounded px-1.5 text-[10px] font-medium ${card.label.className}`}>{card.label.text}</span>}
      {card.progress !== undefined && (
        <span aria-hidden className="mt-2 block h-1 rounded-full bg-gray-200 dark:bg-gray-700">
          <span className={`block h-full rounded-full ${card.progress === 1 ? "bg-[#34c759]" : "bg-accent-500"}`} style={{ width: `${card.progress * 100}%` }} />
        </span>
      )}
    </div>
  );
}

function Cursor({ name, color, className }: { name: string; color: string; className: string }) {
  return (
    <span aria-hidden className={`pointer-events-none absolute ${className} animate-[lk-drift_7s_ease-in-out_infinite]`}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill={color}>
        <path d="M1 1l5 14 2-6 6-2z" stroke="white" strokeWidth="1" />
      </svg>
      <span className="ml-3 rounded-full px-2 py-0.5 text-[10px] font-medium text-white shadow" style={{ backgroundColor: color }}>
        {name}
      </span>
    </span>
  );
}
