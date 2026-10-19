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
    <div className="flex flex-wrap items-center gap-2 px-4 pb-1 pt-3 text-[13px]" role="search">
      <div className="relative">
        <span aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500">
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
          className="field w-64 py-1 pl-7 pr-2"
        />
      </div>

      <details ref={menu} className="relative">
        <summary
          className={`cursor-pointer list-none rounded-full border px-3 py-1 font-medium ${
            extra ? "border-accent-500 bg-accent-50 text-accent-800 dark:bg-accent-950 dark:text-accent-200" : "border-transparent bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15"
          }`}
        >
          Filters{extra ? ` (${extra})` : ""} ▾
        </summary>
        <div className="origin-top-left absolute left-0 z-40 mt-2 flex max-h-[70vh] w-72 flex-col gap-3 overflow-y-auto rounded-xl border border-black/10 bg-white/90 backdrop-blur-xl backdrop-saturate-150 p-3 shadow-[0_12px_40px_-8px_rgb(0_0_0/0.28)] dark:border-white/10 dark:bg-gray-800/90">
          <fieldset>
            <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Due date</legend>
            {DUE_OPTIONS.map((o) => (
              <label key={o.value} className="flex items-center gap-2 py-0.5">
                <input type="radio" name="due-filter" checked={filter.due === o.value} onChange={() => setCardFilter({ due: o.value })} className="" />
                {o.label}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Labels</legend>
            {labels.length === 0 && <p className="text-gray-500">No labels yet.</p>}
            {labels.map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 py-0.5">
                <input
                  type="checkbox"
                  checked={filter.labels.includes(key)}
                  onChange={() => setCardFilter({ labels: toggle(filter.labels, key) })}
                  className=""
                  aria-label={`Label ${label}`}
                />
                <LabelChip label={label} labelColors={board.labelColors} />
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Assignees</legend>
            {people.length === 0 && <p className="text-gray-500">Nobody is assigned yet.</p>}
            {people.map((name) => (
              <label key={name} className="flex items-center gap-2 py-0.5">
                <input type="checkbox" checked={filter.assignees.includes(name)} onChange={() => setCardFilter({ assignees: toggle(filter.assignees, name) })} className="" />
                {name}
              </label>
            ))}
          </fieldset>
        </div>
      </details>

      {active && (
        <>
          <span className="text-gray-500" role="status">
            {shown} of {cards.length} card{cards.length === 1 ? "" : "s"} match
          </span>
          <button type="button" onClick={clearCardFilter} className="rounded-md px-2 py-1 text-accent-700 hover:bg-accent-50 dark:text-accent-300 dark:hover:bg-accent-950">
            Clear
          </button>
        </>
      )}
    </div>
  );
}
