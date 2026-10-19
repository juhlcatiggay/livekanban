"use client";

import { useState } from "react";
import { LIMITS, PEOPLE_COLORS } from "@livekanban/protocol";

/** A stable color per name, so the same person looks the same on every card. */
function colorFor(name: string): string {
  let hash = 0;
  for (const ch of name.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PEOPLE_COLORS[hash % PEOPLE_COLORS.length];
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/** Overlapping initials for a card face; extra names collapse into "+n". */
export function AssigneeAvatars({ names, max = 3 }: { names: string[]; max?: number }) {
  if (!names.length) return null;
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return (
    <span className="flex -space-x-1.5" title={names.join(", ")} aria-label={`Assigned to ${names.join(", ")}`}>
      {shown.map((n) => (
        <span
          key={n}
          className="flex h-5 w-5 items-center justify-center rounded-full border border-white text-[9px] font-semibold text-white dark:border-gray-900"
          style={{ backgroundColor: colorFor(n) }}
        >
          {initials(n)}
        </span>
      ))}
      {extra > 0 && (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full border border-white bg-gray-300 px-1 text-[9px] font-semibold text-gray-700 dark:border-gray-900 dark:bg-gray-600 dark:text-gray-100">
          +{extra}
        </span>
      )}
    </span>
  );
}

interface AssigneesFieldProps {
  value: string[];
  onChange: (names: string[]) => void;
  /** People on the board right now, offered as one-click suggestions. */
  suggestions: string[];
  readOnly?: boolean;
}

/** Chip input: type a name, then Enter or comma; Backspace on an empty field removes the last. */
export function AssigneesField({ value, onChange, suggestions, readOnly = false }: AssigneesFieldProps) {
  const [draft, setDraft] = useState("");
  const full = value.length >= LIMITS.assignees;

  /** Adds every name in `raw` in one change (pasting "Ada, Bob, Cy" keeps all three). */
  const add = (...raw: string[]) => {
    const next = [...value];
    for (const r of raw) {
      const name = r.trim().slice(0, LIMITS.assignee);
      if (name && next.length < LIMITS.assignees && !next.some((v) => v.toLowerCase() === name.toLowerCase())) next.push(name);
    }
    if (next.length !== value.length) onChange(next);
  };
  const remove = (name: string) => onChange(value.filter((v) => v !== name));
  const offered = suggestions.filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase())).slice(0, 6);

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={`flex min-h-9 flex-wrap items-center gap-1.5 field px-1.5 py-1 ${
          readOnly ? "bg-gray-50 dark:bg-gray-800/40" : ""
        }`}
      >
        {value.map((name) => (
          <span key={name} className="flex items-center gap-1 rounded-full bg-gray-100 py-0.5 pl-0.5 pr-2 text-sm font-normal dark:bg-gray-800">
            <span
              className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold text-white"
              style={{ backgroundColor: colorFor(name) }}
            >
              {initials(name)}
            </span>
            {name}
            {!readOnly && (
              <button type="button" onClick={() => remove(name)} aria-label={`Remove ${name}`} className="ml-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                ×
              </button>
            )}
          </span>
        ))}
        {!readOnly && !full && (
          <input
            aria-label="Add assignee"
            value={draft}
            maxLength={LIMITS.assignee}
            placeholder={value.length ? "" : "Type a name and press Enter"}
            onChange={(e) => {
              const v = e.target.value;
              if (v.includes(",")) {
                add(...v.split(",").slice(0, -1));
                setDraft(v.split(",").at(-1) ?? "");
              } else setDraft(v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(draft);
                setDraft("");
              } else if (e.key === "Backspace" && !draft && value.length) {
                remove(value[value.length - 1]);
              }
            }}
            onBlur={() => {
              add(draft);
              setDraft("");
            }}
            className="min-w-24 flex-1 bg-transparent px-1 py-0.5 text-sm font-normal outline-none"
          />
        )}
        {readOnly && !value.length && <span className="px-1 text-sm font-normal text-gray-400">Nobody</span>}
      </div>
      {!readOnly && !full && offered.length > 0 && (
        <div className="flex flex-wrap gap-1 text-xs font-normal">
          {offered.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="rounded-full bg-black/5 px-2.5 py-0.5 text-gray-700 hover:bg-accent-600 hover:text-white dark:bg-white/10 dark:text-gray-200"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
