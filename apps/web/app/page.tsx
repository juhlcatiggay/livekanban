import Link from "next/link";
import { CreateBoardButton } from "./create-board-button";
import { Icon, type IconName } from "./icons";
import { MyBoards } from "./recent-boards";
import { ThemeToggle } from "./theme-toggle";
import { TryBoard } from "./try-board";

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  { icon: "cursor", title: "Everyone, live.", body: "See each person's pointer, what they're dragging and where they're typing, the moment it happens." },
  { icon: "link", title: "Share a link. That's it.", body: "No accounts, no emails, no passwords to remember. Whoever has the link is in." },
  { icon: "columns", title: "Three ways to see it.", body: "Kanban columns, a bulletin wall of sticky notes, and a calendar of what's due." },
  { icon: "checklist", title: "Cards that do more.", body: "Checklists with progress, color-coded labels, assignees, dates and full Markdown." },
  { icon: "shield", title: "You're in control.", body: "Add a password, make parts view-only for others, or delete the board whenever you like." },
  { icon: "clock", title: "Nothing is lost.", body: "Every change is in the history, deletes go to the trash, and idle boards clear themselves after 60 days." },
];

const STEPS = [
  { title: "Create", body: "Name your board, add a password if you want one." },
  { title: "Share", body: "Send the link. Your team joins with their own name and cursor." },
  { title: "Plan together", body: "Drag, tick and mention. Everyone sees it live." },
];

export default function Home() {
  return (
    <div className="lk-smooth-scroll flex min-h-dvh flex-col bg-white dark:bg-black">
      <header className="material material-edge sticky top-0 z-30 border-b">
        <nav className="mx-auto flex h-12 max-w-[980px] items-center justify-between px-4 text-xs" aria-label="Main">
          <Link href="/" className="press text-[15px] font-semibold">
            LiveKanban
          </Link>
          <div className="flex items-center gap-4 sm:gap-6">
            <a href="#features" className="hidden text-gray-600 hover:text-gray-900 sm:inline dark:text-gray-400 dark:hover:text-white">
              Features
            </a>
            <a href="#my-boards" className="hidden whitespace-nowrap text-gray-600 hover:text-gray-900 min-[420px]:inline dark:text-gray-400 dark:hover:text-white">
              My boards
            </a>
            <ThemeToggle />
            <CreateBoardButton label="Create board" size="small" />
          </div>
        </nav>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-[980px] px-4 pb-16 pt-20 text-center sm:pt-24">
          <p className="text-[17px] font-semibold text-accent-600 dark:text-accent-400">LiveKanban</p>
          <h1 className="mx-auto mt-2 max-w-3xl text-5xl font-semibold tracking-[-0.03em] sm:text-7xl sm:leading-[1.05]">
            Plan together.
            <br />
            Live.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-xl leading-snug text-gray-600 sm:text-[21px] dark:text-gray-400">
            A kanban board you share with a link. Everyone&apos;s cursors, drags and edits appear the moment they happen.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
            <CreateBoardButton />
            <a href="#how" className="press inline-flex items-center gap-0.5 text-[17px] text-accent-700 hover:underline dark:text-accent-400">
              See how it works
              <Icon name="chevron" className="h-4 w-4" />
            </a>
          </div>
          <p className="mt-4 text-xs text-gray-500">Free. No account. Works in any browser.</p>
          <div className="mx-auto mt-14 max-w-3xl">
            <TryBoard />
            <p className="mt-4 text-xs text-gray-500">Go ahead, drag a card. It&apos;s a real board, just not saved.</p>
          </div>
        </section>

        <section id="features" aria-labelledby="features-heading" className="scroll-mt-12 bg-gray-100 py-20 dark:bg-gray-900/50">
          <div className="mx-auto max-w-[980px] px-4">
            <h2 id="features-heading" className="reveal text-center text-4xl font-semibold sm:text-5xl">
              Simple to start.
              <br />
              <span className="text-gray-500">Built for working together.</span>
            </h2>
            <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <li key={f.title} className="reveal rounded-[18px] bg-white p-7 dark:bg-gray-900">
                  <span className="text-accent-600 dark:text-accent-400">
                    <Icon name={f.icon} className="h-7 w-7" />
                  </span>
                  <h3 className="mt-4 text-[21px] font-semibold">{f.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-gray-600 dark:text-gray-400">{f.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="how" aria-labelledby="how-heading" className="mx-auto max-w-[980px] scroll-mt-12 px-4 py-20">
          <h2 id="how-heading" className="reveal text-center text-4xl font-semibold sm:text-5xl">
            How it works.
          </h2>
          <ol className="mt-12 grid gap-10 text-center sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="reveal">
                <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-[17px] font-semibold text-accent-600 dark:bg-gray-900 dark:text-accent-400">
                  {i + 1}
                </span>
                <h3 className="mt-4 text-[21px] font-semibold">{s.title}</h3>
                <p className="mx-auto mt-2 max-w-60 text-[15px] text-gray-600 dark:text-gray-400">{s.body}</p>
              </li>
            ))}
          </ol>
          <div className="mt-12 text-center">
            <CreateBoardButton />
          </div>
        </section>

        <div className="bg-gray-100 dark:bg-gray-900/50">
          <MyBoards />
        </div>
      </main>

      <footer className="bg-gray-100 dark:bg-gray-900/50">
        <p className="hairline mx-auto max-w-[980px] border-t px-4 py-5 text-xs text-gray-500">
          Anyone with a board&apos;s link can open it, unless its host sets a password. Boards are deleted after 60 days without a visit or edit.
        </p>
      </footer>
    </div>
  );
}
