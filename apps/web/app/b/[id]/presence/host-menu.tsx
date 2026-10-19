"use client";

import { useState } from "react";
import { DEFAULT_PERMISSIONS, PASSWORD, PERMISSION_LABELS, toExport, type Permission } from "@livekanban/protocol";
import { useBoard } from "@/lib/board-store";
import { confirmAction } from "@/lib/confirm";
import { downloadFile, slug } from "@/lib/download";
import { getHostKey, hostLink } from "@/lib/host";
import { useCan } from "@/lib/use-can";
import { useDismiss } from "@/lib/use-dismiss";

const PERMISSIONS = Object.keys(DEFAULT_PERMISSIONS) as Permission[];

/** The host's settings: what everyone else may change, and a link to be host elsewhere. */
export function HostMenu({ boardId }: { boardId: string }) {
  const can = useCan();
  const permissions = useBoard((s) => s.board?.permissions ?? DEFAULT_PERMISSIONS);
  const dispatch = useBoard((s) => s.dispatch);
  const menu = useDismiss();
  const [copied, setCopied] = useState(false);
  if (!can.isHost) return null;

  const deleteBoard = async () => {
    const board = useBoard.getState().board;
    if (!board) return;
    const ok = await confirmAction({
      title: "Delete this board for everyone?",
      body: "Every column, card and note is deleted permanently, the trash and daily backups too, and everyone on the board is disconnected. This can't be undone.",
      confirmLabel: "Delete board",
      typeToConfirm: board.title,
      secondary: {
        label: "Download a copy first (JSON)",
        onClick: () => downloadFile(`${slug(board.title)}.json`, JSON.stringify(toExport(board), null, 2), "application/json"),
      },
    });
    if (ok) useBoard.getState().deleteBoard();
  };

  const copyHostLink = async () => {
    const key = getHostKey(boardId);
    if (!key) return;
    await navigator.clipboard.writeText(hostLink(boardId, key));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <details ref={menu} className="relative">
      <summary className="cursor-pointer list-none rounded-md px-2 py-1 text-[13px] font-medium text-gray-700 hover:bg-black/5 dark:text-gray-200 dark:hover:bg-white/10">
        Host settings
      </summary>
      <div className="absolute right-0 z-40 mt-1 w-72 rounded-xl border border-black/10 bg-white/90 backdrop-blur-xl backdrop-saturate-150 p-3 text-sm shadow-[0_12px_40px_-8px_rgb(0_0_0/0.28)] dark:border-white/10 dark:bg-gray-800/90">
        <fieldset>
          <legend className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">Everyone else can</legend>
          {PERMISSIONS.map((p) => (
            <label key={p} className="flex items-center justify-between gap-3 py-1.5">
              <span className="first-letter:uppercase">{PERMISSION_LABELS[p]}</span>
              <input
                type="checkbox"
                role="switch"
                checked={permissions[p]}
                onChange={(e) => dispatch({ kind: "board.permissions", permissions: { ...permissions, [p]: e.target.checked } })}
                className="switch"
              />
            </label>
          ))}
        </fieldset>
        <p className="mt-1 text-xs text-gray-500">Unchecked parts are view-only for everyone but you. You can always change everything.</p>
        <div className="hairline mt-3 border-t pt-3">
          <button
            type="button"
            onClick={copyHostLink}
            className="rounded-full px-2 py-1 text-sm hover:bg-black/10 dark:hover:bg-white/15 bg-black/5 dark:bg-white/10"
          >
            {copied ? "Host link copied" : "Copy host link"}
          </button>
          <p className="mt-1 text-xs text-gray-500">Opens this board as host on another device. Anyone with it becomes a host, so share it only with co-hosts.</p>
        </div>
        <PasswordSettings />
        <div className="hairline mt-3 border-t pt-3">
          <button
            type="button"
            onClick={deleteBoard}
            className="rounded-md px-2 py-1 text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
          >
            Delete board…
          </button>
        </div>
      </div>
    </details>
  );
}

/** Set, change or remove the password everyone but the host needs to open the board. */
function PasswordSettings() {
  const locked = useBoard((s) => s.locked);
  const setPassword = useBoard((s) => s.setPassword);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");

  const save = () => {
    if (value.length < PASSWORD.min) return;
    setPassword(value);
    setValue("");
    setEditing(false);
  };

  return (
    <div className="hairline mt-3 border-t pt-3">
      <p className="font-medium">Password</p>
      <p className="mt-0.5 text-xs text-gray-500">
        {locked ? "On: everyone else needs it to open the board. People already here stay." : "Off: anyone with the link can open the board."}
      </p>
      {editing ? (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input
            autoFocus
            type="text"
            autoComplete="new-password"
            aria-label="New board password"
            placeholder={`At least ${PASSWORD.min} characters`}
            value={value}
            maxLength={PASSWORD.max}
            onChange={(e) => setValue(e.target.value)}
            className="field min-w-0 flex-1 rounded-md px-2 py-1"
          />
          <button type="submit" disabled={value.length < PASSWORD.min} className="rounded-full bg-accent-600 px-2 py-1 font-medium text-white disabled:opacity-50">
            Save
          </button>
        </form>
      ) : (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-full px-2 py-1 hover:bg-black/10 dark:hover:bg-white/15 bg-black/5 dark:bg-white/10"
          >
            {locked ? "Change password" : "Set a password"}
          </button>
          {locked && (
            <button
              type="button"
              onClick={async () => {
                const ok = await confirmAction({
                  title: "Remove the password?",
                  body: "Anyone with the link will be able to open the board again.",
                  confirmLabel: "Remove password",
                });
                if (ok) setPassword(null);
              }}
              className="rounded-md px-2 py-1 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
            >
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** For everyone but the host: which parts the host has made view-only. */
export function ViewOnlyNotice() {
  const can = useCan();
  if (can.isHost) return null;
  const restricted = PERMISSIONS.filter((p) => !can[p]);
  if (!restricted.length) return null;
  return (
    <p className="hairline border-b bg-accent-50 px-4 py-1.5 text-center text-xs text-accent-900 dark:bg-accent-950 dark:text-accent-100" role="status">
      View only: the host doesn&apos;t let others {restricted.map((p) => PERMISSION_LABELS[p]).join(", ")}
    </p>
  );
}
