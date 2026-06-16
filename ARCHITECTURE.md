# Architecture

How Oasis fits together. For the rules an agent must follow see
[`AGENTS.md`](AGENTS.md); for the threat model see [`SECURITY.md`](SECURITY.md).

## Overview

Oasis is a single Node process with one optional dependency (`node-pty`, for the
embedded terminal). It serves a static vanilla frontend and a small JSON API,
persists state to flat files, shells out to the local `claude` CLI for its AI
features, and — when `node-pty` is present — bridges a PTY to the browser over a
hand-rolled WebSocket. It binds `127.0.0.1:7777` and never talks to the network
on its own.

```
                          ┌──────────────────────────────────────────┐
   Browser (Edge/Chrome   │              server.js (Node)             │
   --app window, or tab)  │                                           │
        │                 │  http.createServer  →  route by prefix:   │
        │  fetch /api/* ──▶│   /asset/<id>   → serveAsset (root-jailed)│
        │  GET  /        ──▶│   /api/*        → handleApi (JSON)        │
        │  GET  /site/*  ──▶│   /site/*       → docs/ (marketing)       │
        │                 │   /*            → public/ (the app)        │
        │◀── HTML/CSS/JS ─│                                           │
        │◀── JSON ────────│        │                │                 │
                          │        ▼                ▼                 │
                          │   data/*.json      child_process          │
                          │   (read/writeJson)  `claude -p` (stdin)    │
                          │        │                                   │
                          │        ▼                                   │
                          │   reads (read-only, for the ticker/gallery)│
                          │   ~/.claude/projects/**/*.jsonl            │
                          │   ~/.codex/session_index.jsonl             │
                          │   ~/.codex/generated_images/               │
                          └──────────────────────────────────────────┘
```

## Request lifecycle

`http.createServer(async (req, res) => …)` (bottom of `server.js`) wraps every
request in try/catch (→ `500 {error}`) and dispatches by URL prefix:

1. `/asset/<id>` → `serveAsset(res, id)` — image bytes, root-jailed.
2. `/api/...` → `handleApi(req, res, url)` — the API.
3. `/site` or `/site/...` → `serveFromDir(res, SITE_DIR, …)` — serves `docs/`
   (the marketing page) for local preview.
4. anything else → `serveStatic` → `serveFromDir(res, PUBLIC_DIR, …)` — the app.

`handleApi` is a flat sequence of guards:
`if (url.pathname === '/api/x' && req.method === 'M') return …`. Path-param
routes use the pre-split `seg = url.pathname.split('/').filter(Boolean)` array
(`seg[2]` is the id). Unmatched → `404 {error:'no such endpoint'}`.

Static serving (`serveFromDir`) normalizes the path, prefix-checks it against the
base dir (traversal guard), maps the extension through `MIME`, and supports HTTP
`Range` requests (needed for the backdrop video to seek/stream).

## Persistence — `data/`

State is plain JSON files, all under `data/`, all accessed through two helpers:

```js
readJson(file, fallback)   // never throws — returns fallback on any error
writeJson(file, value)     // pretty-printed, 2-space
```

`ensureFiles()` runs at boot and creates `data/`, `assets/`, and each file with a
sensible empty seed.

| File                 | Shape | Written by |
| -------------------- | ----- | ---------- |
| `notes.json`         | `[{id, text, created, pinned, status:'seed'|'sprouting'|'ready', source:'me'|'spark', sprouting_at, ready_at}]` | Ideas |
| `todos.json`         | `[{id, text, done, created, order}]` | Today |
| `journal.json`       | `[{id, text, mood, created}]` | Journal |
| `sparks.json`        | `[{at, seed, mode, items}]` (last 100) | Spark / develop |
| `ask-history.json`   | `[{id, q, answer, at}]` (last 30) | Ask |
| `briefings.json`     | `{ "<YYYY-MM-DD>": {insight, stats, generatedAt} }` | Daily briefing |
| `relays.json`        | `[{id, task, mode, rounds, codexAvailable, status, turns:[…], startedAt, finishedAt}]` (last 20) | Relay (Claude × Codex) |
| `reminders.json`     | `[{id, text, due, done, created}]` (last 200) | Voice reminders (fired client-side) |
| `stash.json`         | `[{id, text, label, pinned, created}]` (last 500) | Stash (snippet / clipboard vault) |
| `digests.json`       | `{ "<YYYY-MM-DD>": {reflection, stats, generatedAt} }` | Weekly digest (one cached reflection/day) |
| `tools.json`         | `[{id, name, target}]` (user-added dock entries) | Tool dock |
| `config.json`        | preferences (see below) | Setup wizard / Settings |

