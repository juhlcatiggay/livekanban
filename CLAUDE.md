# LiveKanban — Build Plan

Oct 18, 2026 · @Juhl Mayne Lina Catiggay

## Overview

LiveKanban is a free, no-signup kanban board on Next.js where everyone on a board sees each other's live cursors, drags and edits, with boards auto-deleted after 60 days of inactivity. Realtime runs on one Cloudflare Durable Object per board (decided; Liveblocks rejected on cost) so presence and sync ship in weeks instead of building a socket server first.

**Goals**

- Create a board in one click and share it by link; no account, email or password.
- Live presence: named cursors, "who is dragging what", ghost cards following the dragger, and "X is editing" badges.
- Cursor latency low enough to feel local: target under 100 ms end to end on the same continent.
- Kanban (columns + cards) plus a bulletin board for free-form notes.
- Inactive boards expire after 60 days, automatically.

**Non-goals for v1**

- User accounts, teams or billing. (Permissions beyond "has the link" were added after v1 planning as host privileges, see "Access".)
- Offline editing, mobile apps, integrations (Slack, GitHub), file attachments.

**Decided:** "bulletin board" is a free-form canvas of sticky notes beside the kanban on each board. Pinning a note shows it as an announcement banner on the kanban tab, which covers the "announcements strip" use case too.

## Feature spec

Five feature areas, each with a clear "done" bar; realtime presence is the hard one and gets its own design section below.

**1. No-signup boards**

- Landing page (hero with a live-board illustration, features, how it works, My boards) whose "Create a board" leads to the create page `/new`: board name, an optional password, and host settings (what everyone else may change), plus an optional JSON export to start from. Creating mints an unguessable board ID and redirects to `/b/<id>`; everything chosen there can be changed later in Host settings.
- Sharing = copying the URL. Anyone with the link can view and edit.
- Each board gives every visitor a Marvel character name (e.g. "Storm") and color that nobody else on that board has, and remembers it in a `members` table so reopening the board brings back the same name. A random client ID in localStorage identifies the browser. Names are editable from the avatar menu; a name someone else on the board already has is refused, and a chosen name is asked for on boards the browser joins later.
- "My boards" on the landing page: cards for every board this browser opened (last 50), split into "My own boards" (this browser holds the host key) and "Others' boards" (opened from a shared link). Each card shows when it was opened, "Kept until" or "Expired", and a lock if the board has a password, from the Worker's public status endpoint. Read from localStorage only (no server account).

**2. Kanban**

