"use client";

import { useEffect, useRef } from "react";
import { answerConfirm, useConfirmStore } from "@/lib/confirm";

/** The "Are you sure?" modal for destructive actions (see confirmAction). */
export function ConfirmDialog() {
  const request = useConfirmStore((s) => s.request);
  const ref = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);

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
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-xl bg-white p-0 text-stone-900 shadow-2xl backdrop:bg-black/50 dark:bg-stone-900 dark:text-stone-100"
    >
      {request && (
        <div className="flex flex-col gap-3 p-5">
          <h2 className="text-lg font-semibold">{request.title}</h2>
          {request.body && <p className="text-sm text-stone-600 dark:text-stone-300">{request.body}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button
              ref={cancel}
              type="button"
              onClick={() => answerConfirm(false)}
              className="rounded-md border border-stone-300 px-3 py-1.5 text-sm font-medium hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => answerConfirm(true)}
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700"
            >
              {request.confirmLabel}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
