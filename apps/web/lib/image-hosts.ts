import { useSyncExternalStore } from "react";

/**
 * Sites this browser has chosen to load card and note images from without
 * asking. Images from anywhere else wait for a click, so a board can't make
 * every visitor's browser contact a server they didn't choose.
 */
const KEY = "lk:image-hosts";
const listeners = new Set<() => void>();
let cache: string[] | null = null;

function read(): string[] {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    cache = Array.isArray(parsed) ? parsed.filter((h): h is string => typeof h === "string") : [];
  } catch {
    cache = [];
  }
  return cache;
}

const EMPTY: string[] = [];

export function useAllowedImageHosts(): string[] {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    read,
    () => EMPTY,
  );
}

export function allowImageHost(host: string) {
  const next = [...new Set([...read(), host])];
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: allowed for this tab only.
  }
  for (const l of listeners) l();
}

/** The host of an http(s) image URL, or null if it isn't one. */
export function imageHost(src: string): string | null {
  try {
    const url = new URL(src);
    return url.protocol === "https:" || url.protocol === "http:" ? url.host : null;
  } catch {
    return null;
  }
}

/** The first Markdown image (![alt](url)) in `text`, if any. */
export function firstImage(text: string): { src: string; alt: string } | null {
  const m = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/.exec(text);
  return m && imageHost(m[2]) ? { src: m[2], alt: m[1] } : null;
}
