/**
 * Line icons in the spirit of SF Symbols: one stroke weight, rounded caps,
 * drawn on a 24px grid, colored by the surrounding text. Decorative only.
 */
const paths = {
  cursor: "M5 3l13 7-6 2-2 6z",
  link: "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1.5 1.5M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1.5-1.5",
  columns: "M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v6h-4z",
  checklist: "M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17M11 6.5h9M11 12.5h9M11 18.5h9",
  shield: "M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z M9 12l2 2 4-4",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M6 11h12v10H6z",
  plus: "M12 5v14M5 12h14",
  chevron: "M9 6l6 6-6 6",
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, className = "h-6 w-6" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <path d={paths[name]} />
    </svg>
  );
}
