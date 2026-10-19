"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_PERMISSIONS, LIMITS, MAX_IMPORT_BYTES, PASSWORD, type Permission, type Permissions } from "@livekanban/protocol";
import { createBoard } from "@/lib/create-board";
import { useTurnstile } from "@/lib/turnstile";

const PERMISSIONS: { key: Permission; label: string; aria: string }[] = [
  { key: "editCards", label: "Edit cards and columns", aria: "Everyone else can add, edit and delete cards and columns" },
  { key: "moveCards", label: "Move cards and columns", aria: "Everyone else can move cards and columns" },
  { key: "editBulletin", label: "Edit the bulletin board", aria: "Everyone else can edit the bulletin board" },
  { key: "renameBoard", label: "Rename the board", aria: "Everyone else can rename the board" },
];

/**
 * The create page, kept to one screen: a name, an optional password, and
 * what everyone else may change, as an inset grouped list with switches.
 * Everything can be changed later in Host settings, so nothing here is a
 * commitment; importing a file is one level deeper.
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
  const passwordInput = useRef<HTMLInputElement>(null);

  // Next keeps this page alive (hidden) after we navigate to the new board;
  // coming back should show a fresh form, not "Creating…".
  useLayoutEffect(
    () => () => {
      setPending(false);
      setError(null);
    },
    [],
  );

  const passwordTooShort = usePassword && password.length < PASSWORD.min;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (passwordTooShort) return passwordInput.current?.focus();
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

  const caption = "px-4 pb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500";
  const row = "flex min-h-11 items-center gap-3 px-4 py-2 text-[15px]";

  return (
    <form onSubmit={submit} className="w-full max-w-[26rem]" aria-label="Create a board">
      <div className="mb-5 px-4">
        <h1 className="text-[28px] font-semibold">New Board</h1>
        <p className="mt-1 text-[15px] text-gray-500">You&apos;ll be the host. You can change all of this later.</p>
      </div>

      <div className="flex flex-col gap-5">
        <div className="group-list shadow-sm">
          <label className={row}>
            <span className="w-24 shrink-0">Name</span>
            <input
              autoFocus
              value={title}
              maxLength={LIMITS.title}
              placeholder="Untitled board"
              aria-label="Board name"
              onChange={(e) => setTitle(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-right outline-none placeholder:text-gray-400"
            />
          </label>
        </div>

        <section aria-labelledby="password-caption">
          <h2 id="password-caption" className={caption}>
            Privacy
          </h2>
          <div className="group-list shadow-sm">
            <label className={row}>
              <span className="flex-1">Require a password</span>
              <input
                type="checkbox"
                role="switch"
                className="switch"
                checked={usePassword}
                aria-label="Require a password to open this board"
                onChange={(e) => {
                  setUsePassword(e.target.checked);
                  if (e.target.checked) requestAnimationFrame(() => passwordInput.current?.focus());
                }}
              />
            </label>
            {usePassword && (
              <div className={row}>
                <label htmlFor="board-password" className="w-24 shrink-0">
                  Password
                </label>
                <input
                  ref={passwordInput}
                  id="board-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={password}
                  maxLength={PASSWORD.max}
                  placeholder={`${PASSWORD.min}+ characters`}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={passwordTooShort && password.length > 0}
                  className="min-w-0 flex-1 bg-transparent text-right outline-none placeholder:text-gray-400"
                />
                <button type="button" onClick={() => setShowPassword((s) => !s)} className="text-[15px] text-accent-600 dark:text-accent-400">
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            )}
          </div>
          <p className={`px-4 pt-1.5 text-xs ${passwordTooShort && password ? "text-red-600 dark:text-red-400" : "text-gray-500"}`}>
            {!usePassword
              ? "Anyone with the link can open the board."
              : passwordTooShort && password
                ? `At least ${PASSWORD.min} characters.`
                : "Share it separately from the link. It's stored only as a hash."}
          </p>
        </section>

        <section aria-labelledby="host-caption">
          <h2 id="host-caption" className={caption}>
            Everyone else can
          </h2>
          <div className="group-list shadow-sm">
            {PERMISSIONS.map((p) => (
              <label key={p.key} className={row}>
                <span className="flex-1">{p.label}</span>
                <input
                  type="checkbox"
                  role="switch"
                  className="switch"
                  checked={permissions[p.key]}
                  aria-label={p.aria}
                  onChange={(e) => setPermissions({ ...permissions, [p.key]: e.target.checked })}
                />
              </label>
            ))}
          </div>
        </section>
      </div>

      {turnstile.widget}
      {(error || turnstile.problem) && (
        <p role="alert" className="mt-4 px-4 text-sm text-red-600 dark:text-red-400">
          {error ?? turnstile.problem}
        </p>
      )}

      <div className="mt-6 flex items-center justify-between gap-3 px-4">
        <label className="min-w-0 cursor-pointer truncate text-[15px] text-accent-600 hover:underline dark:text-accent-400">
          {importFile ? `From ${importFile.name}` : "Import from file…"}
          <input
            type="file"
            accept="application/json,.json"
            aria-label="Import a JSON export"
            className="sr-only"
            onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <button
          type="submit"
          disabled={pending || !turnstile.ready || passwordTooShort}
          className="shrink-0 rounded-full bg-accent-600 px-5 py-2 text-[15px] font-medium text-white hover:bg-accent-700 disabled:opacity-50"
        >
          {pending ? "Creating…" : turnstile.ready ? "Create board" : "Verifying…"}
        </button>
      </div>
    </form>
  );
}
