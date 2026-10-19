"use client";

import { useEffect, useRef, useState } from "react";
import { answerConfirm, useConfirmStore } from "@/lib/confirm";

/** The "Are you sure?" modal for destructive actions (see confirmAction). */
export function ConfirmDialog() {
  const request = useConfirmStore((s) => s.request);
  const ref = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [typed, setTyped] = useState("");
  const [shownFor, setShownFor] = useState(request);
  // A new question starts with an empty confirmation field.
  if (shownFor !== request) {
    setShownFor(request);
    setTyped("");
  }
  const locked = !!request?.typeToConfirm && typed.trim() !== request.typeToConfirm.trim();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (request && !dialog.open) {
      dialog.showModal();
      // The safe choice has focus, so Enter doesn't delete by accident.
      cancel.current?.focus();
    } else if (!request && dialog.open) {
      dialog.close();
    }
  }, [request]);

  return (
    <dialog
      ref={ref}
      role="alertdialog"
      aria-label={request?.title}
      onClose={() => answerConfirm(false)}
      onClick={(e) => e.target === ref.current && answerConfirm(false)}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-[20px] bg-white p-0 text-gray-900 shadow-[0_30px_80px_-20px_rgb(0_0_0/0.45)] dark:bg-gray-900 dark:text-gray-100"
    >
      {request && (
        <div className="flex flex-col gap-3 p-5">
          <h2 className="text-lg font-semibold">{request.title}</h2>
          {request.body && <p className="text-sm text-gray-600 dark:text-gray-300">{request.body}</p>}
          {request.secondary && (
            <button
              type="button"
              onClick={request.secondary.onClick}
              className="self-start rounded-full px-3 py-1.5 text-sm font-medium hover:bg-black/10 dark:hover:bg-white/15 bg-black/5 dark:bg-white/10"
            >
              {request.secondary.label}
            </button>
          )}
          {request.typeToConfirm && (
            <label className="flex flex-col gap-1 text-sm">
              <span>
                Type <strong className="font-semibold">{request.typeToConfirm}</strong> to confirm.
              </span>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                aria-label="Type the name to confirm"
                autoComplete="off"
                className="field rounded-md px-2 py-1.5 focus:border-red-500"
              />
            </label>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <button
              ref={cancel}
              type="button"
              onClick={() => answerConfirm(false)}
              className="rounded-full px-3 py-1.5 text-sm font-medium hover:bg-black/10 dark:hover:bg-white/15 bg-black/5 dark:bg-white/10"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={locked}
              onClick={() => answerConfirm(true)}
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {request.confirmLabel}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
