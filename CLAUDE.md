# CLAUDE.md

This file guides **Claude Code** when working in this repo.

## Read AGENTS.md first

[`AGENTS.md`](AGENTS.md) is the single source of truth for all agents — run/build
commands, the hard constraints (zero deps, localhost-only, no telemetry, the
T570 performance budget), repo map, conventions, security rules, and the
distribution pipeline. Everything there applies to you. This file only adds the
Claude-Code-specific notes below.

## Claude-Code-specific notes

- **No automated tests.** Verify by running `node server.js` and exercising the
  affected panel at `http://localhost:7777` (see AGENTS.md §2). Use the
  preview/verification tooling to confirm UI changes rather than asking the user
  to check manually.
- **The app itself shells out to the `claude` CLI** (`claude -p`, prompt over
  stdin) for the Ask / Ideas-develop / daily-briefing features — see
  `runClaude` in `server.js`. When changing those code paths, remember the
  one-call-at-a-time `sparkBusy` guard and the defensive `extractJson` parsing of
  model output.
- **Dev machine is Windows (ThinkPad T570), shell is PowerShell.** Prefer
  PowerShell-safe commands; the macOS `*.command` launchers can usually only be
  verified by reading, not running, from here.
- **Don't commit or push unless asked**, and never commit `data/` (personal) or
  `dist/` (build artifacts) — both are gitignored.

## Project facts

- **Oasis** — a free, local-first Node dashboard for people who build with AI
  tools. Port `7777`, binds `127.0.0.1`. macOS + Windows. Near-zero dependencies:
  exactly **one**, the optional `node-pty` (powers the embedded terminal; the app
  runs fine without it). See AGENTS.md §3.
- Backend: `server.js` (Node stdlib + the hand-rolled WebSocket terminal bridge).
  Frontend: vanilla `public/` (xterm.js vendored, no build step).
- `docs/` is the **public** GitHub Pages marketing site, not developer docs.
  Internal/dev docs live at the repo root.
