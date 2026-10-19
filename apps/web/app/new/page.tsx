import type { Metadata } from "next";
import Link from "next/link";
import { CreateBoardForm } from "./create-board-form";

export const metadata: Metadata = {
  title: "Create a board · LiveKanban",
  robots: { index: false },
};

export default function NewBoardPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-stone-50 dark:bg-stone-950">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4">
        <Link href="/" className="text-lg font-bold tracking-tight">
          LiveKanban
        </Link>
        <Link href="/#my-boards" className="text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white">
          My boards
        </Link>
      </header>
      <main className="flex flex-1 justify-center px-4 pb-16 pt-6">
        <CreateBoardForm />
      </main>
    </div>
  );
}
