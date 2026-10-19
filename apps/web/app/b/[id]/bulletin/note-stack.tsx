"use client";

import type { Column, Note, Peer } from "@livekanban/protocol";
import { EditingBadge } from "../kanban/card";
import { Markdown } from "../kanban/markdown";
import { NoteMenu, PAPER, useNoteEditor } from "./note";

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Text typed right after creating a note is part of creating it; later changes count as edits. */
const EDIT_AFTER_MS = 60_000;

interface NoteStackProps {
  notes: Note[];
  columns: Column[];
  lastCardPosition: (columnId: string) => string | null;
  pinnedNoteId: string | null;
  editors: Record<string, Peer[]>;
  canEdit: boolean;
  justCreated: string | null;
  onEditingDone: () => void;
  onDelete: (note: Note) => void;
}

/**
 * The bulletin as a feed: one full-width card per note, newest created at the
 * top, each with its number and when it was created and last edited.
 */
export function NoteStack({ notes, columns, lastCardPosition, pinnedNoteId, editors, canEdit, justCreated, onEditingDone, onDelete }: NoteStackProps) {
  const ordered = [...notes].sort((a, b) => b.createdAt - a.createdAt || b.number - a.number);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-stone-100 px-4 py-6 dark:bg-stone-900" data-presence-area data-anchor="stack">
      {ordered.length === 0 ? (
        <p className="mt-16 text-center text-sm text-stone-500">No notes yet.</p>
      ) : (
        <ol className="mx-auto flex max-w-2xl flex-col gap-4" aria-label="Notes, newest first">
          {ordered.map((note) => (
            <StackNote
              key={note.id}
              note={note}
              columns={columns}
              lastCardPosition={lastCardPosition}
              pinned={note.id === pinnedNoteId}
              editors={editors[note.id] ?? []}
              canEdit={canEdit}
              startEditing={note.id === justCreated}
              onEditingDone={onEditingDone}
              onDelete={onDelete}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function StackNote({
  note,
  columns,
  lastCardPosition,
  pinned,
  editors,
  canEdit,
  startEditing,
  onEditingDone,
  onDelete,
}: {
  note: Note;
  columns: Column[];
  lastCardPosition: (columnId: string) => string | null;
  pinned: boolean;
  editors: Peer[];
  canEdit: boolean;
  startEditing: boolean;
  onEditingDone: () => void;
  onDelete: (note: Note) => void;
}) {
  const textEditor = useNoteEditor(note, { start: startEditing, canEdit, onDone: onEditingDone });
  const editedLater = note.updatedAt - note.createdAt >= EDIT_AFTER_MS;
  const editor = editors[0];

  return (
    <li
      data-anchor={note.id}
      role="group"
      aria-label={`Note: ${note.text.slice(0, 60) || "empty"}`}
      className={`group relative rounded-lg border shadow-sm ${PAPER[note.color]}`}
      style={editor ? { boxShadow: `0 0 0 3px ${editor.color}` } : undefined}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-black/10 px-4 py-2 text-xs text-stone-600">
        {note.number > 0 && <span className="font-semibold tabular-nums text-stone-800">#{note.number}</span>}
        {pinned && <span className="rounded bg-stone-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">Pinned</span>}
        <span>
          Created <time dateTime={new Date(note.createdAt).toISOString()}>{when.format(note.createdAt)}</time>
        </span>
        {editedLater && (
          <span>
            · Edited <time dateTime={new Date(note.updatedAt).toISOString()}>{when.format(note.updatedAt)}</time> by {note.updatedBy}
          </span>
        )}
        {canEdit && !textEditor.editing && (
          <span className="ml-auto flex items-center gap-1">
            <button type="button" onClick={textEditor.open} className="rounded px-2 py-0.5 font-medium text-stone-700 hover:bg-black/10">
              Edit
            </button>
            {/* The menu positions itself absolutely; give it a relative box in the header. */}
            <span className="relative h-6 w-7 [&>details]:opacity-100">
              <NoteMenu note={note} pinned={pinned} columns={columns} lastCardPosition={lastCardPosition} onEdit={textEditor.open} onDelete={() => onDelete(note)} />
            </span>
          </span>
        )}
      </header>
      {editor && <EditingBadge peers={editors} />}
      <div className="px-4 py-3">
        {textEditor.editing ? (
          <textarea {...textEditor.textareaProps} rows={8} className="w-full resize-y rounded-md border border-black/15 bg-white/60 p-2 text-sm text-stone-900 outline-none focus:border-teal-600" />
        ) : note.text ? (
          <div onDoubleClick={textEditor.open}>
            <Markdown text={note.text} onPaper />
          </div>
        ) : (
          <p className="text-sm text-stone-500">Empty note</p>
        )}
      </div>
    </li>
  );
}
