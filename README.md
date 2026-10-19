# LiveKanban

Free, no-signup kanban boards with live cursors. Create a board, share the link, and everyone sees each other's cursors, drags and edits as they happen.

> **Portfolio repository.** This is a snapshot of the project, published to show how it's built. The hosted product continues in a private repository. See [LICENSE](LICENSE): viewing only, all rights reserved.

## What it does

- **Real-time collaboration:** live cursors that land on the same card on any screen size, drag ghosts, "is editing" badges, and presence, with about 100 ms end-to-end latency on the same continent.
- **Kanban, bulletin and calendar views:** cards with Markdown, checklists and progress, color-coded labels, several assignees, start and due dates, and `@` mentions that jump to the card or note.
- **No accounts:** the link is the key. Hosts can add a password, make parts of the board view-only, or delete it. Names are unique per board and remembered.
- **Safe by default:** undo and redo, a 7-day trash, daily backups, a full change history, rate limits, Turnstile on board creation, and automatic deletion after 60 idle days.
- **Apple-style interface:** system font, translucent materials, segmented controls, sheets and springs; Light, Dark and System appearance; reduced-motion and reduced-transparency support.

## How it's built

| Path | What |
| --- | --- |
| `apps/web` | Next.js 16 (App Router, React 19, Tailwind 4, Zustand, dnd-kit, PartySocket) |
| `apps/worker` | Cloudflare Worker with one `BoardRoom` Durable Object per board (PartyServer, SQLite, alarms) |
| `packages/protocol` | Message and operation types, validation and the board reducer, shared by both sides |

Each board is a single Durable Object that holds its WebSocket connections, its data in SQLite and its expiry alarm. Every edit is serialized in one place, presence never leaves that object, and deleting a board is deleting one object. [CLAUDE.md](CLAUDE.md) has the full design: the realtime protocol, anchor-relative cursors, the data model, security and expiry.

## Run it locally

Requires Node 22+ and pnpm 10.

```sh
pnpm install
pnpm dev          # Next.js on http://localhost:3000 + Worker on http://localhost:8787
```

## Tests

```sh
pnpm typecheck
pnpm lint
pnpm test                               # Worker smoke tests (boots the Worker locally)
pnpm --filter worker test:hardening     # expiry, trash, backups, rate limits, import
pnpm --filter web e2e                   # Playwright, several browsers on one board
```

CI runs all of these on every push.
