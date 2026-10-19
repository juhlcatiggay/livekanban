import Link from "next/link";
import { CreateBoardButton } from "./create-board-button";
import { MyBoards } from "./recent-boards";

const FEATURES = [
  { icon: "🖱️", title: "Live cursors", body: "See everyone's pointer, who's dragging which card, and who's typing where, as it happens." },
  { icon: "🔗", title: "No signup", body: "Create a board and share the link. Nobody needs an account, an email or a password manager." },
  { icon: "🗂️", title: "Kanban, bulletin and calendar", body: "Cards in columns, a sticky-note wall for announcements, and a month view of what's due." },
  { icon: "☑️", title: "Real cards", body: "Checklists with progress, color-coded labels, assignees, start and due dates, and full Markdown." },
  { icon: "🛡️", title: "Host controls", body: "Add a password, make parts view-only for others, and delete the board whenever you want." },
  { icon: "⏳", title: "Tidy by default", body: "Every change is in the history, deletes go to a trash, and unused boards disappear after 60 days." },
];

const STEPS = [
  { title: "Create a board", body: "Give it a name, and a password if you want one. You're the host." },
  { title: "Share the link", body: "Send it to your team. They pick it up instantly, with their own name and cursor." },
  { title: "Plan together", body: "Drag cards, tick checklists and mention each other's cards. Everyone sees it live." },
];

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col bg-stone-50 dark:bg-stone-950">
      <header className="sticky top-0 z-30 border-b border-stone-200/70 bg-stone-50/80 backdrop-blur dark:border-stone-800/70 dark:bg-stone-950/80">
        <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3" aria-label="Main">
          <Link href="/" className="text-lg font-bold tracking-tight">
            Live<span className="text-teal-600">Kanban</span>
          </Link>
          <div className="flex items-center gap-5 text-sm">
            <a href="#features" className="hidden text-stone-600 hover:text-stone-900 sm:inline dark:text-stone-400 dark:hover:text-white">
              Features
            </a>
            <a href="#my-boards" className="text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white">
              My boards
            </a>
            <CreateBoardButton label="Create board" className="!px-4 !py-2 !text-sm" />
          </div>
        </nav>
      </header>

      <main className="flex-1">
        <section className="mx-auto grid max-w-5xl items-center gap-12 px-4 pb-16 pt-14 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-800 dark:bg-teal-950 dark:text-teal-200">
              <span className="h-1.5 w-1.5 rounded-full bg-teal-500" /> Free · no account · real time
            </p>
            <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
              Plan together,
              <br />
              <span className="text-teal-600">live.</span>
            </h1>
            <p className="mt-4 max-w-md text-lg text-stone-600 dark:text-stone-400">
              A kanban board you share with a link. Everyone sees each other&apos;s cursors, drags and edits the moment they happen.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <CreateBoardButton />
              <a href="#how" className="text-sm font-medium text-stone-700 hover:underline dark:text-stone-300">
                How it works ↓
              </a>
            </div>
          </div>
          <BoardPreview />
        </section>

        <section id="features" aria-labelledby="features-heading" className="scroll-mt-20 border-y border-stone-200 bg-white py-16 dark:border-stone-800 dark:bg-stone-900/40">
          <div className="mx-auto max-w-5xl px-4">
            <h2 id="features-heading" className="text-2xl font-bold tracking-tight">
              Everything a small team needs, nothing to sign up for
            </h2>
            <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <li key={f.title} className="rounded-xl border border-stone-200 p-5 dark:border-stone-800">
                  <p aria-hidden className="text-2xl">
                    {f.icon}
                  </p>
                  <h3 className="mt-2 font-semibold">{f.title}</h3>
                  <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">{f.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="how" aria-labelledby="how-heading" className="mx-auto max-w-5xl scroll-mt-20 px-4 py-16">
          <h2 id="how-heading" className="text-2xl font-bold tracking-tight">
            How it works
          </h2>
          <ol className="mt-8 grid gap-6 sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-600 font-semibold text-white">{i + 1}</span>
                <span>
                  <span className="block font-semibold">{s.title}</span>
                  <span className="mt-1 block text-sm text-stone-600 dark:text-stone-400">{s.body}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <div className="border-t border-stone-200 dark:border-stone-800">
          <MyBoards />
        </div>
      </main>

      <footer className="border-t border-stone-200 px-4 py-6 text-center text-xs text-stone-500 dark:border-stone-800">
        Anyone with a board&apos;s link can open it, unless its host sets a password. Boards are deleted after 60 days without a visit or edit.
      </footer>
    </div>
  );
}

/** A static picture of a live board for the hero: three columns, a few cards, two named cursors. Decorative. */
function BoardPreview() {
  const columns = [
    { title: "To do", cards: [{ t: "Plan launch email", label: ["bg-pink-100 text-pink-800", "marketing"] }, { t: "Pick a domain" }] },
    { title: "Doing", cards: [{ t: "Landing page", label: ["bg-blue-100 text-blue-800", "design"], progress: 0.6 }, { t: "Fix sign-in", color: "bg-red-500" }] },
    { title: "Done", cards: [{ t: "Brand colors", progress: 1 }] },
  ];
  return (
    <div aria-hidden className="relative select-none rounded-2xl border border-stone-200 bg-white p-4 shadow-xl dark:border-stone-800 dark:bg-stone-900">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold">Website relaunch</span>
        <span className="flex -space-x-2">
          {["bg-teal-600", "bg-amber-600", "bg-indigo-600"].map((c, i) => (
            <span key={c} className={`h-6 w-6 rounded-full border-2 border-white text-center text-[10px] font-bold leading-5 text-white dark:border-stone-900 ${c}`}>
              {["SW", "TH", "IM"][i]}
            </span>
          ))}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {columns.map((col) => (
          <div key={col.title} className="rounded-lg bg-stone-100 p-2 dark:bg-stone-800/60">
            <p className="mb-2 text-xs font-semibold text-stone-600 dark:text-stone-300">{col.title}</p>
            <div className="flex flex-col gap-2">
              {col.cards.map((card) => (
                <div key={card.t} className="relative overflow-hidden rounded-md border border-stone-200 bg-white p-2 text-xs shadow-sm dark:border-stone-700 dark:bg-stone-900">
                  {"color" in card && <span className={`absolute inset-y-0 left-0 w-1 ${card.color}`} />}
                  <p className="font-medium">{card.t}</p>
                  {"label" in card && card.label && <span className={`mt-1 inline-block rounded px-1 text-[10px] ${card.label[0]}`}>{card.label[1]}</span>}
                  {"progress" in card && card.progress !== undefined && (
                    <span className="mt-1.5 block h-1 rounded-full bg-stone-200 dark:bg-stone-700">
                      <span className={`block h-full rounded-full ${card.progress === 1 ? "bg-green-500" : "bg-teal-500"}`} style={{ width: `${card.progress * 100}%` }} />
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <Cursor name="Storm" color="#0d9488" className="left-[22%] top-[46%]" />
      <Cursor name="Thor" color="#d97706" className="left-[62%] top-[70%]" />
    </div>
  );
}

function Cursor({ name, color, className }: { name: string; color: string; className: string }) {
  return (
    <span className={`absolute ${className} animate-[lk-drift_6s_ease-in-out_infinite]`}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill={color}>
        <path d="M1 1l5 14 2-6 6-2z" stroke="white" strokeWidth="1" />
      </svg>
      <span className="ml-3 rounded px-1.5 py-0.5 text-[10px] font-medium text-white shadow" style={{ backgroundColor: color }}>
        {name}
      </span>
    </span>
  );
}