`config.json` is merged over `CONFIG_DEFAULTS` on read, so a partial or empty file
always yields a working config. Keys: `name`, `buildDir`, `showActivity`,
`defaultPhase` (`auto|dawn|day|dusk|night`), `radioBank` (`lofi|old|off`),
`radioStation`, `spotifyClientId`, `ytSaved` (the user's saved YouTube
playlists/mixes — `[{name,url}]`, sanitized server-side), `setupDone`.

`data/` is **gitignored** — it's personal. The distributed zip ships its own
fresh, empty `data/` (built by `package.ps1`).

## The API

All responses are JSON via `sendJson`. POST/PATCH bodies are parsed by `readBody`
(JSON, 2 MB cap).

| Method + path | Purpose |
| ------------- | ------- |
| `GET /api/activity` | Merged, cached (15s) feed of recent Claude + Codex sessions. |
| `GET /api/ai-status` | Which CLIs are installed: `{claude, codex, codexBin}` (cached probes; `?fresh=1` re-checks after an install/sign-in). Powers the intake "Connect Claude & Codex" step. |
| `GET /api/version` | `{version, isGit}` — the running version (sourced from the `const VERSION` in `server.js`, now **1.4.0**) + whether this is a git checkout. |
| `GET /api/update/check` | User-initiated: fetches the published `docs/version.json` over https and returns `{ok, current, latest, updateAvailable, notes, downloadUrl, isGit}`. The only place that compares versions (`cmpVer`). |
| `POST /api/update/apply` | Origin-gated (cross-origin → `403`). git checkout → `git pull --ff-only` (returns output, `upToDate` when the pull is a no-op, `restartNeeded`). A downloaded copy → **self-updates in place**: downloads the new zip (cache-busted with `?v=<version>`), unpacks it with the OS tool, backs up the current app files and **rolls back on any failure**, then overwrites the program files while preserving `data/`, `assets/`, `node_modules/`, `.git/`. Returns `{ok, restartNeeded, latest}` (or `{ok:false, error, downloadUrl}`). |
| `POST /api/update/restart` | Relaunch Oasis via the platform "Restart Oasis" launcher so a freshly applied update actually loads. Origin-gated; user-initiated only. |
| `GET /api/notes` · `POST /api/notes` · `PATCH /api/notes/:id` · `DELETE /api/notes/:id` | Ideas CRUD. PATCH accepts `{pinned?, text?, status?}`. |
| `POST /api/ask` | Freeform answer via `claude -p`; appends to ask-history. |
| `POST /api/intent` | The voice "brain". Body `{text, context:{tasks,tools,now}}`. Classifies ONE spoken request into a single structured action via `claude -p` (it does **not** answer) and returns `{ok, intent:{action, args, say}}`; a non-action comes back as `action:'none'` so the frontend routes it to a full spoken Ask. Untrusted output is sliced to balanced JSON and shape-checked; the action must be in `INTENT_ACTIONS`. Shares the one-call-at-a-time `sparkBusy` lock (`429` if busy). |
| `GET /api/ask-history` · `DELETE /api/ask-history` · `DELETE /api/ask-history/:id` | Ask history. |
| `GET /api/briefing` | One cached warm sentence per local day, with stats. |
| `GET /api/digest` | The weekly recap. Computes a 7-day rollup (`done/open/ideas/journal/mood/reminders/claude/codex`) and returns it immediately; the reflection is one cached `runClaude` per local day (shares `sparkBusy`, `pending:true` on a collision). |
| `POST /api/spark` | Idea generation. Body `{seed, mode:'ideas'|'expand'|'imageprompt'}`. |
| `GET /api/sparks` | Last 20 spark batches. |
| `POST /api/relay` | Start a Claude × Codex relay. Body `{task, mode:'delegate'|'debate', rounds:1-3}`. Returns `{ok, id}`; runs as a background job. |
| `GET /api/relay/:id` | Live job state (turns stream in as each model responds). |
| `GET /api/relays` · `DELETE /api/relays/:id` | Relay history (summaries) / delete one. |
| `GET /api/assets` · `POST /api/assets/import` · `POST /api/reveal` | Gallery list / import-from-URL / reveal-in-folder. |
| `GET /asset/:id` | Image bytes for an asset (root-jailed, `Cache-Control: max-age=3600`). |
| `GET /api/todos` · `POST /api/todos` · `POST /api/todos/reorder` · `PATCH /api/todos/:id` · `DELETE /api/todos/:id` | Today list. |
| `GET /api/journal` · `POST /api/journal` · `PATCH /api/journal/:id` · `DELETE /api/journal/:id` | Journal CRUD. |
| `GET /api/reminders` · `POST /api/reminders` · `PATCH /api/reminders/:id` · `DELETE /api/reminders/:id` | Voice reminders. POST `{text, due}` (ISO; validated + horizon-capped at 1 year). The alert (chime + spoken line) fires in the page; the server is durable storage. |
| `GET /api/stash` · `POST /api/stash` · `PATCH /api/stash/:id` · `DELETE /api/stash/:id` | Stash (snippet/clipboard vault). POST `{text, label?}` (text ≤ 8 KB); PATCH accepts `{pinned?, text?, label?}`. Pinned items sort first, then newest. |
| `GET /api/config` · `POST /api/config` | Preferences (POST validates each field). Also returns `terminalEnabled` + the per-boot `wsToken`. |
| `GET /api/export` | One-click local backup: a JSON bundle of everything in `data/`, sent as a download (`Content-Disposition: attachment`, `oasis-backup-<date>.json`). Nothing leaves the machine. |
| `GET /api/tools` · `POST /api/tools` · `DELETE /api/tools/:id` · `POST /api/launch` | Tool dock: scan + custom entries + launch. |
| `WS /term?token&kind&id` | WebSocket → PTY (the embedded terminal). Not part of `handleApi`; see below. |

