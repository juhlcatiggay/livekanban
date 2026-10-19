/** Shared by the server layout (which inlines the script) and lib/theme.ts. No React here. */
export const THEME_KEY = "lk:theme";
export const THEME_EVENT = "lk:theme-change";

/**
 * Runs in <head> before the first paint (see layout.tsx), so a page never
 * flashes the wrong theme. Kept as a string because it's inlined as-is; it
 * mirrors setTheme() in theme.ts and also follows system changes in "system" mode.
 */
export const THEME_SCRIPT = `(() => {
  const media = matchMedia("(prefers-color-scheme: dark)");
  const apply = () => {
    let choice = "system";
    try { choice = localStorage.getItem("${THEME_KEY}") || "system"; } catch {}
    const dark = choice === "dark" || (choice === "system" && media.matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  };
  apply();
  media.addEventListener("change", apply);
  window.addEventListener("${THEME_EVENT}", apply);
  window.addEventListener("storage", (e) => e.key === "${THEME_KEY}" && apply());
})();`;
