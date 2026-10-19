"use client";

import { useState } from "react";
import { COLORS, LIMITS, labelColor, labelKey, type Color } from "@livekanban/protocol";
import { COLOR_STYLES } from "./colors";

/** A label in its board-wide color: the same text always looks the same on every card. */
export function LabelChip({ label, labelColors, className = "" }: { label: string; labelColors: Record<string, Color>; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium ${COLOR_STYLES[labelColor(labelColors, label)].chip} ${className}`}>
      {label}
    </span>
  );
}

interface LabelsFieldProps {
  value: string[];
  onChange: (labels: string[]) => void;
  labelColors: Record<string, Color>;
  /** Sets a label's color on the whole board (null: back to automatic). */
  onColor: (label: string, color: Color | null) => void;
  /** Labels already used on this board, offered while typing. */
  known: string[];
  readOnly?: boolean;
}

/**
 * Chip input for labels: a comma or Enter turns what you typed into a chip,
 * Backspace on an empty field removes the last one, and clicking a chip picks
 * its color for every card on the board.
 */
export function LabelsField({ value, onChange, labelColors, onColor, known, readOnly = false }: LabelsFieldProps) {
  const [draft, setDraft] = useState("");
  const [coloring, setColoring] = useState<string | null>(null);
  const full = value.length >= LIMITS.labels;

  /** Adds every name in `raw` (already split) that isn't on the card yet. */
  const addAll = (raw: string[]) => {
    const next = [...value];
    for (const r of raw) {
      const label = r.trim().slice(0, LIMITS.label);
      // Reuse the board's spelling of a known label, so "bug" and "Bug" stay one label.
      const canonical = known.find((k) => labelKey(k) === labelKey(label)) ?? label;
      if (label && next.length < LIMITS.labels && !next.some((v) => labelKey(v) === labelKey(label))) next.push(canonical);
    }
    if (next.length !== value.length) onChange(next);
  };
  const remove = (label: string) => onChange(value.filter((v) => v !== label));
  const q = labelKey(draft);
  const offered = known.filter((k) => !value.some((v) => labelKey(v) === labelKey(k)) && (!q || labelKey(k).includes(q))).slice(0, 8);

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={`flex min-h-9 flex-wrap items-center gap-1.5 field px-1.5 py-1 ${
          readOnly ? "bg-gray-50 dark:bg-gray-800/40" : ""
        }`}
      >
        {value.map((label) => {
          const color = labelColor(labelColors, label);
          return (
            <span key={label} className={`relative inline-flex items-center gap-1 rounded border py-0.5 pl-1.5 pr-1 text-sm font-medium ${COLOR_STYLES[color].chip}`}>
              {readOnly ? (
                label
              ) : (
                <button
                  type="button"
                  onClick={() => setColoring(coloring === label ? null : label)}
                  aria-label={`Color of label ${label}`}
                  aria-expanded={coloring === label}
                  title="Change this label's color on every card"
                >
                  {label}
                </button>
              )}
              {!readOnly && (
                <button type="button" onClick={() => remove(label)} aria-label={`Remove label ${label}`} className="px-0.5 opacity-60 hover:opacity-100">
                  ×
                </button>
              )}
              {coloring === label && (
                <span
                  role="group"
                  aria-label={`Colors for ${label}`}
                  className="absolute left-0 top-full z-20 mt-1 flex items-center gap-1.5 rounded-xl border border-black/10 bg-white/90 backdrop-blur-xl backdrop-saturate-150 p-2 shadow-[0_12px_40px_-8px_rgb(0_0_0/0.28)] dark:border-white/10 dark:bg-gray-800/90"
                >
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`${COLOR_STYLES[c].label} label`}
                      aria-pressed={color === c}
                      onClick={() => {
                        onColor(label, c);
                        setColoring(null);
                      }}
                      className={`h-5 w-5 rounded-full ${COLOR_STYLES[c].swatch} ${color === c ? "ring-2 ring-gray-900 ring-offset-1 dark:ring-white dark:ring-offset-gray-900" : ""}`}
                    />
                  ))}
                  {labelColors[labelKey(label)] && (
                    <button
                      type="button"
                      onClick={() => {
                        onColor(label, null);
                        setColoring(null);
                      }}
                      className="ml-1 whitespace-nowrap text-xs font-normal text-gray-600 underline dark:text-gray-300"
                    >
                      Automatic
                    </button>
                  )}
                </span>
              )}
            </span>
          );
        })}
        {!readOnly && !full && (
          <input
            aria-label="Add label"
            value={draft}
            maxLength={LIMITS.label + 1}
            placeholder={value.length ? "" : "Type a label, then a comma"}
            onChange={(e) => {
              const parts = e.target.value.split(",");
              if (parts.length > 1) {
                addAll(parts.slice(0, -1));
                setDraft(parts.at(-1) ?? "");
              } else setDraft(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addAll([draft]);
                setDraft("");
              } else if (e.key === "Backspace" && !draft && value.length) {
                remove(value[value.length - 1]);
              }
            }}
            onBlur={() => {
              addAll([draft]);
              setDraft("");
            }}
            className="min-w-24 flex-1 bg-transparent px-1 py-0.5 text-sm font-normal outline-none"
          />
        )}
        {readOnly && !value.length && <span className="px-1 text-sm font-normal text-gray-400">None</span>}
      </div>
      {!readOnly && !full && offered.length > 0 && (
        <div className="flex flex-wrap gap-1 text-xs font-normal" aria-label="Labels on this board">
          {offered.map((k) => (
            <button
              key={k}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                addAll([k]);
                setDraft("");
              }}
              className={`rounded border border-dashed px-1.5 py-0.5 opacity-80 hover:opacity-100 ${COLOR_STYLES[labelColor(labelColors, k)].chip}`}
            >
              + {k}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
