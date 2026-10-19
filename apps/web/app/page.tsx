import Link from "next/link";
import { CreateBoardButton } from "./create-board-button";
import { Icon, type IconName } from "./icons";
import { MyBoards } from "./recent-boards";

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
    <div className="flex min-h-dvh flex-col bg-white dark:bg-black">
      <header className="material material-edge sticky top-0 z-30 border-b">
        <nav className="mx-auto flex h-12 max-w-[980px] items-center justify-between px-4 text-xs" aria-label="Main">
          <Link href="/" className="press text-[15px] font-semibold">
            LiveKanban
          </Link>
          <div className="flex items-center gap-6">
            <a href="#features" className="hidden text-gray-600 hover:text-gray-900 sm:inline dark:text-gray-400 dark:hover:text-white">
              Features
            </a>
            <a href="#my-boards" className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
              My boards
            </a>
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
            <BoardPreview />
          </div>
        </section>

        <section id="features" aria-labelledby="features-heading" className="scroll-mt-12 bg-gray-100 py-20 dark:bg-gray-900/50">
          <div className="mx-auto max-w-[980px] px-4">
            <h2 id="features-heading" className="text-center text-4xl font-semibold sm:text-5xl">
              Simple to start.
              <br />
              <span className="text-gray-500">Built for working together.</span>
            </h2>
            <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <li key={f.title} className="rounded-[18px] bg-white p-7 dark:bg-gray-900">
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
          <h2 id="how-heading" className="text-center text-4xl font-semibold sm:text-5xl">
            How it works.
          </h2>
          <ol className="mt-12 grid gap-10 text-center sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title}>
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

/** A still picture of a live board: three columns, a few cards, two named cursors. Decorative. */
function BoardPreview() {
  const columns = [
    { title: "To Do", cards: [{ t: "Plan launch email", label: ["bg-pink-100 text-pink-800", "Marketing"] }, { t: "Pick a domain" }] },
    { title: "Doing", cards: [{ t: "Landing page", label: ["bg-blue-100 text-blue-800", "Design"], progress: 0.6 }, { t: "Fix sign-in", color: "bg-red-500" }] },
    { title: "Done", cards: [{ t: "Brand colors", progress: 1 }] },
  ];
  return (
    <div
      aria-hidden
      className="relative select-none rounded-[22px] border border-black/5 bg-gray-100 p-4 text-left shadow-[0_30px_80px_-20px_rgb(0_0_0/0.25)] sm:p-5 dark:border-white/10 dark:bg-gray-900"
    >
      <div className="mb-4 flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          {["bg-red-400", "bg-amber-400", "bg-green-400"].map((c) => (
            <span key={c} className={`h-2.5 w-2.5 rounded-full ${c}`} />
          ))}
          <span className="ml-3 text-sm font-semibold">Website relaunch</span>
        </span>
        <span className="flex -space-x-1.5">
          {[
            ["bg-accent-600", "S"],
            ["bg-amber-500", "T"],
            ["bg-purple-500", "W"],
          ].map(([c, l]) => (
            <span key={l} className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-2 ring-gray-100 dark:ring-gray-900 ${c}`}>
              {l}
            </span>
          ))}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {columns.map((col) => (
          <div key={col.title} className="rounded-xl bg-black/[0.04] p-2.5 dark:bg-white/[0.06]">
            <p className="mb-2 px-1 text-xs font-semibold text-gray-600 dark:text-gray-300">{col.title}</p>
            <div className="flex flex-col gap-2">
              {col.cards.map((card) => (
                <div key={card.t} className="relative overflow-hidden rounded-lg bg-white p-2.5 text-xs shadow-sm dark:bg-gray-800">
                  {"color" in card && <span className={`absolute inset-y-0 left-0 w-1 ${card.color}`} />}
                  <p className="font-medium">{card.t}</p>
                  {"label" in card && card.label && <span className={`mt-1.5 inline-block rounded px-1.5 text-[10px] font-medium ${card.label[0]}`}>{card.label[1]}</span>}
                  {"progress" in card && card.progress !== undefined && (
                    <span className="mt-2 block h-1 rounded-full bg-gray-200 dark:bg-gray-700">
                      <span className={`block h-full rounded-full ${card.progress === 1 ? "bg-green-500" : "bg-accent-500"}`} style={{ width: `${card.progress * 100}%` }} />
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <Cursor name="Storm" color="#0071e3" className="left-[24%] top-[44%]" />
      <Cursor name="Thor" color="#ff9500" className="left-[60%] top-[72%]" />
    </div>
  );
}

function Cursor({ name, color, className }: { name: string; color: string; className: string }) {
  return (
    <span className={`absolute ${className} animate-[lk-drift_7s_ease-in-out_infinite]`}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill={color}>
        <path d="M1 1l5 14 2-6 6-2z" stroke="white" strokeWidth="1" />
      </svg>
      <span className="ml-3 rounded-full px-2 py-0.5 text-[10px] font-medium text-white shadow" style={{ backgroundColor: color }}>
        {name}
      </span>
    </span>
  );
}
