import { useSyncExternalStore } from "react";
import { THEME_EVENT as EVENT, THEME_KEY as KEY } from "./theme-script";

/** The viewer's choice; "system" follows the device's light/dark setting. */
export type ThemeChoice = "system" | "light" | "dark";

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function setTheme(choice: ThemeChoice) {
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Storage blocked: the choice lasts until the page is reloaded.
    const dark = choice === "dark" || (choice === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }
  // The inline script listens for this and re-applies the theme.
  window.dispatchEvent(new Event(EVENT));
}

export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener(EVENT, onChange);
      window.addEventListener("storage", onChange);
      return () => {
        window.removeEventListener(EVENT, onChange);
        window.removeEventListener("storage", onChange);
      };
    },
    read,
    () => "system",
  );
}
