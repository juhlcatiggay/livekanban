/**
 * Shared class names for the board's controls, so every button, menu and
 * sheet looks and behaves the same (Apple's "familiarity": things that look
 * alike act alike). Literal strings so Tailwind can see them.
 */
export const ui = {
  /** Plain toolbar control: text that highlights on hover, like a Mac toolbar item. */
  toolbarButton:
    "rounded-md px-2 py-1 text-[13px] font-medium text-gray-700 hover:bg-black/5 aria-expanded:bg-black/5 dark:text-gray-200 dark:hover:bg-white/10 dark:aria-expanded:bg-white/10",
  /** Filled call to action. */
  primary: "rounded-full bg-accent-600 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-accent-700 disabled:opacity-40",
  /** Tinted secondary action. */
  secondary:
    "rounded-full bg-black/5 px-4 py-1.5 text-[13px] font-medium text-gray-800 hover:bg-black/10 disabled:opacity-40 dark:bg-white/10 dark:text-gray-100 dark:hover:bg-white/15",
  /** Text-only action in the accent color. */
  plain: "rounded-md px-2 py-1 text-[13px] font-medium text-accent-600 hover:bg-accent-600/10 dark:text-accent-400",
  /** Destructive text action. */
  destructive: "rounded-md px-2 py-1 text-[13px] font-medium text-red-600 hover:bg-red-500/10 dark:text-red-400",
  /** Close (×) button for sheets and panels. */
  close:
    "flex h-7 w-7 items-center justify-center rounded-full bg-black/5 text-base leading-none text-gray-500 hover:bg-black/10 dark:bg-white/10 dark:text-gray-300 dark:hover:bg-white/15",
  /** Dropdown panel: a light material that grows from its trigger (see globals.css). */
  menu: "absolute right-0 z-40 mt-2 rounded-xl border border-black/10 bg-white/85 p-1.5 text-[13px] shadow-[0_12px_40px_-8px_rgb(0_0_0/0.28)] backdrop-blur-xl backdrop-saturate-150 dark:border-white/10 dark:bg-gray-800/85",
  /** A row in a menu, highlighted in the accent color like a Mac menu. */
  menuItem: "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-accent-600 hover:text-white disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-inherit",
  /** Modal sheet. */
  sheet: "m-auto rounded-[20px] bg-white p-0 text-gray-900 shadow-[0_30px_80px_-20px_rgb(0_0_0/0.45)] dark:bg-gray-900 dark:text-gray-100",
  /** Small caption above a group of controls. */
  caption: "text-xs font-medium uppercase tracking-wide text-gray-500",
} as const;
