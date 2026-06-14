# Contributing

Thanks for working on Oasis. It's a small, deliberately simple project — the
goal of this guide is to keep it that way. If you're an AI agent, read
[`AGENTS.md`](AGENTS.md) first; it's the authoritative spec.

## Prerequisites

- **Node.js 18+** (LTS recommended). That's the only hard requirement.
- The **`claude` CLI** on your `PATH` if you want to exercise the AI features
  (Ask, Ideas "develop", daily briefing). The app runs fine without it — those
  panels just stay quiet.
- Optional: **Codex** and its `~/.codex/generated_images` folder, to see the
  gallery and the Codex side of the activity ticker populate.

There is **no `npm install`** — Oasis has zero dependencies by design.

## Running locally

```bash
node server.js
# → Oasis is open at http://localhost:7777
```

```bash
# different port
PORT=8080 node server.js          # macOS/Linux
$env:PORT=8080; node server.js    # Windows PowerShell
```

Open `http://localhost:7777`. The marketing page is previewable at
`http://localhost:7777/site/`.

## The constraints (read before you change anything)

These are non-negotiable. The full list with rationale is in
[`AGENTS.md` §3](AGENTS.md). In short:

- **Zero dependencies.** No `package.json`, no framework, no bundler, no
  `node_modules`. Node standard library only.
- **Local-first.** Binds `127.0.0.1:7777`. No network calls except the
  user-initiated image import and the local `claude` CLI. **No telemetry.**
- **Cross-platform** (macOS + Windows; Linux best-effort).
- **Performance budget = a ThinkPad T570 with integrated graphics.** No
  `filter: blur()` on large/animated elements; canvas FX ≤ ~30fps.

A change that "works" but breaks one of these is a regression.

## How the code is organized

- **`server.js`** — the entire backend. One HTTP handler, routed by prefix; a
  flat list of API branches in `handleApi`; JSON files in `data/` via
  `readJson`/`writeJson`; AI via `runClaude`. See [`ARCHITECTURE.md`](ARCHITECTURE.md).
- **`public/`** — vanilla `index.html` + `style.css` + `app.js`. No build, no
  modules, no emoji (icons are inline SVG).

### Coding conventions

- CommonJS, `'use strict'`, small functions, `// ---------- section ----------`
  banners. Match the surrounding style; don't reformat unrelated lines.
- Persisting new state? Add a `*_FILE` constant, register it in `ensureFiles()`,
  and read/write only through `readJson`/`writeJson`. Always pass a fallback.
- IDs come from `newId()`. Responses go through `sendJson`. AI endpoints return
  `{ok:true,…}` / `{ok:false,error}`.
- Validate and sanitize all input. Re-use the existing guards (`underRoot`,
  `readBody`'s size cap, the tool-target character check) — see
  [`SECURITY.md`](SECURITY.md).
- Cross-platform shell-outs branch on `IS_WIN`/`IS_MAC` and route opens through
  `osOpen`.

### Adding an endpoint

See the worked example in [`AGENTS.md` §6](AGENTS.md). Briefly: add a branch in
`handleApi` under the right section banner, parse with `readBody`, persist with
`readJson`/`writeJson`, respond with `sendJson`. Then note it in
[`ARCHITECTURE.md`](ARCHITECTURE.md).

## Testing & verification

There is no automated test suite. Verify manually:

1. `node server.js` boots cleanly.
2. Open the app and exercise the panel you changed.
3. Hit changed endpoints directly, e.g.
   `curl http://localhost:7777/api/activity` or
   `curl -X POST http://localhost:7777/api/todos -d '{"text":"smoke"}'`.
4. If you touched anything cross-platform (launchers, `osOpen`, paths), read the
   other platform's path even if you can't run it. The dev machine is Windows.
5. AI features need the `claude` CLI; confirm the app degrades gracefully when
   it's absent.

## Commits & branches

- Short, imperative commit subjects (e.g. "Add journal mood filter"), matching
  the existing history.
- This repo currently has **no remote**. Don't push or open PRs unless asked.
- Never commit `data/` (personal), `assets/*` (user images, except
  `assets/README.txt`), `dist/`, or `node_modules/` — all gitignored.
- Keep `*.command`/`*.sh` as **LF** and Windows scripts as **CRLF** — enforced by
  `.gitattributes`; don't fight it.

## Building & publishing

- **Build the distributables:** `Package Oasis.bat` (or
  `powershell -File package.ps1`) → `dist/Oasis-{Windows,macOS}.zip`, copied into
  `docs/download/`. The zips ship empty data and no personal files.
- **Publish the site:** commit `docs/` and push to `main`; GitHub Pages serves
  `/docs`. Full steps in [`PUBLISH.md`](PUBLISH.md).

## When you're done

Update the docs alongside the code: a new endpoint → `ARCHITECTURE.md`; a changed
rule → `AGENTS.md`; anything a user would notice → `CHANGELOG.md` and maybe
`README.md`. Docs that drift from the code are worse than no docs.
