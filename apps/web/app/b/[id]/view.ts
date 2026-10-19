"use client";

import { useSyncExternalStore } from "react";

/** Which tab of the board is showing. Kept in the URL hash so it survives reloads and can be linked. */
export type View = "kanban" | "bulletin" | "calendar";

const subscribe = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};

const current = (): View => {
  const hash = window.location.hash;
  return hash === "#bulletin" ? "bulletin" : hash === "#calendar" ? "calendar" : "kanban";
};

export function useView(): View {
  return useSyncExternalStore(subscribe, current, () => "kanban");
}

export function setView(view: View) {
  window.location.hash = view;
}
