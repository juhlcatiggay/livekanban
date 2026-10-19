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
          className="flex h-5 w-5 items-center justify-center rounded-full border border-white text-[9px] font-semibold text-white dark:border-stone-900"
          style={{ backgroundColor: colorFor(n) }}
        >
          {initials(n)}
        </span>
      ))}
      {extra > 0 && (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full border border-white bg-stone-300 px-1 text-[9px] font-semibold text-stone-700 dark:border-stone-900 dark:bg-stone-600 dark:text-stone-100">
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

  const add = (raw: string) => {
    const name = raw.trim().slice(0, LIMITS.assignee);
    if (!name || full || value.some((v) => v.toLowerCase() === name.toLowerCase())) return;
    onChange([...value, name]);
  };
  const remove = (name: string) => onChange(value.filter((v) => v !== name));
  const offered = suggestions.filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase())).slice(0, 6);

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={`flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-stone-300 px-1.5 py-1 focus-within:border-teal-500 dark:border-stone-700 ${
          readOnly ? "bg-stone-50 dark:bg-stone-800/40" : ""
        }`}
      >
        {value.map((name) => (
          <span key={name} className="flex items-center gap-1 rounded-full bg-stone-100 py-0.5 pl-0.5 pr-2 text-sm font-normal dark:bg-stone-800">
            <span
              className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold text-white"
              style={{ backgroundColor: colorFor(name) }}
            >
              {initials(name)}
            </span>
            {name}
            {!readOnly && (
              <button type="button" onClick={() => remove(name)} aria-label={`Remove ${name}`} className="ml-0.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200">
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
                v.split(",").slice(0, -1).forEach(add);
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
        {readOnly && !value.length && <span className="px-1 text-sm font-normal text-stone-400">Nobody</span>}
      </div>
      {!readOnly && !full && offered.length > 0 && (
        <div className="flex flex-wrap gap-1 text-xs font-normal">
          {offered.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="rounded-full border border-dashed border-stone-300 px-2 py-0.5 text-stone-600 hover:border-teal-500 hover:text-teal-700 dark:border-stone-700 dark:text-stone-300"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
