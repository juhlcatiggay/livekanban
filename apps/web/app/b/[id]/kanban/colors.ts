import type { Color } from "@livekanban/protocol";

/** Literal class names so Tailwind can see them. */
export const COLOR_STYLES: Record<Color, { stripe: string; swatch: string; label: string }> = {
  gray: { stripe: "bg-stone-400", swatch: "bg-stone-400", label: "Gray" },
  red: { stripe: "bg-red-500", swatch: "bg-red-500", label: "Red" },
  amber: { stripe: "bg-amber-500", swatch: "bg-amber-500", label: "Amber" },
  green: { stripe: "bg-green-500", swatch: "bg-green-500", label: "Green" },
  teal: { stripe: "bg-teal-500", swatch: "bg-teal-500", label: "Teal" },
  blue: { stripe: "bg-blue-500", swatch: "bg-blue-500", label: "Blue" },
  purple: { stripe: "bg-purple-500", swatch: "bg-purple-500", label: "Purple" },
  pink: { stripe: "bg-pink-500", swatch: "bg-pink-500", label: "Pink" },
};
