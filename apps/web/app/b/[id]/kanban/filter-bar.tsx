"use client";

import { useEffect, useRef } from "react";
import { labelKey, type BoardData } from "@livekanban/protocol";
import { clearCardFilter, isFiltering, matchesFilter, setCardFilter, useCardFilter, type DueFilter } from "@/lib/card-filter";
import { useDismiss } from "@/lib/use-dismiss";
import { LabelChip } from "./labels";

const DUE_OPTIONS: { value: DueFilter; label: string }[] = [
  { value: "any", label: "Any due date" },
  { value: "overdue", label: "Overdue" },
  { value: "week", label: "Due in the next 7 days" },
  { value: "none", label: "No due date" },
];

/**
 * Search and filters for cards, above the kanban and the calendar. Press "/"
 * to jump to the search box. Cards that don't match are hidden.
 */
export function FilterBar({ board }: { board: BoardData }) {
  const filter = useCardFilter();
  const input = useRef<HTMLInputElement>(null);
  const menu = useDismiss();
  const cards = Object.values(board.cards);
  const shown = cards.filter((c) => matchesFilter(c, filter)).length;
  const active = isFiltering(filter);
  const extra = filter.labels.length + filter.assignees.length + (filter.due === "any" ? 0 : 1);

  // Labels and people used on the board, in the board's spelling.
  const labels = [...new Map(cards.flatMap((c) => c.labels.map((l) => [labelKey(l), l] as const))).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const people = [...new Set(cards.flatMap((c) => c.assignees))].sort((a, b) => a.localeCompare(b));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey) return;
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable]") || document.querySelector("dialog[open]")) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 px-4 py-2 text-sm dark:border-stone-800" role="search">
      <div className="relative">
        <span aria-hidden className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-stone-400">
          ⌕
        </span>
        <input
          ref={input}
          type="search"
          aria-label="Search cards"
          placeholder="Search cards  ( / )"
          value={filter.query}
          onChange={(e) => setCardFilter({ query: e.target.value })}
          onKeyDown={(e) => e.key === "Escape" && (filter.query ? setCardFilter({ query: "" }) : input.current?.blur())}
          className="w-64 rounded-md border border-stone-300 bg-transparent py-1 pl-7 pr-2 outline-none focus:border-teal-500 dark:border-stone-700"
        />
      </div>

      <details ref={menu} className="relative">
        <summary
          className={`cursor-pointer list-none rounded-md border px-2.5 py-1 ${
            extra ? "border-teal-500 bg-teal-50 text-teal-800 dark:bg-teal-950 dark:text-teal-200" : "border-stone-300 hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
          }`}
        >
          Filters{extra ? ` (${extra})` : ""} ▾
        </summary>
        <div className="absolute left-0 z-40 mt-1 flex max-h-[70vh] w-72 flex-col gap-3 overflow-y-auto rounded-lg border border-stone-200 bg-white p-3 shadow-lg dark:border-stone-700 dark:bg-stone-900">
          <fieldset>
            <legend className="mb-1 font-medium">Due date</legend>
            {DUE_OPTIONS.map((o) => (
              <label key={o.value} className="flex items-center gap-2 py-0.5">
                <input type="radio" name="due-filter" checked={filter.due === o.value} onChange={() => setCardFilter({ due: o.value })} className="accent-teal-600" />
                {o.label}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend className="mb-1 font-medium">Labels</legend>
            {labels.length === 0 && <p className="text-stone-500">No labels yet.</p>}
            {labels.map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 py-0.5">
                <input
                  type="checkbox"
                  checked={filter.labels.includes(key)}
                  onChange={() => setCardFilter({ labels: toggle(filter.labels, key) })}
                  className="accent-teal-600"
                  aria-label={`Label ${label}`}
                />
                <LabelChip label={label} labelColors={board.labelColors} />
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend className="mb-1 font-medium">Assignees</legend>
            {people.length === 0 && <p className="text-stone-500">Nobody is assigned yet.</p>}
            {people.map((name) => (
              <label key={name} className="flex items-center gap-2 py-0.5">
                <input type="checkbox" checked={filter.assignees.includes(name)} onChange={() => setCardFilter({ assignees: toggle(filter.assignees, name) })} className="accent-teal-600" />
                {name}
              </label>
            ))}
          </fieldset>
        </div>
      </details>

      {active && (
        <>
          <span className="text-stone-500" role="status">
            {shown} of {cards.length} card{cards.length === 1 ? "" : "s"} match
          </span>
          <button type="button" onClick={clearCardFilter} className="rounded-md px-2 py-1 text-teal-700 hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-teal-950">
            Clear
          </button>
        </>
      )}
    </div>
  );
}