- Columns: add, rename, reorder by drag, delete (with undo), optional WIP limit.
- Cards: title, description (markdown), color (a strip along the left edge), labels, up to 10 assignees (free-text names, suggested from people on the board), start date, due date, and a checklist (up to 100 items) whose progress bar shows on the card.
- Labels are chips: a comma or Enter turns typed text into one, and the board's spelling of a known label is reused. Every label has one color across the board: picked by someone (`label.color` op, stored per board) or derived from its text, so the same label always looks the same.
- Every card and note gets a board-wide number (`#12`) from one counter the room controls. Typing `@` in a description or note opens a list of cards and notes (filtered by number or title); picking one inserts the link `[@12](#12)`. Only picked items are mentions, so text such as "Top #1 Fan" or an email address stays plain (any link to `#12` counts, so older `[#12](#12)` mentions still work). Clicking a mention jumps to the item (switching tabs if needed), shakes it for a second, then opens it.
- Descriptions and notes show as rendered markdown (GitHub-flavored: headings, tables, task lists, code with highlighting) with an Edit button. Editing has a formatting toolbar (bold, italic, strikethrough, heading, lists, checklist, quote, code, link, image, table, mention) and Ctrl+B / Ctrl+I / Ctrl+K, so nobody needs to know markdown.
- Images are added by link (the toolbar's Image button asks for the address); there are no uploads. An image loads after a click, or automatically from sites the viewer chose "Always load from" (kept in their browser). The first such image is the card's cover on the kanban.
- Deleting a card, column or note asks "Are you sure?" first (and can still be undone or restored from the trash).
- Drag cards within and across columns; keyboard drag for accessibility.
- Select several cards by drawing a box from empty board space, or with Ctrl/Shift+click; Escape clears. Dragging any selected card moves them all to the drop point, in board order, as one undo step. A selection bar offers "Move to column" (the keyboard-friendly path) and Delete.
- Undo/redo for your own last 20 actions; a board-level trash for 7 days so a careless visitor can't wipe a board permanently.
- Export board as JSON or Markdown.
- Search and filters above the kanban and the calendar: every word must appear in a card's title, description, labels, assignees or checklist (or be its number, `12` or `#12`); filters by label, assignee and due date (overdue, next 7 days, none). "/" focuses the search box. Non-matching cards are hidden; drags still use the full order.
- History: a panel of every change, newest first, grouped by day and updating live ("Storm moved “Fix login” from To do to Doing · 5 minutes ago"), and an Activity list in each card. Rapid repeats (typing) collapse into one line. The room records what each op changed when it commits (`ops_log.detail`), so lines keep old titles and columns.

**3. Realtime presence**

- Live cursors: an arrow pointer in each person's color with their name tag, positioned where they are pointing on the board.
- Off-screen indicators: when someone's cursor is outside your viewport, an arrow at the screen edge points toward them; click to jump there.
- Drag visibility: when someone picks up a card, everyone sees it lift and follow that person's cursor, with a "Teal Otter is moving" tag and a placeholder in its original slot.
- Edit visibility: a colored outline and "Teal Otter is editing" badge on any card or column being edited; typing shows live.
- Presence bar: avatars of everyone on the board, idle state after 60 s without input, gone when the tab closes.
- Accuracy target: remote cursor shows within 100 ms of the real movement and on the same card or column, regardless of screen size or scroll.

**4. Bulletin board**

- A second tab on every board: a free-form canvas of sticky notes for announcements, links and loose ideas.
- Notes: text, color, size; drag anywhere, with the same live cursors and drag visibility as the kanban.
- Pin a note to the top as an announcement banner shown on the kanban tab.
- Convert a note to a card (choose a column). Cards are not moved to the bulletin; mention a note with `#n` instead.
- Two layouts, chosen per viewer and remembered: sticky notes on the canvas, or a card stack with the newest note on top, each showing its number, when it was created and when and by whom it was last edited.

**5. Expiry**

- A board with no visits and no edits for 60 days is permanently deleted.
- Board footer always shows "Kept until \<date>", which moves forward on activity.
- Expired board URLs show a friendly "This board expired" page with a button to create a new one.
- The host can delete the board early from Host settings. The dialog offers a JSON download first and needs the board's name typed to confirm. Everyone connected sees "This board was deleted", and the link behaves like an expired board from then on.

## Architecture & tech stack

Recommendation: Next.js 16 for the app, plus one Cloudflare Durable Object per board that holds the WebSocket connections, the board data (in its built-in SQLite) and the expiry timer. One object per board means every edit for a board is serialized in one place, presence never leaves that object, and deleting a board is deleting one object.

**System architecture (4 components)**

- **Browser (each visitor):** board UI in React + dnd-kit + Zustand; cursor overlay on a rAF loop; PartySocket for reconnect and buffering.
- **Vercel · Next.js 16:** landing page, board shell, expired page. No sockets; serves HTML and JS only (HTTPS).
- **Cloudflare Worker:** routes each board ID to its room over WebSocket; Turnstile and creation rate limit.
- **BoardRoom (one Durable Object per board ID):** presence and locks in memory; SQLite for columns, cards, notes, ops; alarm deletes the board after 60 idle days.

Pages come from Vercel; every live message goes browser → Worker → that board's room and back, never through Next.js.

**Why not run sockets inside Next.js?** Vercel added native WebSockets in public beta in June 2026, but a connection is pinned to one function instance and later connections may land elsewhere, so a shared room still needs Redis pub/sub on top ([Vercel KB](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections)). That is a worse version of what a Durable Object gives you for free.

**Why not Liveblocks?** It is the fastest way to a demo, but its free plan caps rooms at 10 simultaneous connections, 500 monthly active rooms and 3,000 anonymous connections a month, and paid usage is metered at $0.002 per collaboration minute ([free plan](https://liveblocks.io/docs/pricing/plans/free), [pricing](https://liveblocks.io/docs/pricing/overview)). A free, no-signup app has no revenue to absorb that, and you would be locked to its data model.

| Option | Fit for this app | Cost at small scale | Lock-in | Effort |
| --- | --- | --- | --- | --- |
| Cloudflare Durable Objects + [PartyServer](https://github.com/cloudflare/partykit) (recommended) | Room-per-board model, SQLite per board, alarms for expiry | $5/mo Workers Paid minimum; incoming WebSocket messages billed 20:1 ([pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)) | Medium (Cloudflare runtime) | Medium |
| Liveblocks | Presence + storage out of the box | Free tier too small for anonymous public use | High | Low |
| Supabase Realtime + Postgres | Good presence/broadcast; ordering and expiry are DIY | Free tier, then plan-based | Medium | Medium |
| Self-hosted Node + Socket.IO + Redis + Postgres | Full control | One VPS from about $5–10/mo | None | High (scaling, sticky sessions, ops) |

**Stack**

- **App:** Next.js 16 App Router, TypeScript, Tailwind. Server components for the landing and expired pages; the board itself is a client component.
- **Design:** Apple's interface principles (see the `apple-design` skill): the system font with size-specific tracking, Apple's neutral grays (`gray-*`) and system blue (`accent-*`) defined once in `app/globals.css`, translucent materials for floating chrome, segmented controls, inset grouped lists with switches, sheets for dialogs, menus that grow from their trigger, press feedback, and fallbacks for reduced motion, reduced transparency and increased contrast. Shared control styles live in `lib/ui.ts`.
- **Drag and drop:** dnd-kit (pointer + keyboard sensors). Remote ghosts are rendered by our own overlay, not by dnd-kit.
- **Realtime client:** PartySocket (auto-reconnect, buffering) wrapped in a small `useBoard()` store built on Zustand.
- **Realtime server:** a Worker with a `BoardRoom` class extending PartyServer's `Server`, using the WebSocket Hibernation API so idle boards cost nothing.
- **Storage:** Durable Object SQLite (one database per board). No central database is needed for v1.
- **Ordering:** fractional-index strings for column and card positions.
- **Hosting:** Next.js on Vercel, Worker on Cloudflare. To keep everything on one provider later, deploy Next.js to Cloudflare with the OpenNext adapter.
- **Abuse:** Cloudflare Turnstile on board creation; per-connection rate limits inside the room.

## Realtime design

Split traffic into two streams that never mix: **presence** (cursors, drags, "editing" flags) is broadcast and forgotten, and **operations** (create, move, edit, delete) are validated, written to SQLite and then broadcast. Presence is about 95% of messages, so keeping it off the storage path is what keeps latency low and costs near zero.

**Cursor accuracy: anchor-relative coordinates**

Raw `clientX/Y` pixels are wrong on any other screen: columns reflow, people scroll, zoom differs. Instead, each cursor update names what it is over and where inside it:

- `anchor`: the ID of the card, column or note under the pointer (via `document.elementFromPoint` and a `data-anchor` attribute), or `board` when over empty space.
- `fx, fy`: the position inside that element as fractions 0–1 of its bounding box.
- The receiver looks up the same element and converts back to its own pixels. Result: if I point at the top-left of card 12, you see my arrow at the top-left of card 12, even if your card 12 is in a different place on your screen.
- On the bulletin canvas, use canvas coordinates (note positions are absolute there), transformed by each viewer's pan and zoom.

**Cursor pipeline**

1. Sender samples `pointermove`, coalesces to one update per animation frame, and sends at most 30 per second, only when the position changed.
2. Messages are tiny arrays, e.g. `["c", anchor, fx, fy]`, about 40 bytes. The room keeps the latest position per person and sends everyone a single batch (immediately if nothing went out in the last 16 ms, otherwise at the end of that tick) `["C", [[connectionId, anchor, fx, fy], …]]` (clients skip their own entry). Relaying each cursor to each viewer grows with the square of the room size: 50 people at 30/s would be ~73,500 outgoing messages/s, and the local load test collapsed to 10% delivery at that rate. Batched, it's ~1,500/s with 99% of positions delivered and p95 39 ms locally; a superseded position within one tick is simply skipped.
3. Receivers buffer about 2 frames and interpolate (spline or lerp) between samples, so 30 Hz input renders smoothly at 60–120 Hz. Tune the buffer: smaller = more current, larger = smoother.
4. Cursors are drawn in one absolutely positioned overlay layer with CSS `transform` only (no React re-render per move), updated from a `requestAnimationFrame` loop.
5. Off-screen cursors: if the converted point falls outside the viewport, clamp it to the edge and render a directional arrow with the name.
6. Idle: stop sending after 10 s without movement; hide a cursor whose owner's tab is hidden (`visibilitychange`).

Latency budget for the 100 ms target: sampling and send ≤ 16 ms, network to the room and back 30–60 ms on one continent (the object is created near its first visitor), batching ≤ 16 ms (8 ms on average), interpolation buffer 33–40 ms. Show measured round-trip time in a debug overlay from day one.

**Measured on staging (Oct 2026), from the Philippines (Cloudflare edge MNL):** raw room round trip p50 89 ms / p95 104–116 ms; cursor latency p50 80–92 ms / p95 105–109 ms, i.e. the app adds almost nothing on top of the network. The miss against 100 ms is distance: the nearest Durable Object locations are further from Manila than the 30–60 ms this budget assumes. Re-check from a data-center runner (`.github/workflows/load.yml`) for the in-region number.

**Cross-region boards.** Each board has one room for its whole life, created near whoever created the board, and every viewer connects to it, so a cursor travels A → room → B and costs about half of each person's round trip to the room. Rough figures (typical internet round trips, not measured): a PH-created board is ~95–110 ms between PH and Australia and ~130–150 ms between PH and the US West Coast; a US-created board is ~20–50 ms within the US, ~130–150 ms to PH, and ~160–180 ms between two PH users, whose cursors cross the Pacific twice. Across continents no design gets under 100 ms (Manila–US West is ~60–80 ms each way in fiber alone), so the 100 ms target applies to people near the same room. Moving rooms toward their users or relaying cursors regionally is out of scope for v1; card edits at these latencies still feel instant, and the footer shows each person's measured round trip.

**Drags**

- `dragStart`: the client asks the room for a soft lock on the card. The first request wins; a second person sees "held by Teal Otter" and cannot pick it up.
- While dragging, the cursor message carries the held card ID, so receivers render a lifted ghost of that card under that person's arrow plus a placeholder in its original slot.
- `drop`: the client sends a `move` operation with the new column and position; the room commits, releases the lock and broadcasts. Disconnect or 15 s without movement also releases the lock.

**Edits and conflicts**

- The room is single-threaded, so it is the source of truth: it applies operations in arrival order and assigns each a sequence number.
- Clients apply their own operations optimistically, tagged with a client op ID; on the server's echo they confirm, and on rejection they roll back.
- Ordering uses fractional indexes: moving a card writes one new position string between its neighbours, so two people moving different cards never conflict.
- Checklists change through their own ops (`checklist.add`, `checklist.update`, `checklist.delete`, by item ID), so two people ticking different items never overwrite each other.
- Text fields: an "editing" presence flag shows who is in a field; saves are last-writer-wins per field, debounced to every 300 ms while typing. If you later want true simultaneous typing in descriptions, add Yjs for that field only (Y-PartyServer supports it).
- Reconnect: the client sends its last seen sequence number; the room replays missed operations or sends a full snapshot if too far behind.

**Message types**

| Type | Direction | Stream | Payload | Rate |
| --- | --- | --- | --- | --- |
| `hello` | client → room | presence | client ID, name, color, last seq, optional host key | on connect |
| `welcome` | room → client | both | `you` (your own peer, incl. `host`), presence list + `sync`: full snapshot, or a replay of missed ops when the log still covers `lastSeq` | on connect / resync |
| `cursor` | client → room | presence | bare array `["c", anchor, fx, fy]`. The held card comes from the peer's `holding`, not the cursor | ≤ 30/s per person |
| `cursors` | room → all | presence | `["C", [[connectionId, anchor, fx, fy], …]]`: latest position of everyone who moved this tick | ≤ 60/s per viewer |
| `presence` | client → room | presence | `editing` target ID or null, `idle`, `away` | on change |
| `profile` | client → room | presence | name, color | on change |
| `profileRejected` | room → client | presence | reason (name taken on this board) | on refused rename |
| `deleteBoard` | client → room | — | (host only) delete the board for everyone | on request |
| `deleted` | room → client | — | host's name, then the socket closes as expired | on delete |
| `refused` | room → client | — | reason a host-only request was refused | on refusal |
| `setPassword` | client → room | — | (host only) new password, or null to remove it | on request |
| `passwordRequired` | room → client | — | `wrong`, optional `retryAfterMs`; the client sends `hello` again with `password` | on hello to a locked board |
| `locked` | room → all | — | whether the board now has a password | on change |
| `history` | both | ops | request: `before` seq, optional card/note `id`; reply: 50 committed ops (with `detail`), newest first, `more` | on request |
| `peer` | room → all | presence | the updated peer (editing, holding, idle, away, name, color), also sent to that peer | on change |
| `lock` / `unlock` | client → room | presence | card ID; a granted lock arrives as `peer.holding` | on drag start/end |
| `lockDenied` | room → client | presence | card ID, holder's name | on contention |
| `op` | client → room | ops | client op ID, kind, data | on each change |
| `ack` / `reject` | room → client | ops | client op ID + canonical committed op (positions may be adjusted), or a reason | per op |
| `opb` | room → others | ops | seq, op, actor, time | per committed op |
| `leave` | room → client | presence | connection ID | on disconnect |

## Data model

Each board's data lives in its own Durable Object SQLite database, so tables have no `board_id` column and a board is deleted with one `deleteAll()`. Presence (cursors, locks, editing flags) is kept in memory and in each socket's attachment, never in SQLite.

| Table | Key columns | Notes |
| --- | --- | --- |
| `meta` | `key`, `value` | board title, created\_at, last\_activity\_at, schema\_version, pinned\_note\_id, host\_key, permissions (JSON), next\_number, label\_colors (JSON), password (hash, JSON) |
| `columns` | `id`, `title`, `position`, `color`, `wip_limit`, `deleted_at` | `position` = fractional index string |
| `cards` | `id`, `column_id`, `position`, `title`, `description`, `color`, `labels` (JSON), `assignees` (JSON), `number`, `start_date`, `due_date`, `checklist` (JSON), `updated_at`, `updated_by`, `deleted_at` | soft delete feeds the 7-day trash |
| `notes` | `id`, `number`, `x`, `y`, `w`, `h`, `z`, `color`, `text`, `created_at`, `updated_at`, `updated_by`, `deleted_at` | bulletin canvas (4000 × 3000 canvas px); absolute canvas coordinates; the room assigns `z` so a moved or new note goes on top |
| `ops_log` | `seq`, `op` (JSON), `actor_name`, `at`, `detail` (JSON) | last 2,000 ops for reconnect replay and history; `detail` (schema v9) holds the titles and columns an op touched, read before it applied |
| `members` | `client_id`, `name`, `color`, `joined_at` | everyone who has opened the board; names unique per board (case-insensitive). Client IDs never leave the room |
| `backups` | `day`, `at`, `board` (JSON) | one per UTC day with activity, 7 kept; boards over ~1.9 MB of JSON skip backups (SQLite's 2 MB value limit) |

**Limits per board** (enforced in the room): 50 columns, 2,000 cards, 500 notes, 200 characters per title, 10,000 per description or note, notes 120–640 px per side, 50 concurrent connections. These keep every board well under the 10 MB-class sizes where snapshots get slow.

**IDs:** 21-character nanoid for the board (about 126 bits, unguessable), short nanoids for columns, cards and notes, generated on the client so optimistic inserts don't wait for the server.

## Anonymous access & security

The board URL is the only credential, so it must be unguessable and the room must defend itself against anyone who has it.

**Access**

- v1: one link, full edit access. Board IDs are 21-character nanoids; never sequential, never listed, `noindex` on board pages.
- Host (issue #12): creating a board returns a 32-character host key that the creator's browser keeps (localStorage, per board); the room stores it in its own `meta` and compares it in constant time when `hello` presents it. The host can make four things view-only for everyone else: renaming the board, the bulletin board, card and column contents, and moving cards and columns (`board.permissions` op; all allowed by default). `requiredPermissions()` in the protocol maps every op to what it needs, and both the room (enforcement) and the UI (hiding controls) use it. "Copy host link" (`/b/<id>#host=<key>`) makes another device a host; the fragment never reaches servers and is stripped on arrival. Boards created before hosts existed have no host and stay fully open. The key is stored in plain text rather than hashed because checking it must be synchronous: an async hello would let a following op be processed before the room knew who the host was.
- v1.1 (cheap to add): a separate read-only link. The room stores a hash of an edit secret; the edit link carries `#k=<secret>` in the URL fragment (never sent in HTTP logs), and the client presents it in `hello`. Viewers still see live cursors but cannot send ops.
- Optional board password, chosen on the create page or in Host settings. `meta.password` holds a salted PBKDF2-SHA256 hash (20,000 iterations, a few ms of CPU); the plain password never reaches storage or logs. Everyone except the host must send it in `hello`; until it checks out the connection has no state, so anything else it sends is ignored. 10 wrong guesses per minute per board pause guessing for everyone. Browsers remember a working password per board in localStorage and forget it when it's refused.

**Identity**

- Display name + color + a random client ID in localStorage; a fresh connection ID per tab. Names are self-chosen and not verified, so the UI never implies they are.

**Abuse and limits**

- Turnstile challenge on "Create board" and a per-IP creation limit (20 boards/hour) in the Worker. The limit uses a small `CreationLimiter` Durable Object per IP, because Workers' built-in rate limiter only supports 10 s or 60 s windows.
- Per-connection limits in the room: 60 presence messages/s, 10 ops/s, 12,000-character max message (a 4 KB cap could not carry a 10,000-character description); exceeding them drops messages, repeated abuse closes the socket.
- The per-board size and connection caps from the Data model section.
- Render all user text as text; markdown descriptions go through a sanitizer (no raw HTML, `rel="noopener nofollow"` on links). Implemented with react-markdown: raw HTML is skipped, unsafe URL schemes are stripped, links get `rel="noopener nofollow noreferrer ugc"`, and images show a "Load image from {host}" button and are fetched only on click (or from sites the viewer has allowed), with no referrer, so cards can't load trackers by themselves.
- Trash + undo so a vandal with the link cannot destroy a board irreversibly; keep a daily backup of the board for 7 days (downloadable from the trash and importable as a new board). Converting a note to a card (or back) replaces the source outright, so the trash never offers a duplicate.
- A "Report board" link and an admin script to delete a board by ID, since anonymous public boards will eventually host content you must take down.

## Expiry

Each board schedules its own deletion with a Durable Object alarm, so there is no global cron job and no table of boards to scan. A Durable Object has one alarm, so it is always set to the earliest of three jobs: expiry, trash purge (7 days after a deletion) and the daily backup. Alarm writes are billed, so the alarm only ever moves earlier; when a later job is due, the current alarm fires, finds nothing to do and reschedules.

**Definition:** a board is active when someone opens it or changes it. Opening counts, so a board people only read is not deleted out from under them.

1. On connect or on a committed op, the room sets `last_activity_at = now` in `meta`, at most once per hour to save writes.
2. At most once per day, it calls `setAlarm(last_activity_at + 60 days)`. Each alarm write is one billed row, so debouncing matters.
3. When the alarm fires, the room re-reads `last_activity_at`. If 60 days have passed and no one is connected, it calls `deleteAll()`, which removes the database and lets Cloudflare clean up the object. Otherwise it reschedules.
4. Any later request to that ID finds an empty object with no `meta.created_at` and returns "expired"; the Next.js page shows the expired screen. The room must not recreate a board just because someone visited an old URL.

**User-facing**

- Footer: "Kept until 17 Dec 2026" (last activity + 60 days), updated live.
- No "expiring soon" banner: any visit resets the clock, so the footer date plus a one-line explainer when the board is created is enough.
- Export to JSON/Markdown is always one click away; import a JSON export to restore into a new board.

**Test it:** `EXPIRY`, `TRASH_RETENTION` and `BACKUP_EVERY` are duration vars (`60d`, `2m`, `4s`); the write debounce scales down with short windows. `pnpm --filter worker test:hardening` runs the full flow with `EXPIRY=4s`; use `2m` in staging.

## Roadmap

About seven weeks for one developer to a public launch, with presence built straight after the kanban core so cursor accuracy is measured early, not bolted on.

| Week | Phase | Scope | Exit gate |
| --- | --- | --- | --- |
| 1 | Foundations | Next.js app, BoardRoom worker, create-board flow, CI | Two tabs share one room |
| 2–3 | Kanban core | Columns, cards, dnd-kit drag, ops and SQLite persistence | Edits survive reload |
| 3–4 | Realtime presence | Anchor cursors, interpolation, drag ghosts, edit badges | Cursor p95 under 100 ms |
| 5 | Bulletin board | Sticky-note canvas, pinned banner, note-to-card conversion | Same presence on canvas |
| 6 | Expiry and hardening | Expiry alarms, rate limits, Turnstile, trash, export | Expiry test passes |
| 7 | Launch | Load test 50 clients per board, landing page, monitoring | Public launch |

Each phase ends with a demoable gate; phases 2 and 3 overlap by a week because presence work starts as soon as cards move.

**Testing**

- Playwright with 2–3 browser contexts per test: one drags, the others assert the ghost, the lock and the final position.
- Latency harness: a headless client stamps cursor messages and measures round trip; track p50/p95 per region and fail staging checks if p95 exceeds 100 ms in-region.
- Room tests in Wrangler local dev: op ordering, lock contention, reconnect replay, and the expiry alarm with a 2-minute window.
- Load: 50 simulated clients on one board at 30 cursor messages/s each, and 1,000 boards with 2 clients each (`pnpm --filter worker load`). Locally one board with 50 clients passes (99% delivered, p95 39 ms); many boards locally top out around 2,000 incoming messages/s because every room shares one workerd process on one machine, so that scenario is only meaningful against staging, where rooms spread across Cloudflare's machines.

**Deployment**

- Next.js on Vercel with a preview per pull request; the Worker via `wrangler deploy` from CI.
- Separate staging and production Worker environments, each with its own Durable Object namespace; `NEXT_PUBLIC_PARTY_HOST` points the client at the right one. Defined in `wrangler.jsonc` as `--env staging` (`livekanban-staging`, `EXPIRY=2m`) and `--env production`; `.github/workflows/deploy.yml` deploys staging after CI passes on main and production on demand, then runs the latency check against staging.
- `ALLOWED_ORIGINS` accepts `*` for one hostname label, so `https://livekanban-*.vercel.app` covers every Vercel preview without allowing look-alike domains.

**Costs**

- Development fits free tiers: Workers Free allows Durable Objects 100,000 requests a day, and incoming WebSocket messages are billed at 20 per request ([pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)).
- Production: Workers Paid has a $5/month minimum including 1 million requests and 400,000 GB-s a month, then $0.15 per million requests.
- Rough estimate (approximate): 5 people moving cursors half the time at 30 messages/s is 75 messages/s, about 13,500 billed requests per board-hour, or roughly $0.002 per busy board-hour. Hibernation keeps idle boards at zero duration cost.
- Vercel's free Hobby plan is fine to start; check its terms before adding ads or other monetization.

**Risks**

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Vandalism by anyone with the link | Board wiped | Trash, undo, ops-log snapshots; read-only links in v1.1 |
| Illegal content on anonymous boards | Takedown and legal exposure | Report link, admin delete, Turnstile, `noindex` |
| Cursors land in the wrong place on other screens | Presence feels broken | Anchor-relative coordinates, RTT overlay, multi-viewport Playwright tests |
| One very popular board | Room overloaded | 50-connection cap; overflow viewers get read-only with throttled presence |
| Presence traffic drives up the bill | Cost | Hibernation, 30 msg/s cap, idle stop, Cloudflare budget alerts |
| Cloudflare lock-in | Migration effort | Keep room logic in plain TypeScript modules behind the documented protocol |

## Sources

- [Cloudflare Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [PartyServer (cloudflare/partykit)](https://github.com/cloudflare/partykit)
- [Liveblocks Free plan](https://liveblocks.io/docs/pricing/plans/free)
- [Liveblocks pricing overview](https://liveblocks.io/docs/pricing/overview)
- [Vercel KB: WebSocket support on Vercel Functions](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections)
- [Next.js blog (release history)](https://nextjs.org/blog)
