import type { Metadata } from "next";
import Link from "next/link";
import { ThemeToggle } from "../theme-toggle";
import { CreateBoardForm } from "./create-board-form";

export const metadata: Metadata = {
  title: "New Board · LiveKanban",
  robots: { index: false },
};

export default function NewBoardPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="material material-edge sticky top-0 z-30 border-b">
        <nav className="mx-auto flex h-12 max-w-5xl items-center justify-between px-4 text-sm" aria-label="Main">
          <Link href="/" className="press font-semibold">
            ‹ LiveKanban
          </Link>
          <span className="flex items-center gap-4">
            <Link href="/#my-boards" className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
              My boards
            </Link>
            <ThemeToggle />
          </span>
        </nav>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-6">
        <CreateBoardForm />
      </main>
    </div>
  );
}
