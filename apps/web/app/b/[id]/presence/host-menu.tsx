"use client";

import { useState } from "react";
import { DEFAULT_PERMISSIONS, PERMISSION_LABELS, type Permission } from "@livekanban/protocol";
import { useBoard } from "@/lib/board-store";
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

  const copyHostLink = async () => {
    const key = getHostKey(boardId);
    if (!key) return;
    await navigator.clipboard.writeText(hostLink(boardId, key));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <details ref={menu} className="relative">
      <summary className="cursor-pointer list-none rounded-md bg-amber-100 px-2 py-1 text-sm font-medium text-amber-900 hover:bg-amber-200 dark:bg-amber-900/60 dark:text-amber-100">
        Host settings
      </summary>
      <div className="absolute right-0 z-40 mt-1 w-72 rounded-lg border border-stone-200 bg-white p-3 text-sm shadow-lg dark:border-stone-700 dark:bg-stone-900">
        <fieldset>
          <legend className="mb-1 font-medium">Everyone else can…</legend>
          {PERMISSIONS.map((p) => (
            <label key={p} className="flex items-center gap-2 py-1">
              <input
                type="checkbox"
                checked={permissions[p]}
                onChange={(e) => dispatch({ kind: "board.permissions", permissions: { ...permissions, [p]: e.target.checked } })}
                className="h-4 w-4 accent-teal-600"
              />
              {PERMISSION_LABELS[p]}
            </label>
          ))}
        </fieldset>
        <p className="mt-1 text-xs text-stone-500">Unchecked parts are view-only for everyone but you. You can always change everything.</p>
        <div className="mt-3 border-t border-stone-200 pt-3 dark:border-stone-700">
          <button
            type="button"
            onClick={copyHostLink}
            className="rounded-md border border-stone-300 px-2 py-1 text-sm hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
          >
            {copied ? "Host link copied" : "Copy host link"}
          </button>
          <p className="mt-1 text-xs text-stone-500">Opens this board as host on another device. Anyone with it becomes a host, so share it only with co-hosts.</p>
        </div>
      </div>
    </details>
  );
}

/** For everyone but the host: which parts the host has made view-only. */
export function ViewOnlyNotice() {
  const can = useCan();
  if (can.isHost) return null;
  const restricted = PERMISSIONS.filter((p) => !can[p]);
  if (!restricted.length) return null;
  return (
    <span className="ml-auto self-center rounded-full bg-stone-100 px-2.5 py-0.5 text-xs text-stone-600 dark:bg-stone-800 dark:text-stone-300" role="status">
      View only: the host doesn&apos;t let others {restricted.map((p) => PERMISSION_LABELS[p]).join(", ")}
    </span>
  );
}
