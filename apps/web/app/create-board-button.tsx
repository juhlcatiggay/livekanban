import Link from "next/link";

/** The way into a new board: the create page, where you name it and choose its settings. */
export function CreateBoardButton({ label = "Create a board", size = "large" }: { label?: string; size?: "large" | "small" }) {
  return (
    <Link
      href="/new"
      className={`press inline-flex items-center justify-center rounded-full bg-accent-600 font-medium text-white hover:bg-accent-700 ${
        size === "large" ? "px-6 py-3 text-[17px]" : "px-3.5 py-1 text-xs"
      }`}
    >
      {label}
    </Link>
  );
}
