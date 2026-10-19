"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

/**
 * Makes a <details> dropdown behave like a menu: it closes on a click or tap
 * outside it, on Escape (returning focus to its <summary>), and when the page
 * is hidden by a navigation (Next keeps pages alive with <Activity>, so an
 * open menu would otherwise still be open when you come back).
 *
 * Returns the ref to put on the <details>; menu items call closeMenu(ref).
 */
export function useDismiss(): RefObject<HTMLDetailsElement | null> {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onPointerDown = (e: PointerEvent) => {
      if (el.open && !el.contains(e.target as Node)) el.open = false;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !el.open) return;
      el.open = false;
      el.querySelector("summary")?.focus();
    };
    // Capture phase, so drag-and-drop handlers that stop propagation can't keep the menu open.
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  // Runs when the page is hidden by a navigation, before it's shown again.
  useLayoutEffect(() => {
    const el = ref.current;
    return () => {
      if (el) el.open = false;
    };
  }, []);

  return ref;
}

/** Closes a dropdown from one of its items (call from event handlers). */
export function closeMenu(ref: RefObject<HTMLDetailsElement | null>) {
  if (ref.current) ref.current.open = false;
}