## AI integration (`runClaude`)

The Ask, Spark/develop, briefing, and **voice-intent** features call the
**local `claude` CLI**:

```js
spawn('claude -p', { shell: true, stdio: ['pipe','pipe','pipe'] })
// prompt is written to stdin, then stdin.end()  ← required
```

- `shell: true` because `claude` is an npm shim on Windows.
- Prompt over **stdin, not argv** — keeps quotes/newlines/braces off the command
  line (a correctness *and* security choice; see SECURITY.md).
- `stdin.end()` is required or `claude` blocks ~3s waiting for input.
- 120s timeout, then kill → `{ok:false, error:'spark timed out'}`.

Prompt builders (`buildSparkPrompt`, `buildAskPrompt`, `buildIntentPrompt`, the
inline briefing prompt) demand **strict JSON / single-line output**. `buildIntentPrompt`
is a pure *classifier* — it lists the actions Jarvis can perform and asks the model
to pick one and extract its args (never to answer), which keeps the call fast and the
behaviour predictable. Model output is never trusted:
`extractJson(text, wantArray)` slices from the first `[`/`{` to the last `]`/`}`
and `JSON.parse`s; shape is then validated; failure degrades to
`{ok:false, error:'could not parse'}`.

**Concurrency:** a single module-level `sparkBusy` flag serializes every `claude`
call — Ask, Spark, briefing, **intent**, and the weekly **digest**. This keeps only
one `claude` process alive at a time. On a collision the behaviour differs by caller:
Ask, Spark, briefing, and intent return `429`; the digest (like the briefing's
auto-generation) instead returns its stats immediately with `pending:true` and no
reflection, so the client can retry. The relay (below) shares the same flag through
`aiAcquire()`/`aiRelease()`: instead of `429`-ing it *waits* for the flag to clear
before each turn, so a Claude turn and a Codex turn never run concurrently.

## Relay — Claude × Codex orchestration

Ask/Spark/briefing are single-shot. The **relay** runs the two CLIs *against each
other* on one task so the pair beats either alone. `POST /api/relay` validates
`{task, mode, rounds}`, probes whether `codex` is installed (`probeCodex`, cached),
creates a job, and kicks `runRelay` off in the background; the page polls
`GET /api/relay/:id` and renders turns as they land.

- **`runCodex`** mirrors `runClaude` for the second model:
  `codex exec --sandbox read-only --skip-git-repo-check`, prompt over **stdin**,
  final message captured from a `--output-last-message` temp file (no fragile
  stdout-log parsing); 300s timeout. The read-only sandbox means an orchestration
  "thinking" turn can never edit files or run commands.
- **Finding `codex`** (`findCodexBin`): the OpenAI desktop install hides the CLI
  under `%LOCALAPPDATA%\OpenAI\Codex\bin\<version>\codex.exe` and off `PATH`. We
  read the binary the app itself uses from `CODEX_CLI_PATH` in
  `~/.codex/config.toml` (preferring the newest versioned build over the stale
  top-level launcher, which can't parse the app's newer config), fall back to
  known locations, and honour an `OASIS_CODEX_BIN` override. `shellEnv()` prepends
  that folder to `PATH` for **both** the embedded terminal (so typing `codex`
  works) and `runCodex`. `probeCodex` short-circuits to `true` when the binary is
  found on disk.
