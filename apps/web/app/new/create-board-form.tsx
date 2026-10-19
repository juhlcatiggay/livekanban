"use client";

import { useLayoutEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_PERMISSIONS, LIMITS, MAX_IMPORT_BYTES, PASSWORD, PERMISSION_LABELS, type Permission, type Permissions } from "@livekanban/protocol";
import { createBoard } from "@/lib/create-board";
import { useTurnstile } from "@/lib/turnstile";

const PERMISSIONS = Object.keys(DEFAULT_PERMISSIONS) as Permission[];

/** What each host setting means, in plain words. */
const PERMISSION_HELP: Record<Permission, string> = {
  renameBoard: "Change the board's name.",
  editBulletin: "Add, edit, move and pin sticky notes.",
  editCards: "Create cards and columns, change their details, checklists and labels, and delete them.",
  moveCards: "Drag cards and columns around.",
};

/**
 * The create page: name the board, optionally protect it with a password,
 * and choose what people other than you (the host) may change. Everything
 * here can be changed later from Host settings on the board.
 */
export function CreateBoardForm() {
  const router = useRouter();
  const turnstile = useTurnstile();
  const [title, setTitle] = useState("");
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [permissions, setPermissions] = useState<Permissions>(DEFAULT_PERMISSIONS);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Next keeps this page alive (hidden) after we navigate to the new board;
  // coming back should show a fresh form, not "Creating…".
  useLayoutEffect(
    () => () => {
      setPending(false);
      setError(null);
    },
    [],
  );

  const passwordProblem = usePassword && password.length < PASSWORD.min ? `At least ${PASSWORD.min} characters.` : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (passwordProblem) return;
    setPending(true);
    setError(null);
    try {
      let imported: unknown;
      if (importFile) {
        if (importFile.size > MAX_IMPORT_BYTES) throw new Error("That file is too large to import.");
        try {
          imported = JSON.parse(await importFile.text());
        } catch {
          throw new Error("That file isn't valid JSON.");
        }
      }
      const id = await createBoard({
        title: title.trim() || undefined,
        password: usePassword ? password : undefined,
        permissions,
        import: imported,
        turnstileToken: turnstile.token ?? undefined,
      });
      router.push(`/b/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create a board.");
      setPending(false);
      turnstile.reset();
    }
  }

  const section = "rounded-2xl border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900";

  return (
    <form onSubmit={submit} className="flex w-full max-w-xl flex-col gap-5" aria-label="Create a board">
      <div>
        <p className="text-sm font-medium text-teal-700 dark:text-teal-400">New board</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Set up your board</h1>
        <p className="mt-2 text-stone-600 dark:text-stone-400">
          You&apos;ll be its <strong>host</strong>. No account needed: this browser keeps your host key. You can change all of this later in Host settings.
        </p>
      </div>

      <section className={section} aria-labelledby="name-heading">
        <h2 id="name-heading" className="font-semibold">
          1. Board name
        </h2>
        <label className="mt-3 flex flex-col gap-1 text-sm font-medium">
          Name
          <input
            autoFocus
            value={title}
            maxLength={LIMITS.title}
            placeholder="e.g. Website relaunch"
            onChange={(e) => setTitle(e.target.value)}
            className="rounded-lg border border-stone-300 bg-transparent px-3 py-2 text-base font-normal outline-none focus:border-teal-500 dark:border-stone-700"
          />
        </label>
        <p className="mt-1.5 text-xs text-stone-500">Leave it empty for “Untitled board”.</p>
      </section>

      <section className={section} aria-labelledby="password-heading">
        <h2 id="password-heading" className="font-semibold">
          2. Board password <span className="font-normal text-stone-500">(optional)</span>
        </h2>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
          Without one, anyone with the link can open the board. With one, they also need the password; you never do.
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={usePassword} onChange={(e) => setUsePassword(e.target.checked)} className="h-4 w-4 accent-teal-600" />
          Require a password to open this board
        </label>
        {usePassword && (
          <div className="mt-3 flex flex-col gap-1">
            <label htmlFor="board-password" className="text-sm font-medium">
              Password
            </label>
            <div className="flex gap-2">
              <input
                id="board-password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={password}
                maxLength={PASSWORD.max}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={!!passwordProblem && password.length > 0}
                aria-describedby="password-help"
                className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-transparent px-3 py-2 outline-none focus:border-teal-500 dark:border-stone-700"
              />
              <button type="button" onClick={() => setShowPassword((s) => !s)} className="rounded-lg border border-stone-300 px-3 text-sm dark:border-stone-700">
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            <p id="password-help" className="text-xs text-stone-500">
              At least {PASSWORD.min} characters. Share it separately from the link. It&apos;s stored only as a hash.
            </p>
          </div>
        )}
      </section>

      <section className={section} aria-labelledby="host-heading">
        <h2 id="host-heading" className="font-semibold">
          3. Host settings
        </h2>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">What can everyone else do? You can always do everything.</p>
        <fieldset className="mt-3 flex flex-col gap-2">
          <legend className="sr-only">Everyone else can</legend>
          {PERMISSIONS.map((p) => (
            <label key={p} className="flex items-start gap-3 rounded-lg border border-stone-200 p-3 hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-800/50">
              <input
                type="checkbox"
                checked={permissions[p]}
                onChange={(e) => setPermissions({ ...permissions, [p]: e.target.checked })}
                className="mt-0.5 h-4 w-4 accent-teal-600"
                aria-label={`Everyone else can ${PERMISSION_LABELS[p]}`}
              />
              <span>
                <span className="block text-sm font-medium first-letter:uppercase">{PERMISSION_LABELS[p]}</span>
                <span className="block text-xs text-stone-500">{PERMISSION_HELP[p]}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </section>

      <details className="text-sm">
        <summary className="cursor-pointer text-stone-600 dark:text-stone-400">Start from a JSON export instead of an empty board</summary>
        <label className="mt-2 flex flex-col gap-1">
          <span className="text-stone-500">Choose a file exported from LiveKanban (Export › JSON)</span>
          <input type="file" accept="application/json,.json" onChange={(e) => setImportFile(e.target.files?.[0] ?? null)} className="text-sm" />
        </label>
      </details>

      {turnstile.widget}
      {turnstile.problem && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {turnstile.problem}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending || !turnstile.ready || !!passwordProblem}
          className="rounded-lg bg-teal-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-teal-700 disabled:opacity-60"
        >
          {pending ? "Creating…" : turnstile.ready ? "Create board" : "Verifying you're human…"}
        </button>
        <p className="text-xs text-stone-500">Boards are deleted after 60 days without a visit or edit.</p>
      </div>
    </form>
  );
}
