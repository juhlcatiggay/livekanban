"use client";

import { useRef, useState } from "react";
import { mentionMarkdown, type BoardData } from "@livekanban/protocol";
import { useBoard } from "@/lib/board-store";

/**
 * A Markdown textarea with a formatting toolbar, for people who don't know
 * Markdown: select text and press Bold, or press a button to start a list.
 * Typing @ opens a picker of cards and notes; only a picked item becomes a
 * mention, so "Top #1 Fan" or an email address stays plain text.
 *
 * `onBlur` fires only when focus leaves the whole editor (toolbar and pickers
 * included), so a note can finish editing on blur without the toolbar closing it.
 */
interface MarkdownEditorProps {
  value: string;
  onChange: (text: string) => void;
  onBlur?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  "aria-label": string;
  maxLength?: number;
  rows?: number;
  placeholder?: string;
  autoFocus?: boolean;
  /** Classes for the textarea. */
  className?: string;
  /** "inline": toolbar above the text. "floating": toolbar sits just above the box (sticky notes). */
  toolbar?: "inline" | "floating";
  /** Classes for the wrapper (e.g. h-full for sticky notes). */
  wrapperClassName?: string;
}

type Popover = { kind: "link" | "image"; text: string; url: string } | null;
/** `left`/`top`: where the "@" is, relative to the editor, so the list opens under it. */
type Picker = { start: number; query: string; active: number; left: number; top: number } | null;

/**
 * "@" then up to 30 characters right before the caret, at a word start (so
 * "ada@example.com" doesn't open it). The query stops at spaces, brackets and
 * parentheses, so a just-inserted "[@1](#1)" doesn't reopen the list.
 */
