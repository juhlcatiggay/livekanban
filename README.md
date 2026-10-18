# LiveKanban

Free, no-signup kanban boards with live cursors. See [CLAUDE.md](CLAUDE.md) for the full build plan.

## Layout

| Path | What |
| --- | --- |
| `apps/web` | Next.js 16 app (landing, board shell, expired page) |
| `apps/worker` | Cloudflare Worker + `BoardRoom` Durable Object (one per board) |
| `packages/protocol` | Message types shared by both sides |

## Develop

Requires Node 22+ and pnpm 10.

```sh
pnpm install
pnpm dev          # Next.js on http://localhost:3000 + Worker on http://localhost:8787
```

`pnpm dev:web` / `pnpm dev:worker` run either one alone.

Copy `apps/web/.env.example` to `apps/web/.env.local` to point the app at a different Worker host.

## Check

```sh
pnpm typecheck
pnpm lint
pnpm test               # Worker smoke test (boots the Worker locally)
pnpm --filter web e2e   # Playwright, two browser contexts on one board
```
