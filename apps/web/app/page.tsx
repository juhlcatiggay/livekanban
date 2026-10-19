import { CreateBoardButton } from "./create-board-button";
import { RecentBoards } from "./recent-boards";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-10 px-4 py-16">
      <div className="max-w-xl text-center">
        <h1 className="text-4xl font-bold tracking-tight">LiveKanban</h1>
        <p className="mt-3 text-lg text-stone-600 dark:text-stone-400">
          A kanban board you can share by link. See everyone&apos;s cursors live. No signup.
        </p>
      </div>
      <CreateBoardButton allowImport />
      <RecentBoards />
      <p className="max-w-md text-center text-xs text-stone-500">
        Anyone with a board&apos;s link can view and edit it. Boards are deleted after 60 days without a visit.
      </p>
    </main>
  );
}
