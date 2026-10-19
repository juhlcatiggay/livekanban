"use client";

import { useSyncExternalStore } from "react";

/** How this viewer shows the bulletin: free-form sticky notes, or a newest-first card stack. Per browser. */
export type BulletinLayout = "canvas" | "stack";

const KEY = "lk:bulletin-layout";
const EVENT = "lk:bulletin-layout-change";

const read = (): BulletinLayout => {
  try {
    return localStorage.getItem(KEY) === "stack" ? "stack" : "canvas";
  } catch {
    return "canvas";
  }
};

const subscribe = (onChange: () => void) => {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
};

export function useBulletinLayout(): BulletinLayout {
  return useSyncExternalStore(subscribe, read, () => "canvas");
}

export function setBulletinLayout(layout: BulletinLayout) {
  try {
    localStorage.setItem(KEY, layout);
  } catch {
    // Storage blocked: the choice lasts until reload.
  }
  window.dispatchEvent(new Event(EVENT));
}
