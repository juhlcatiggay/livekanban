"use client";

import { setTheme, useThemeChoice, type ThemeChoice } from "@/lib/theme";

const OPTIONS: { value: ThemeChoice; label: string; icon: React.ReactNode }[] = [
  {
    value: "system",
    label: "Match system appearance",
    icon: <path d="M4 5h16v11H4zM9 20h6M12 16v4" />,
  },
  {
    value: "light",
    label: "Light appearance",
    icon: <path d="M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />,
  },
  {
    value: "dark",
    label: "Dark appearance",
    icon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  },
];

/** System / Light / Dark, as a small segmented control (like macOS Appearance). */
export function ThemeToggle() {
  const choice = useThemeChoice();
  return (
    <div role="group" aria-label="Appearance" className="segmented">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-label={o.label}
          title={o.label}
          aria-pressed={choice === o.value}
          onClick={() => setTheme(o.value)}
          className={`flex h-6 w-7 items-center justify-center rounded-[7px] ${choice === o.value ? "text-gray-900 dark:text-white" : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"}`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-3.5 w-3.5">
            {o.icon}
          </svg>
        </button>
      ))}
    </div>
  );
}
