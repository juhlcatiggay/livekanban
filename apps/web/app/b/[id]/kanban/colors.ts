import type { Color } from "@livekanban/protocol";

/** Literal class names so Tailwind can see them. `chip` is a label chip's background, border and text, readable in both themes. */
export const COLOR_STYLES: Record<Color, { stripe: string; swatch: string; label: string; chip: string }> = {
  gray: {
    stripe: "bg-gray-400",
    swatch: "bg-gray-400",
    label: "Gray",
    chip: "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600",
  },
  red: { stripe: "bg-red-500", swatch: "bg-red-500", label: "Red", chip: "bg-red-100 text-red-800 border-red-300 dark:bg-red-950 dark:text-red-200 dark:border-red-800" },
  amber: {
    stripe: "bg-amber-500",
    swatch: "bg-amber-500",
    label: "Amber",
    chip: "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800",
  },
  green: {
    stripe: "bg-green-500",
    swatch: "bg-green-500",
    label: "Green",
    chip: "bg-green-100 text-green-800 border-green-300 dark:bg-green-950 dark:text-green-200 dark:border-green-800",
  },
  teal: { stripe: "bg-cyan-500", swatch: "bg-cyan-500", label: "Teal", chip: "bg-cyan-100 text-cyan-800 border-cyan-300 dark:bg-cyan-950 dark:text-cyan-200 dark:border-cyan-800" },
  blue: { stripe: "bg-blue-500", swatch: "bg-blue-500", label: "Blue", chip: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950 dark:text-blue-200 dark:border-blue-800" },
  purple: {
    stripe: "bg-purple-500",
    swatch: "bg-purple-500",
    label: "Purple",
    chip: "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950 dark:text-purple-200 dark:border-purple-800",
  },
  pink: { stripe: "bg-pink-500", swatch: "bg-pink-500", label: "Pink", chip: "bg-pink-100 text-pink-800 border-pink-300 dark:bg-pink-950 dark:text-pink-200 dark:border-pink-800" },
};