- **Steps** come from `relaySteps(mode, rounds)`. *Delegate*: Plan (Claude) →
  `rounds ×` [Build (Codex) → Refine (Claude)] → Synthesis (Claude). *Debate*:
  Opening → `rounds ×` [Counter (Codex) → Response (Claude)] → Verdict. Each
  step's prompt embeds the running transcript (`relayTranscript`) and is told to
  disagree when the partner is wrong — that's where the value is.
- **Fallback:** if `codex` isn't installed, its steps run as Claude, each turn
  flagged `fallback:true`, and the panel says so. The first step is `critical`
  (abort the job if it errors); later errored turns are recorded and the relay
  continues.
- One relay at a time (`relayBusy` → `429`). Live jobs live in an in-memory
  `RELAY_JOBS` map and are persisted to `relays.json` after every turn.

## Activity ingestion (read-only)

The ticker reads, but never writes, two external sources:

- **Claude Code:** scans `~/.claude/projects/*/` for `*.jsonl` session files
  (skips `agent-*` and tiny files), reads the head of each (`readHeadLines`,
  512 KB), and extracts a title (summary → first enqueued prompt → first user
  message, with noise filtered by `acceptTitle`) and the `cwd` (to derive the
  project name; `.claude-worktrees` paths are unwound to the parent project).
- **Codex:** parses `~/.codex/session_index.jsonl`, dedupes by `id` keeping the
  newest `updated_at`, and maps to `{source:'codex', title, lastActive}`.

Results are merged, sorted by recency, capped at 60, and cached for 15s
(`getActivity`). If `config.showActivity` is false, it returns an empty feed.
Each item also carries its session `id` (the Claude `.jsonl` filename, or the
Codex thread id) and `cwd`; `getActivity` rebuilds a module-level `SESSION_INDEX`
(`id → {source, cwd}`) on each scan so the terminal can resume a session in its
real project directory **without trusting any client-supplied path**.

## Embedded terminal (`/term` WebSocket → PTY)

Gated entirely on the optional `node-pty` (`TERMINAL_ENABLED = !!pty`). The HTTP
server's `upgrade` event runs `handleUpgrade`, which:

1. **Authorizes** the handshake — path `/term`, an `Origin` in `WS_ORIGINS`
   (Oasis's own page), and the per-boot `WS_TOKEN` (minted at startup, served to
   the page via `/api/config`). Any failure → `socket.destroy()`. See SECURITY.md.
2. **Completes the WebSocket handshake** in pure stdlib — `wsAccept` (SHA-1 of the
   key + the RFC 6455 GUID) and a `101` response. Framing is hand-rolled:
   `wsFrame` encodes unmasked server→client frames; `wsParser` buffers and unmasks
   client→server frames (and auto-replies to pings).
3. **Spawns a PTY** — always the user's shell (`defaultShell()`); for a
   `claude`/`codex` request it then *types* the launch command
   (`claude --resume <id>`, etc.) once the shell's first output appears. `cwd` is
   the resumed session's project (from `SESSION_INDEX`) or, for a fresh terminal,
   the **Oasis project root** (`ROOT`) — so a new terminal opens "in the project",
   not the home folder. The `id` is charset-validated before interpolation.
4. **Bridges** PTY ⇄ socket with a tiny JSON protocol — `{t:'i',d}` keystrokes and
   `{t:'r',c,r}` resize from the client; `{t:'o',d}` output and `{t:'x',code}` exit
   to the client. Socket close / error / PTY exit all tear down the other side.

The frontend (`openTerminal` in `app.js`) mounts an `xterm.js` instance (vendored,
no build) and wires it to this socket. Terminals are tabs in a single **movable,
resizable panel** (`#terminal-dock`, `position: fixed`). It opens docked along the
bottom by default; the user drags it by the tab bar and resizes from side/corner
handles (`.td-rz`), with the geometry clamped to the viewport and persisted to
`localStorage` (`oasis_term_geo_v2`). Each session is a tab with its own `.td-host`;
only the active one is shown.

