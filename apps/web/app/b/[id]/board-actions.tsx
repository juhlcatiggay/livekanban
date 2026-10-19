"use client";

import { useEffect, useRef, useState } from "react";
import { toExport, toMarkdown, type BoardData, type Op, type TrashItem } from "@livekanban/protocol";
import { useBoard } from "@/lib/board-store";
import { downloadFile, slug } from "@/lib/download";
import { useCan } from "@/lib/use-can";
import { closeMenu, useDismiss } from "@/lib/use-dismiss";

const iconButton =
  "rounded-md px-2 py-1 text-sm text-stone-600 hover:bg-stone-100 disabled:opacity-30 disabled:hover:bg-transparent dark:text-stone-300 dark:hover:bg-stone-800";

/** Undo/redo, export and trash, in the board header. */
export function BoardActions({ board }: { board: BoardData }) {
  const canUndo = useBoard((s) => s.canUndo);
  const canRedo = useBoard((s) => s.canRedo);
  const undo = useBoard((s) => s.undo);
  const redo = useBoard((s) => s.redo);
  const [trashOpen, setTrashOpen] = useState(false);

  return (
    <div className="flex items-center gap-1">
      <button type="button" className={iconButton} onClick={undo} disabled={!canUndo} aria-label="Undo your last change" title="Undo (Ctrl+Z)">
        ↶
      </button>
      <button type="button" className={iconButton} onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
        ↷
      </button>
      <ExportMenu board={board} />
      <button type="button" className={iconButton} onClick={() => setTrashOpen(true)}>
        Trash
      </button>
      {trashOpen && <TrashDialog board={board} onClose={() => setTrashOpen(false)} />}
    </div>
  );
}

function ExportMenu({ board }: { board: BoardData }) {
  const name = slug(board.title);
  const item = "w-full rounded px-2 py-1.5 text-left hover:bg-stone-100 dark:hover:bg-stone-800";
  const menu = useDismiss();
  const save = (filename: string, text: string, type: string) => {
    downloadFile(filename, text, type);
    closeMenu(menu);
  };
  return (
    <details ref={menu} className="relative">
      <summary className={`${iconButton} cursor-pointer list-none`}>Export</summary>
      <div className="absolute right-0 z-40 mt-1 w-44 rounded-lg border border-stone-200 bg-white p-1 text-sm shadow-lg dark:border-stone-700 dark:bg-stone-900">
        <button type="button" className={item} onClick={() => save(`${name}.json`, JSON.stringify(toExport(board), null, 2), "application/json")}>
          JSON (re-importable)
        </button>
        <button type="button" className={item} onClick={() => save(`${name}.md`, toMarkdown(board), "text/markdown")}>
          Markdown
        </button>
      </div>
    </details>
  );
}

const ago = (t: number) => {
  const minutes = Math.round((Date.now() - t) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
};

const restoreOp = (item: TrashItem): Op => ({ kind: `${item.kind}.restore`, id: item.id }) as Op;

/** The board's 7-day trash and daily backups. */
function TrashDialog({ board, onClose }: { board: BoardData; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const trash = useBoard((s) => s.trash);
  const requestTrash = useBoard((s) => s.requestTrash);
  const dispatch = useBoard((s) => s.dispatch);
  const fetchBackup = useBoard((s) => s.fetchBackup);
  const [busyDay, setBusyDay] = useState<string | null>(null);
  const can = useCan();
  const mayRestore = (item: TrashItem) => (item.kind === "note" ? can.editBulletin : can.editCards);

  useEffect(() => {
    ref.current?.showModal();
    requestTrash();
  }, [requestTrash]);

  const restore = (item: TrashItem) => {
    dispatch(restoreOp(item));
    // The room answers in order, so this listing reflects the restore.
    requestTrash();
  };

  const download = async (day: string) => {
    setBusyDay(day);
    const snapshot = await fetchBackup(day);
    setBusyDay(null);
    if (snapshot) downloadFile(`${slug(board.title)}-${day}.json`, JSON.stringify(toExport(snapshot), null, 2), "application/json");
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current.close()}
      aria-label="Trash"
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl bg-white p-0 text-stone-900 shadow-2xl backdrop:bg-black/40 dark:bg-stone-900 dark:text-stone-100"
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Trash</h2>
          <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="rounded px-2 text-xl leading-none text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800">
            ×
          </button>
        </div>
        <p className="-mt-2 text-sm text-stone-500">Deleted columns, cards and notes stay here for 7 days. Anyone with the link can restore them.</p>

        {!trash ? (
          <p className="text-sm text-stone-500">Loading…</p>
        ) : trash.items.length === 0 ? (
          <p className="text-sm text-stone-500">The trash is empty.</p>
        ) : (
          <ul className="max-h-72 divide-y divide-stone-200 overflow-y-auto rounded-lg border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
            {trash.items.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-12 shrink-0 text-xs uppercase tracking-wide text-stone-500">{item.kind}</span>
                <span className="min-w-0 flex-1 truncate">
                  {item.label}
                  {item.kind === "column" && item.cardCount ? <span className="text-stone-500"> · {item.cardCount} cards</span> : null}
                </span>
                <span className="shrink-0 text-xs text-stone-500">{ago(item.deletedAt)}</span>
                {mayRestore(item) && (
                  <button type="button" onClick={() => restore(item)} aria-label={`Restore ${item.kind} ${item.label}`} className="shrink-0 rounded px-2 py-0.5 font-medium text-teal-700 hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-teal-950">
                    Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {trash && trash.backups.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold">Daily backups</h3>
            <p className="text-xs text-stone-500">Download a copy of the board as it was, then import it as a new board.</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {trash.backups.map((b) => (
                <li key={b.day}>
                  <button
                    type="button"
                    disabled={busyDay !== null}
                    onClick={() => download(b.day)}
                    className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-100 disabled:opacity-50 dark:border-stone-700 dark:hover:bg-stone-800"
                  >
                    {busyDay === b.day ? "Preparing…" : b.day}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </dialog>
  );
}
