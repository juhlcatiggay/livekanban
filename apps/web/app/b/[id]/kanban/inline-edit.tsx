"use client";

import { useRef, useState } from "react";
import { LIMITS } from "@livekanban/protocol";

interface InlineEditProps {
  value: string;
  onCommit: (value: string) => void;
  /** Accessible name for the field, e.g. "column title". */
  label: string;
  className?: string;
  /** Called with true when the input opens and false when it closes. */
  onEditingChange?: (editing: boolean) => void;
  /** Read-only: show the text without the rename affordance (e.g. the host made it view-only). */
  disabled?: boolean;
}

/** Text that turns into an input on click; Enter or blur saves, Escape cancels. */
export function InlineEdit({ value, onCommit, label, className = "", onEditingChange, disabled = false }: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const done = useRef(false);

  if (disabled) return <span className={`min-w-0 truncate px-1 ${className}`}>{value}</span>;

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(value);
          done.current = false;
          setEditing(true);
          onEditingChange?.(true);
        }}
        className={`min-w-0 truncate rounded px-1 text-left hover:bg-stone-200/60 dark:hover:bg-stone-800 ${className}`}
        aria-label={`Rename ${label}: ${value}`}
      >
        {value}
      </button>
    );
  }

  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    onEditingChange?.(false);
    const next = draft.trim();
    if (save && next && next !== value) onCommit(next);
  };

  return (
    <input
      autoFocus
      aria-label={label}
      value={draft}
      maxLength={LIMITS.title}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
      className={`min-w-0 rounded border border-teal-500 bg-white px-1 outline-none dark:bg-stone-900 ${className}`}
    />
  );
}
