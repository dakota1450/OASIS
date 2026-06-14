# AGENTS.md

Operating guide for AI coding agents (Codex, Claude Code, and any other) working
in this repository. **This file is the single source of truth for agents** —
[`CLAUDE.md`](CLAUDE.md) points here. Read it before you touch anything.

> Codex reads `AGENTS.md` automatically; nested `AGENTS.md` files (if any are
> added later) override this one for the subtree they live in. Keep this file
> current — if you change a constraint below in code, change it here too.

---

## 1. What this is

**Oasis** is a small, private, local-first desktop dashboard for people who build
with AI coding tools. It runs as a single zero-dependency Node process on
`http://localhost:7777` and serves a vanilla HTML/CSS/JS frontend that floats as
glass over a looping ocean video. Features: an **Ask** bar (shells out to the
local `claude` CLI), **Ideas** capture + "develop into angles", a **Today** task
list, a **Journal**, an image **Gallery**, a once-a-day **briefing**, a quiet
**ticker** of recent Claude Code / Codex sessions, and a **tool dock** that
launches the user's projects.

It is **free, cross-platform (macOS + Windows), with no account, no telemetry,
nothing phoned home.** Treat those four properties as inviolable product
constraints, not nice-to-haves.

For the full feature tour see [`README.md`](README.md); for the internals see
[`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## 2. Run / build / verify

There is **no build step and no `package.json`** — this is deliberate (see the
hard constraints). The whole app is `node server.js`.

```bash
# Run the app (from the repo root)
node server.js
# → "Oasis is open at http://localhost:7777"

# Run on a different port
PORT=8080 node server.js          # macOS/Linux
$env:PORT=8080; node server.js    # Windows PowerShell
```

Platform launchers (these are what end users double-click — don't break them):

| Platform | First-run setup        | Launch                    |
| -------- | ---------------------- | ------------------------- |
| Windows  | `Setup Oasis.bat`      | `Launch Oasis.bat` → `Oasis.vbs` |
| macOS    | `Setup Oasis.command`  | `Launch Oasis.command`    |

**Verification is manual — there is no test suite.** After a change:

1. `node server.js` and confirm it boots without throwing.
2. Open `http://localhost:7777` and exercise the panel you touched.
3. AI features (Ask, Ideas "develop", daily briefing) require the `claude` CLI on
   `PATH`. Without it those panels stay quiet but the app must still run.
4. For server-only changes, hit the endpoint directly (e.g.
   `curl http://localhost:7777/api/activity`).

The editor/harness "run" config lives in [`.claude/launch.json`](.claude/launch.json)
(node `server.js`, port 7777, autoPort).

---

## 3. Hard constraints — do not violate

These come from the original build spec ([`SPEC-v2.md`](SPEC-v2.md)) and the
target hardware. Breaking one is a regression even if the app still "works."

- **Near-zero dependencies — exactly ONE, and it's optional.** Node standard
  library only (`http`, `https`, `fs`, `path`, `os`, `crypto`, `child_process`)
  **plus** `node-pty`, the single npm dependency, which powers the embedded
  terminal (a real interactive Claude/Codex/shell PTY in a glass window). It is a
  native module but installs from prebuilt binaries (no build toolchain needed on
  win/mac/x64+arm64), and it is **feature-gated**: `server.js` does
  `try { require('node-pty') } catch`, so if it's missing the app still boots and
  the terminal simply degrades. Do **not** add a *second* dependency, a framework,
  or a bundler. The frontend stays plain `index.html` + `style.css` + `app.js` —
  no React/Vue/build tooling; xterm.js is **vendored** as static files in
  `public/vendor/` (copied, not bundled), so there is still no frontend build
  step. If a task seems to need another dep, surface the tension (see §10) — this
  one was a deliberate, discussed exception, not a precedent.
- **Node 18+.** Don't use APIs newer than the Node 18 baseline without a reason.
- **Server binds `127.0.0.1` only**, port `Number(process.env.PORT) || 7777`.
  Never bind `0.0.0.0` or otherwise expose it on the network.
- **No external network at runtime, except user-initiated media.** No CDNs, no
  web fonts, no analytics, nothing phoned home. The only outbound traffic is
  things the user explicitly asks for: (a) the image import from an `https` URL,
  (b) the local `claude` / `codex` CLIs, (c) the **music panel** — internet
  radio streams, and the optional Spotify and YouTube integrations (Spotify
  embeds + PKCE OAuth to the user's own Spotify; `youtube-nocookie.com` embeds
  for pasted/saved links), and (d) the **manual update check** — a single `GET`
  of the published release manifest, only when the user clicks "Check for
  updates" (never automatic, sends nothing about the user). Those are the only
  cross-origin `fetch`/embed targets; everything else in the frontend is
  same-origin only. Don't add new outbound calls beyond this set without
  surfacing it (see §10) — in particular, do NOT make the update check automatic.
- **No telemetry, ever.** Nothing about the user leaves the machine.
- **Performance target = ThinkPad T570 with integrated graphics.** No
  `filter: blur()` on large or animated elements. `backdrop-filter` on the
  handful of glass panels is fine. Cap canvas effects at ~30fps. The backdrop
  video must throttle/sleep when the tab is hidden and fall back to a still photo
  if it can't play.
- **Cross-platform.** Every shell-out and path must work on **both** Windows and
  macOS (Linux is best-effort). Use the `IS_WIN` / `IS_MAC` branches and the
  `osOpen()` helper; never hard-code `cmd`, `start`, `open`, or `\`/`/`.

---

## 4. Repo map

```
server.js              The entire backend. Node HTTP server + a hand-rolled
                       WebSocket (the `upgrade` handler) bridging xterm ⇄ node-pty.
package.json           The one dependency (node-pty). No scripts beyond `start`.
node_modules/          node-pty only (gitignored, not shipped in the zips).
public/                The frontend (served at /).
  index.html             Shell + inline SVG icon set (NO emoji in the UI).
  app.js                 All UI logic (vanilla JS, no modules) — incl. the terminals.
  style.css              Sea-glass theme.
  vendor/                Vendored xterm.js + xterm.css + addon-fit.js (static, no build).
  assets/                Ocean backdrops shipped with the app (video + poster).
docs/                   The PUBLIC GitHub Pages marketing site (NOT internal docs).
  index.html             Landing page (interactive canvas ocean).
  download/*.zip         Packaged apps, produced by package.ps1.
  assets/                Hero media for the landing page.
data/                   Local user state as JSON (gitignored, recreated on boot).
assets/                 User-imported/generated images (gitignored).
package.ps1            Builds the two distributable zips into docs/download/.
setup.ps1             Windows first-run setup (Node check, shortcut, open).
*.bat / *.vbs          Windows launchers.
*.command              macOS launchers (must stay LF — see .gitattributes).
README.md             End-user guide.
PUBLISH.md            How to deploy the docs/ site on GitHub Pages.
SPEC-v2.md            Historical build spec (reference, not gospel).
AGENTS.md             ← you are here.
ARCHITECTURE.md       How the system fits together.
CONTRIBUTING.md       Dev workflow + conventions.
SECURITY.md           Threat model + the guards that enforce it.
CHANGELOG.md          Notable changes.
```

> **Naming note:** `docs/` is the *published marketing site*, not developer
> documentation. Internal/dev docs live at the repo root (this file and its
> siblings). Don't put dev docs in `docs/` — they'd be served publicly.

---

## 5. Architecture in one screen

`server.js` is a single `http.createServer` handler that routes by URL prefix:

- `/asset/<id>` → `serveAsset` — serves an image file by opaque id, **only** if
  it resolves under an allowed root.
- `/api/...` → `handleApi` — a flat list of `if (pathname === ... && method ===)`
  branches; responds with `sendJson`.
- `/site` and `/site/...` → serves `docs/` (the marketing page) for local preview.
- everything else → serves `public/`.

Separately, `server.on('upgrade')` handles **WebSocket** connections to `/term`:
it validates the `Origin` and a per-boot token, then spawns a `node-pty` shell
and bridges PTY ⇄ socket (tiny JSON protocol). This is the embedded terminal.
The whole feature is gated on the optional `node-pty` (`TERMINAL_ENABLED`). Fresh
terminals open in the Oasis project (`ROOT`); resumed sessions open in their own
project. A Today todo can be "handed to Claude" — it opens a `claude` terminal in
the project with the task staged, sent into Claude on a click.

State is JSON files in `data/`, read/written through `readJson` / `writeJson`.
AI features shell out to the local `claude` CLI via `runClaude` (and, for the
relay, the `codex` CLI via `runCodex`). The **relay** (`/api/relay`) is a
background job that runs Claude and Codex against each other on one task —
plan→build→refine→synthesise, or debate→verdict — passing a shared transcript
between turns; `runCodex` uses `codex exec` in a **read-only sandbox** with the
prompt over stdin, and the whole thing degrades to a Claude-only run if `codex`
isn't installed. The activity ticker reads Claude Code session logs
(`~/.claude/projects/**/*.jsonl`) and the Codex session index
(`~/.codex/session_index.jsonl`); the gallery scans `~/.codex/generated_images`
and `<app>/assets`.

Full detail (request lifecycle, data model, every endpoint, the AI integration,
the security guards) is in [`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## 6. Conventions — match the existing code

- **Backend style:** CommonJS, `'use strict'`, small focused functions, terse
  but commented where non-obvious. One section per feature, separated by
  `// ---------- name ----------` banners. Mirror it.
- **Persisting data:** add a `*_FILE` path constant near the top, register it in
  `ensureFiles()`, and read/write only through `readJson(file, fallback)` /
  `writeJson(file, value)` (pretty-printed, 2-space). Never `JSON.parse` a file
  without a fallback.
- **IDs:** `newId()` (base36 timestamp + 3 random bytes). Don't invent another
  scheme.
- **Responses:** always `sendJson(res, status, obj)`. Success shapes are
  endpoint-specific; AI endpoints return `{ ok: true, ... }` / `{ ok: false, error }`.
- **Defensive parsing of model output:** the `claude` CLI returns free text.
  Never trust it — slice to balanced JSON with `extractJson(text, wantArray)`,
  validate the shape, and degrade to `{ ok: false, error: 'could not parse' }`.
- **Frontend:** vanilla DOM, no framework, no modules, no emoji (icons are inline
  SVG `<symbol>`s in `index.html`). Clipboard writes must keep the
  `<textarea>` fallback (the async Clipboard API can fail over `http://localhost`).
- **Cross-platform shell-outs:** branch on `IS_WIN` / `IS_MAC`; route file/folder/
  URL opens through `osOpen(target)`.

### Adding an API endpoint

Add a branch inside `handleApi(req, res, url)` under the matching section banner:

```js
// inside handleApi, in the relevant // ---------- section ----------
if (url.pathname === '/api/thing' && req.method === 'POST') {
  const body = await readBody(req);              // 2 MB cap, JSON, throws on bad input
  const text = (body.text || '').trim();
  if (!text) return sendJson(res, 400, { error: 'empty' });
  const items = readJson(THING_FILE, []);
  const item = { id: newId(), text, created: new Date().toISOString() };
  items.unshift(item);
  writeJson(THING_FILE, items);
  return sendJson(res, 200, item);
}
```

For path params use the pre-split `seg` array (`seg[2]` is the id segment), e.g.
`if (seg[0] === 'api' && seg[1] === 'thing' && seg[2] && req.method === 'DELETE')`.

---

## 7. Security rules you must preserve

Oasis serves the local filesystem and shells out — these guards are load-bearing.
See [`SECURITY.md`](SECURITY.md) for the full model. When editing the relevant
code, keep every one of these intact:

- **Filesystem reads are root-jailed.** `/asset/:id` and `/api/reveal` decode an
  opaque path and reject anything that doesn't resolve under `ASSET_ROOTS`
  (`underRoot`). Static serving (`serveFromDir`) normalizes and prefix-checks the
  path. Never serve a caller-supplied path without re-running these checks.
- **The `claude` prompt goes over stdin, never argv.** `runClaude` spawns
  `claude -p` with `{ shell: true }` and writes the prompt to `stdin` (then ends
  it — required, or `claude` blocks waiting for input). This keeps quotes,
  newlines, and braces off the command line. Do not move prompt text into args.
  `runCodex` (the relay's second model) does the same — prompt over stdin — and
  additionally pins `codex exec --sandbox read-only` so an orchestration turn can
  never edit files or run commands. Keep both of those properties intact.
- **Custom tool targets are sanitized.** `POST /api/tools` rejects targets
  containing `"`, `` ` ``, `$`, or line breaks before they're interpolated into a
  shell command.
- **Image import is constrained:** `https` only, ≤3 redirects, 30 MB cap, 60s
  timeout, written into `assets/` only.
- **Request bodies are capped** at 2 MB (`readBody`).
- **There is no delete-from-disk endpoint** for gallery assets — by design.
- **The terminal WebSocket (`/term`) is the highest-privilege surface** — it
  spawns a real shell with the user's privileges. It is gated three ways, all of
  which must stay intact: the server still binds `127.0.0.1` only; the `upgrade`
  handler rejects any `Origin` that isn't Oasis's own page; and it requires the
  per-boot `WS_TOKEN` (minted in memory, handed to the page via `/api/config`,
  which a cross-origin page can't read). The command is built server-side from a
  small allow-list (`shell`/`claude`/`codex`); the session id is charset-validated
  before it's typed into the shell, and the `cwd` is resolved from the server's
  own session index (never a client-supplied path).

If a change would relax any of these, stop and flag it rather than shipping it.

---

## 8. Distribution & publishing (don't break the pipeline)

- `package.ps1` (run via `Package Oasis.bat`) stages a clean copy with **empty
  data and no personal files** and writes `dist/Oasis-Windows.zip` +
  `dist/Oasis-macOS.zip`, then copies both into `docs/download/`.
- The zips **must use forward-slash entry paths** — `package.ps1` writes entries
  by hand for exactly this reason (PowerShell 5.1's `Compress-Archive` uses
  backslashes, which break extraction on macOS/Linux). Don't replace that with
  `Compress-Archive`.
- macOS launchers (`*.command`, `*.sh`) **must stay LF** — enforced by
  `.gitattributes`. Zips can't carry the Unix exec bit, so first-run users chmod
  via the setup script; the `START HERE (macOS).txt` note explains the Gatekeeper
  right-click→Open step. Keep that note accurate.
- Publishing the site = commit `docs/` and push to `main`; GitHub Pages serves
  `/docs`. Full steps in [`PUBLISH.md`](PUBLISH.md).
- `data/`, `assets/*` (except `assets/README.txt`), `dist/`, and `node_modules/`
  are gitignored. Never commit personal data or build artifacts.

---

## 9. Common gotchas

- **`claude` resolves to an npm shim on Windows**, so `spawn` needs
  `{ shell: true }`. And you must `stdin.end()` or it waits ~3s for input.
- **One AI call at a time.** A single `sparkBusy` flag guards Ask, Spark, and the
  briefing; a second concurrent request gets a `429`. Preserve this — concurrent
  `claude` invocations are slow and racy.
- **Activity & briefing are cached** (15s for activity). Don't expect instant
  reflection of new sessions.
- **Two `assets/` directories exist:** `public/assets/` (the shipped backdrops,
  excluded from the gallery) and root `assets/` (user images, a gallery root).
  Don't conflate them.
- **The dev machine is Windows (a ThinkPad T570).** Prefer PowerShell-safe
  commands; verify macOS paths/launchers by reading, since you likely can't run
  them here.

---

## 10. House rules for changes

- Keep diffs minimal and in the style of the surrounding code; don't reformat
  unrelated lines.
- Update the relevant doc in the same change: a new endpoint → note it in
  `ARCHITECTURE.md`; a changed constraint → fix it here; anything user-visible →
  `CHANGELOG.md` and possibly `README.md`.
- Don't add dependencies, build steps, or telemetry. If a task seems to require
  one, surface the tension instead of quietly adding it.
- Commit messages: short imperative subject. This repo has no remote yet; don't
  push or create PRs unless asked.