const PICKER_TRIGGER = /(?:^|[\s([])@([^\s@[\]()]{0,30})$/;

export function MarkdownEditor({
  value,
  onChange,
  onBlur,
  onKeyDown,
  maxLength,
  rows,
  placeholder,
  autoFocus,
  className = "",
  toolbar = "inline",
  wrapperClassName = "",
  ...rest
}: MarkdownEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const [popover, setPopover] = useState<Popover>(null);
  const [picker, setPicker] = useState<Picker>(null);
  /** Selection to restore when a popover inserts its result. */
  const saved = useRef<[number, number]>([0, 0]);
  const board = useBoard((s) => s.board);
  const matches = picker && board ? pickerMatches(board, picker.query) : [];

  /**
   * Replaces [start, end) with `text` and selects [selStart, selEnd) within it.
   * Uses insertText so the browser's own undo (Ctrl+Z) still works.
   */
  const replace = (start: number, end: number, text: string, selStart = text.length, selEnd = selStart) => {
    const ta = ref.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(start, end);
    const ok = typeof document.execCommand === "function" && document.execCommand("insertText", false, text);
    if (!ok || ta.value.slice(start, start + text.length) !== text) {
      onChange(ta.value.slice(0, start) + text + ta.value.slice(end));
    }
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + selStart, start + selEnd);
    });
  };

  const selection = () => {
    const ta = ref.current!;
    return { start: ta.selectionStart, end: ta.selectionEnd, text: ta.value.slice(ta.selectionStart, ta.selectionEnd) };
  };

  /** Wraps the selection in `before`/`after`, or inserts `placeholder` wrapped and selected. */
  const wrap = (before: string, after: string, placeholderText: string) => {
    const { start, end, text } = selection();
    // Already wrapped: unwrap.
    const v = ref.current!.value;
    if (text && v.slice(start - before.length, start) === before && v.slice(end, end + after.length) === after) {
      return replace(start - before.length, end + after.length, text, 0, text.length);
    }
    const inner = text || placeholderText;
    replace(start, end, before + inner + after, before.length, before.length + inner.length);
  };

  /** Adds (or removes, if every line has it) `prefix` at the start of each selected line. */
  const prefixLines = (prefix: string | ((i: number) => string)) => {
    const ta = ref.current!;
    const v = ta.value;
    const lineStart = v.lastIndexOf("\n", ta.selectionStart - 1) + 1;
    let lineEnd = v.indexOf("\n", ta.selectionEnd);
    if (lineEnd === -1) lineEnd = v.length;
    const lines = v.slice(lineStart, lineEnd).split("\n");
    const pre = (i: number) => (typeof prefix === "string" ? prefix : prefix(i));
    const all = lines.every((l, i) => l.startsWith(pre(i)));
    const next = lines.map((l, i) => (all ? l.slice(pre(i).length) : pre(i) + l)).join("\n");
    replace(lineStart, lineEnd, next, next.length);
  };

  const codeBlock = () => {
    const { start, end, text } = selection();
    if (text.includes("\n")) return replace(start, end, "```\n" + text + "\n```", 4, 4 + text.length);
    wrap("`", "`", "code");
  };

  const openPopover = (kind: "link" | "image") => {
    const { start, end, text } = selection();
    saved.current = [start, end];
    setPicker(null);
    setPopover({ kind, text, url: "" });
  };

  const insertFromPopover = () => {
    if (!popover) return;
    const url = popover.url.trim();
    setPopover(null);
    const [start, end] = saved.current;
    if (!url) return ref.current?.focus();
    const label = popover.text.trim() || (popover.kind === "image" ? "image" : url);
    const md = popover.kind === "image" ? `![${label}](${url})` : `[${label}](${url})`;
    replace(start, end, md);
  };

  const table = () => {
    const { start, end } = selection();
    const v = ref.current!.value;
    const lead = start > 0 && v[start - 1] !== "\n" ? "\n\n" : "";
    const md = `${lead}| Column | Column |\n| --- | --- |\n| Text | Text |\n`;
    replace(start, end, md, lead.length + 2, lead.length + 8);
  };

  /** Inserts "@", which opens the picker. */
  const startMention = () => {
    const { start, end } = selection();
    const v = ref.current!.value;
    const needsSpace = start > 0 && !/[\s([]/.test(v[start - 1]);
    replace(start, end, needsSpace ? " @" : "@");
    requestAnimationFrame(updatePicker);
  };

  const updatePicker = () => {
    const ta = ref.current;
    if (!ta || ta.selectionStart !== ta.selectionEnd) return setPicker(null);
    const before = ta.value.slice(0, ta.selectionStart);
    const m = PICKER_TRIGGER.exec(before);
    if (!m) return setPicker(null);
    const start = ta.selectionStart - m[1].length - 1;
    if (picker && picker.start === start) {
      if (picker.query !== m[1]) setPicker({ ...picker, query: m[1], active: 0 });
      return;
    }
    const at = caretPosition(ta, start);
    setPicker({ start, query: m[1], active: 0, left: Math.max(0, Math.min(at.left, ta.clientWidth - 200)), top: at.top + 22 });
  };

  const pick = (number: number) => {
    if (!picker) return;
    const end = ref.current!.selectionStart;
    setPicker(null);
    replace(picker.start, end, mentionMarkdown(number));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (picker && matches.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        setPicker({ ...picker, active: (picker.active + step + matches.length) % matches.length });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(matches[Math.min(picker.active, matches.length - 1)].number);
        return;
      }
    }
    if (picker && e.key === "Escape") {
      // Closes the picker only; the typed text stays as plain text.
      e.preventDefault();
      e.stopPropagation();
      setPicker(null);
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === "b") return e.preventDefault(), wrap("**", "**", "bold text");
      if (k === "i") return e.preventDefault(), wrap("_", "_", "italic text");
      if (k === "k") return e.preventDefault(), openPopover("link");
    }
    onKeyDown?.(e);
  };

  const run = (tool: ToolId) => {
    switch (tool) {
      case "bold":
        return wrap("**", "**", "bold text");
      case "italic":
        return wrap("_", "_", "italic text");
      case "strike":
        return wrap("~~", "~~", "text");
      case "heading":
        return prefixLines("## ");
      case "bullets":
        return prefixLines("- ");
      case "numbers":
        return prefixLines((i) => `${i + 1}. `);
      case "tasks":
        return prefixLines("- [ ] ");
      case "quote":
        return prefixLines("> ");
      case "code":
        return codeBlock();
      case "link":
        return openPopover("link");
      case "image":
        return openPopover("image");
      case "table":
        return table();
      case "mention":
        return startMention();
    }
  };

  return (
    <div
      ref={wrapper}
      className={`relative flex flex-col ${wrapperClassName}`}
      onBlur={(e) => {
        if (wrapper.current?.contains(e.relatedTarget as Node | null)) return;
        setPicker(null);
        setPopover(null);
        onBlur?.();
      }}
    >
      <div
        role="toolbar"
        aria-label="Formatting"
        className={
          toolbar === "floating"
            ? "absolute bottom-full left-0 z-20 mb-1 flex w-max max-w-[min(32rem,90vw)] flex-wrap gap-0.5 rounded-md border border-stone-200 bg-white p-0.5 text-stone-700 shadow-md dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
            : "mb-1 flex flex-wrap gap-0.5 rounded-md border border-stone-200 bg-stone-50 p-0.5 text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
        }
      >
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-label={t.label}
            title={t.hint ? `${t.label} (${t.hint})` : t.label}
            // Keep focus (and the selection) in the text.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => run(t.id)}
            className="flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-sm hover:bg-stone-200 dark:hover:bg-stone-700"
          >
            {t.icon}
          </button>
        ))}
      </div>

      <textarea
        ref={ref}
        aria-label={rest["aria-label"]}
        value={value}
        maxLength={maxLength}
        rows={rows}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => {
          onChange(e.target.value);
          updatePicker();
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={(e) => (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") && updatePicker()}
        onClick={updatePicker}
        className={className}
      />

      {picker && (
        <ul
          role="listbox"
          aria-label="Mention a card or note"
          className="absolute z-30 max-h-60 w-72 overflow-y-auto rounded-md border border-stone-200 bg-white py-1 text-sm text-stone-800 shadow-lg dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
          style={{ left: picker.left, top: picker.top }}
        >
          {matches.length === 0 ? (
            <li className="px-3 py-1.5 text-stone-500">No card or note matches “{picker.query}”. Keep typing; it stays plain text.</li>
          ) : (
            matches.map((m, i) => (
              <li
                key={m.number}
                role="option"
                aria-selected={i === picker.active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(m.number)}
                className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 ${i === picker.active ? "bg-teal-50 dark:bg-teal-950" : ""}`}
              >
                <span aria-hidden className="text-stone-400">
                  {m.kind === "card" ? "▤" : "✎"}
                </span>
                <span className="font-medium tabular-nums">#{m.number}</span>
                <span className="truncate">{m.label}</span>
              </li>
            ))
          )}
        </ul>
      )}

      {popover && (
        <form
          role="dialog"
          aria-label={popover.kind === "image" ? "Insert image" : "Insert link"}
          onSubmit={(e) => {
            e.preventDefault();
            insertFromPopover();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setPopover(null);
              ref.current?.focus();
            }
          }}
          className="absolute left-0 top-9 z-30 flex w-80 max-w-full flex-col gap-2 rounded-md border border-stone-200 bg-white p-3 text-sm text-stone-800 shadow-lg dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
        >
          <label className="flex flex-col gap-1 font-medium">
            {popover.kind === "image" ? "Image address (URL)" : "Link address (URL)"}
            <input
              autoFocus
              type="url"
              required
              placeholder="https://"
              value={popover.url}
              onChange={(e) => setPopover({ ...popover, url: e.target.value })}
              className="rounded border border-stone-300 bg-transparent px-2 py-1 font-normal outline-none focus:border-teal-500 dark:border-stone-700"
            />
          </label>
          <label className="flex flex-col gap-1 font-medium">
            {popover.kind === "image" ? "Description (for screen readers)" : "Text to show"}
            <input
              value={popover.text}
              onChange={(e) => setPopover({ ...popover, text: e.target.value })}
              className="rounded border border-stone-300 bg-transparent px-2 py-1 font-normal outline-none focus:border-teal-500 dark:border-stone-700"
            />
          </label>
          {popover.kind === "image" && (
            <p className="text-xs text-stone-500">Paste the address of an image that&apos;s already online, e.g. from Imgur or your own site.</p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setPopover(null);
                ref.current?.focus();
              }}
              className="rounded px-2 py-1 hover:bg-stone-100 dark:hover:bg-stone-800"
            >
              Cancel
            </button>
            <button type="submit" className="rounded bg-teal-600 px-3 py-1 font-medium text-white hover:bg-teal-700">
              Insert
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

type ToolId = "bold" | "italic" | "strike" | "heading" | "bullets" | "numbers" | "tasks" | "quote" | "code" | "link" | "image" | "table" | "mention";

const TOOLS: { id: ToolId; label: string; icon: React.ReactNode; hint?: string }[] = [
  { id: "bold", label: "Bold", hint: "Ctrl+B", icon: <b>B</b> },
  { id: "italic", label: "Italic", hint: "Ctrl+I", icon: <i className="font-serif">I</i> },
  { id: "strike", label: "Strikethrough", icon: <s>S</s> },
  { id: "heading", label: "Heading", icon: <span className="font-semibold">H</span> },
  { id: "bullets", label: "Bulleted list", icon: "•" },
  { id: "numbers", label: "Numbered list", icon: "1." },
  { id: "tasks", label: "Checklist", icon: "☑" },
  { id: "quote", label: "Quote", icon: "❝" },
  { id: "code", label: "Code", icon: <span className="font-mono text-xs">{"</>"}</span> },
  { id: "link", label: "Link", hint: "Ctrl+K", icon: "🔗" },
  { id: "image", label: "Image", icon: "🖼" },
  { id: "table", label: "Table", icon: "▦" },
  { id: "mention", label: "Mention a card or note", hint: "@", icon: "@" },
];

interface PickerMatch {
  kind: "card" | "note";
  number: number;
  label: string;
}

const noteLabel = (text: string) => text.split("\n").find((l) => l.trim())?.replace(/^#+\s*/, "").trim() || "Empty note";

/** Cards and notes whose number starts with, or whose title contains, `query`; newest first. */
export function pickerMatches(board: Pick<BoardData, "cards" | "notes">, query: string, limit = 8): PickerMatch[] {
  const q = query.toLowerCase();
  const all: PickerMatch[] = [
    ...Object.values(board.cards).map((c) => ({ kind: "card" as const, number: c.number, label: c.title })),
    ...Object.values(board.notes).map((n) => ({ kind: "note" as const, number: n.number, label: noteLabel(n.text) })),
  ].filter((m) => m.number > 0);
  const hits = q ? all.filter((m) => String(m.number).startsWith(q) || m.label.toLowerCase().includes(q)) : all;
  return hits.sort((a, b) => b.number - a.number).slice(0, limit);
}

/** Pixel position of character `index` inside a textarea, relative to the textarea's box (mirror-div technique). */
function caretPosition(ta: HTMLTextAreaElement, index: number): { left: number; top: number } {
  const style = getComputedStyle(ta);
  const mirror = document.createElement("div");
  for (const prop of [
    "boxSizing", "width", "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "wordSpacing",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderLeftWidth", "borderRightWidth", "tabSize",
  ] as const) {
    mirror.style[prop] = style[prop];
  }
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.textContent = ta.value.slice(0, index);
  const marker = document.createElement("span");
  marker.textContent = "​";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const left = marker.offsetLeft;
  const top = marker.offsetTop - ta.scrollTop;
  mirror.remove();
  return { left: left + ta.offsetLeft, top: top + ta.offsetTop };
}
