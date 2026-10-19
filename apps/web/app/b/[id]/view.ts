"use client";

import { useSyncExternalStore } from "react";

/** Which tab of the board is showing. Kept in the URL hash so it survives reloads and can be linked. */
export type View = "kanban" | "bulletin";

const subscribe = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};

const current = (): View => (window.location.hash === "#bulletin" ? "bulletin" : "kanban");

export function useView(): View {
  return useSyncExternalStore(subscribe, current, () => "kanban");
}

export function setView(view: View) {
  window.location.hash = view;
}