**Hand a task to Claude.** Each open todo has a button (`runTaskWithClaude`) that
opens a `claude` terminal in the project with the task text *staged* on the window
(`opts.seed`). A "Send task" button in the titlebar types it into Claude on click
(`{t:'i', d: task + '\r'}`). It's a deliberate one-click rather than auto-typed:
Claude's interactive startup is slow/variable and shows a one-time folder-trust
prompt, so a click (after you've eyeballed it) is far more reliable than blind
timing — and Claude still asks before it edits or runs anything.

## Gallery & asset security

`scanAssets` walks the **`ASSET_ROOTS`** — `~/.codex/generated_images` and the
app's own `assets/` — to depth 3, keeps image extensions only, sorts by mtime,
caps at 200. Each asset's `id` is the URL-safe base64 of its absolute path.

Serving (`serveAsset`) and revealing (`revealAsset`) **decode the id and reject
any path that doesn't resolve under an allowed root** (`underRoot`) — the
traversal guard. There is intentionally **no** endpoint that deletes a file from
disk. Import (`importAsset`) is `https`-only, follows ≤3 redirects, caps at 30 MB
/ 60s, and **SSRF-filters the host** — it resolves the host (re-checked on every
redirect) and refuses loopback / private / link-local (incl. the
`169.254.169.254` metadata address) / CGNAT / unspecified addresses — and writes
into `assets/imported-<ts>.<ext>`.

## Tool dock

`scanTools` lists the user's projects under `buildDir()` (config `buildDir`, else
`~/Documents/build`). For each subfolder it detects a launch script
(`launch*.bat` on Windows, `launch*.command|.sh` on macOS) and/or an
`npm run dev`, plus an "open folder" action; a `package.json` `oasisName`
overrides the display name. Custom entries come from `tools.json`. `launchTool`
shells out per platform via `osOpen`/terminal, validating the action against the
tool's allowed actions first.

## Frontend (`public/`)

Vanilla, no framework, no modules, no build:

- **`index.html`** — the shell plus an inline SVG `<symbol>` icon set. The UI uses
  **no emoji** (icons are SVG).
- **`app.js`** — all UI logic: the looping backdrop video with day/golden palettes
  and a still-photo fallback, the Ask bar, Ideas + inline "develop into angles",
  Today, Journal, Gallery + lightbox, music, the activity ticker, command palette,
  focus timer, inline editing of ideas/tasks/journal entries (`inlineEdit`),
  one-click data export/backup (`exportData`), the **terminal panel**
  (`openTerminal` — xterm + WebSocket, tabbed sessions in a movable/resizable
  floating panel), the first-run setup wizard, the **keymap** (a registry of
  rebindable actions + a chord dispatcher that replaced the hardcoded keyboard
  handler; overrides in `localStorage` `oasis_keymap`), **voice control** (Web
  Speech `SpeechRecognition` in, `speechSynthesis` out, a small command grammar in
  `handleUtterance`, and the arc-reactor HUD; prefs in `localStorage`
  `oasis_voice`), and the **Console** overlay (Voice + Shortcuts tabs). Data flows
  through same-origin `fetch` against the API (and the `/term` socket); voice and
  keymap are pure client-side — they add **no** server routes and no dependency.
- **`vendor/`** — `xterm.js`, `xterm.css`, and `addon-fit.js`, copied verbatim
  from the `@xterm/*` packages. They're loaded with plain `<script>`/`<link>` tags
  (the UMD build exposes `window.Terminal` / `window.FitAddon`), so there is still
  no bundler or build step.
- **`style.css`** — the sea-glass theme (transparent glass panels,
  `backdrop-filter`, light type with Georgia-italic editorial accents). The
  terminal panel uses `backdrop-filter: blur(16px)` (frosted glass, leaning toward
  a more opaque fill so it reads over the bright ocean) — it's small by default, so
  blurring it stays within the T570 budget.

Performance: the backdrop throttles and sleeps when the tab is hidden and falls
back to a still photo if the video can't play; canvas effects are capped ~30fps;
no `filter: blur()` on large/animated elements (the T570 budget) — the voice HUD's
orb animates with transform/opacity only. Voice recognition also stops when the
tab is hidden (`voiceSleep` in the visibility handler) — for the mic-rest and the
perf budget alike — and resumes hands-free listening when it returns. Clipboard
copies keep a `<textarea>` fallback because the async Clipboard API can fail over
`http://localhost`.

## Distribution pipeline

`package.ps1` → `dist/Oasis-{Windows,macOS}.zip` → copied into `docs/download/`.
Each zip is a clean stage: `server.js`, `public/`, a fresh **empty** `data/`, an
empty `assets/`, `README.md`, `LICENSE.txt`, and the platform's
launchers/setup/icon. `docs/` is **not** bundled in the app zip — it's the
published marketing site only. Zip entries are written by hand with
**forward-slash** separators for cross-platform extraction. `package.ps1` also
stamps `docs/version.json`'s version from the `const VERSION` in `server.js` so
the two can't drift. `docs/` is then published via GitHub Pages (`/docs` on
`main`). Details: [`PUBLISH.md`](PUBLISH.md).
