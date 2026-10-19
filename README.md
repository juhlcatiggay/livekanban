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

## Configuration

Worker vars (`apps/worker/wrangler.jsonc`) take durations like `60d`, `2m` or `30s`:

| Var | Default | Purpose |
| --- | --- | --- |
| `EXPIRY` | `60d` | Inactivity before a board is deleted. Use `2m` in staging to test the full flow. |
| `TRASH_RETENTION` | `7d` | How long deleted items can be restored. |
| `BACKUP_EVERY` | `1d` | Backup interval for boards with recent activity (7 kept). |
| `CREATE_LIMIT_PER_HOUR` | `20` | New boards per IP per hour (`pnpm dev` raises it to 1000). |

Optional Worker secrets (`wrangler secret put`): `TURNSTILE_SECRET` (pair with the web app's `NEXT_PUBLIC_TURNSTILE_SITE_KEY`) and `ADMIN_TOKEN` (enables takedowns). Optional web env: `NEXT_PUBLIC_ABUSE_EMAIL` shows "Report this board".

## Deploy

The Worker deploys to Cloudflare; the web app deploys to Vercel. Staging and production are separate Workers with separate storage (`wrangler.jsonc` → `env`).

**One-time setup**

1. Cloudflare: `pnpm --filter worker exec wrangler login`, then deploy staging once by hand: `pnpm --filter worker exec wrangler deploy --env staging`. Note the `livekanban-staging.<you>.workers.dev` host it prints.
2. Secrets per environment: `pnpm --filter worker exec wrangler secret put TURNSTILE_SECRET --env staging` (and `ADMIN_TOKEN`; repeat with `--env production`).
3. Vercel: import the repo with **Root Directory** `apps/web`. Set `NEXT_PUBLIC_PARTY_HOST` (the Worker host, no `https://`) and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` for Preview (staging Worker) and Production (production Worker). Add both domains to the Turnstile widget's hostnames.
4. Put the real origins in `ALLOWED_ORIGINS` for each environment in `wrangler.jsonc` (staging already allows `https://livekanban-*.vercel.app`).
5. CI deploys: in GitHub → Settings → Secrets and variables → Actions, add secrets `CLOUDFLARE_API_TOKEN` ("Edit Cloudflare Workers" template), `CLOUDFLARE_ACCOUNT_ID` and optionally `ADMIN_TOKEN_STAGING`, and the variable `STAGING_WORKER_HOST`. Then staging deploys after every green CI run on `main`, followed by the latency check; production deploys from Actions → Deploy Worker → Run workflow.

**Before launch:** run the load test against staging (`ADMIN_TOKEN=… pnpm --filter worker load --host <staging-host>`), and set a budget alert in Cloudflare (Manage Account → Billing → Notifications).

Take a board down:

```sh
ADMIN_TOKEN=... pnpm --filter worker admin:delete --host <worker-host> --board <board-id>
```

## Check

```sh
pnpm typecheck
pnpm lint
pnpm test               # Worker smoke test (boots the Worker locally)
pnpm --filter worker test:hardening                # expiry, trash, backups, rate limits, import (EXPIRY=4s)
pnpm --filter worker latency                       # cursor relay p50/p95 against a local Worker
pnpm --filter worker latency --host <worker>       # ...or against a deployed one (fails if p95 > 100 ms)
pnpm --filter worker load                          # 50 clients on one board + 1,000 boards × 2 (see CLAUDE.md "Testing")
pnpm --filter web e2e   # Playwright, two browser contexts on one board
```
