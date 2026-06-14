# Changelog

All notable changes to Oasis are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Oasis has not cut a
versioned public release yet, so entries are grouped under **Unreleased** until
the first tag.

## [Unreleased]

### Added
- **Built-in terminal panel.** Run real, interactive Claude / Codex / shell
  sessions in a movable, resizable terminal panel with a tab per session. It opens
  docked along the bottom of the dashboard, then you can drag it anywhere and
  resize it from the sides/corners; its position and size persist across reloads.
  Fresh terminals open **in the Oasis project directory** (resumed sessions open
  in their own project); each tab shows which project it lives in. The toolbar
  terminal button opens it; "+" starts a fresh shell/Claude/Codex; the "recent
  agent work" list gains a per-session button that resumes a Claude session
  (`claude --resume <id>`). Backed by a PTY-over-WebSocket bridge (`/term`)
  hand-rolled on the Node stdlib, with `xterm.js` vendored into `public/vendor/`.
- **Hand a task to Claude from the Today list.** Each open todo gets a button
  that opens a Claude terminal in the project with the task staged; a "Send task"
  button in the terminal types it into Claude once you're ready (you accept
  Claude's one-time folder-trust prompt, then send — and Claude still asks before
  it edits or runs anything, so you stay in the loop).
- Internal documentation set: `AGENTS.md` (the cross-agent guide that Codex and
  other agents read), `CLAUDE.md`, `ARCHITECTURE.md`, `CONTRIBUTING.md`,
  `SECURITY.md`, and this `CHANGELOG.md`.

### Changed
- **Dependency policy:** Oasis now has exactly one npm dependency, `node-pty`
  (the embedded terminal's PTY). It is optional and feature-gated — the app still
  boots and runs without it; only the terminal goes dark. Everything else remains
  Node-stdlib-only with a vanilla, build-free frontend.
- Redesigned the GitHub Pages marketing page (`docs/`) as a cinematic film over
  the real looping ocean video.

## Project history

Reconstructed from git history (this project began as "Meadow"/"Observatory" and
was rebuilt and renamed **Oasis**):

- **Oasis app — cross-platform release.** The dashboard reoriented around making:
  Ask (local `claude` CLI), Ideas with inline "develop into angles", Today,
  Journal, Gallery, daily briefing, activity ticker, and tool dock — floating as
  sea-glass over a looping ocean backdrop. Free, local-first, zero-dependency
  Node server on port 7777, for macOS and Windows.
- **Free GitHub Pages download site.** Added `docs/` as a self-contained marketing
  page plus `package.ps1` building clean `Oasis-Windows.zip` / `Oasis-macOS.zip`
  distributables (empty data, forward-slash zip entries) into `docs/download/`,
  with cross-platform launchers (`.bat`/`.vbs` for Windows, `.command` for macOS).
- **Cleanup.** Removed the unused legacy backdrops (`meadow-*`, `pond`) and a dead
  packaging step.

---

When you ship a user-visible change, add it under **Unreleased**. At the first
tagged release, rename that section to the version and date and start a fresh
**Unreleased** above it.
