import Link from "next/link";

/** The way into a new board: the create page, where you name it and choose its settings. */
export function CreateBoardButton({ label = "Create a board", className = "" }: { label?: string; className?: string }) {
  return (
    <Link
      href="/new"
      className={`inline-flex items-center justify-center rounded-lg bg-teal-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-teal-700 ${className}`}
    >
      {label}
    </Link>
  );
}
