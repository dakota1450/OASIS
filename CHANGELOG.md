# Changelog

All notable changes to Oasis are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The current release is
**1.2.0**; the authoritative version number lives in the `VERSION` constant in
`server.js` (and `package.ps1` stamps it into `docs/version.json` at build time).

## [1.2.0] — 2026-06-14

### Added
- **Voice control — talk to Oasis.** A new, opt-in voice assistant built on the
  browser's own Web Speech API (no new dependency). Two ways in: **hands-free**
  (it listens for a wake word you set — say "Oasis, brief me", or set the word to
  "Jarvis" for the full effect) and **push-to-talk** (tap or hold the floating
  arc-reactor **orb**, press the shortcut, or use the command palette — one
  capture). Recognised speech runs a small **command grammar** —
  *"add a task… / remember… / journal… / brainstorm about… / brief me / start a
  25 minute timer / stop the timer / open the gallery / make it night / play
  music / launch <project>"* — and **anything it doesn't recognise becomes an Ask**,
  answered by your local `claude` CLI and **read back aloud**. A live caption and
  the orb's states (listening / armed / thinking / speaking) show what's going on.
  Configure the wake word, the speaking voice, rate, pitch, and the cue chime in
  the new **Console → Voice** tab. Voice is **off until you turn it on**, the mic
  only opens while you're listening, and it rests automatically when the tab is
  hidden.
- **Customizable keyboard shortcuts.** Every shortcut now lives in one registry
  and is **rebindable** — open **Console → Shortcuts** (`?`), click any binding,
  and press the new keys (Backspace clears, Esc cancels; conflicts are reassigned
  for you). Single-key "leader" shortcuts (`/`, `B`, `G`, `T`, `I`, `J`, `F`, `R`,
  `` ` ``, `M`, `S`, `?`) fire only when you're not typing; combos with Ctrl/⌘ or
  Alt work anywhere. Overrides persist locally; "Reset all" restores the defaults.
  The existing `Ctrl K` / `Ctrl '` / `/` bindings are unchanged.
- **Console overlay.** One glass panel with **Voice** and **Shortcuts** tabs,
  reachable from the command palette, the keyboard (`?` / `Ctrl ;`), and voice
  ("show shortcuts" / "voice settings").
- **Voice dictation — speak and it types.** Say *"take a note"* / *"dictate to
  Ask"* / *"dictate a task"*, press **`D`**, or click the new **mic button** on the
  Ask bar or the Journal composer, and your speech streams straight into the field
  with live interim text. **Spoken punctuation** ("period", "comma", "question
  mark", "new line", "new paragraph", "open/close paren", "dash", "open/close
  quote"…) becomes real marks, sentences auto-capitalize, and standalone "i" → "I".
  Say *"scratch that"* to drop the last phrase, *"clear"* to start over, *"stop"*
  to finish — the text stays in the field for you to edit and save. Smart
  punctuation is toggleable (Console → Voice).
- **A much smarter assistant.** New voice commands: **read-back** (*"what's on my
  plate?"*, *"what's next?"*, *"read my ideas"*, *"repeat that"* — spoken from your
  live data), **complete a task by name** (*"mark ship the notes done"*),
  **live voice tuning** (*"faster"*, *"slower"*, *"louder"*, *"quieter"* — persisted),
  and a **conversational follow-up window** (after an answer it stays armed a few
  seconds so a follow-up needs no wake word; hands-free only, toggleable). The orb
  gained a **dictating** state and the wake word now interrupts cleanly (barge-in).

### Changed
- The global keyboard handler is now a small **keymap dispatcher** driven by the
  registry above (same behaviour for the old shortcuts, plus the new ones). `Esc`
  also closes the Console.
- The command palette gained voice and shortcut entries (push-to-talk, hands-free,
  voice settings, keyboard shortcuts).

### Fixed
- **macOS downloads no longer hit a dead-end Gatekeeper block.** A zip downloaded
  in a browser is quarantined by macOS, and on Sequoia+ Gatekeeper refuses to run
  the unsigned launchers with **no "Open Anyway"** option — so first-run users were
  stuck. New **one-line Terminal installer** (`docs/install.sh`, surfaced on the
  site as `curl -fsSL …/install.sh | bash`) downloads and installs Oasis to
  `~/Applications/Oasis` *without* the quarantine flag (files fetched by `curl`
  aren't quarantined), so there's nothing to approve — no Apple Developer account
  or notarization required. It preserves existing `data/`/`assets/` on reinstall,
  drops a Desktop launcher, and opens the app. The marketing page leads macOS
  visitors with the copy-paste command (and a copy button); the zip stays as a
  fallback with an `xattr -dr com.apple.quarantine` + `chmod +x` recovery one-liner
  in `START HERE (macOS).txt` and the page. README / AGENTS / PUBLISH updated.

## [1.1.4] — 2026-06-14

### Added
- **Edit anything inline.** Ideas, tasks, and journal entries can now be edited in
  place — double-click a task or a journal entry, or use the new edit (pencil)
  button on an idea. (The server already accepted `PATCH … {text}`; the UI just
  never exposed it.)
- **One-click data backup.** A new **Back up my data** action (command palette, plus
  a **Back up data** button in Preferences) downloads everything in `data/` as one
  timestamped JSON file via `GET /api/export`. It stays on your machine — nothing is
  uploaded.
- **Finish an update without leaving the app.** After **Update now** applies, the
  banner now offers **Restart now**, which relaunches Oasis on the new version
  (`POST /api/update/restart`) instead of asking you to run a launcher by hand.
- First-run guidance in the **Relay** panel and a more helpful empty **Gallery**
  state; modal overlays (gallery, relay, setup) now expose `role="dialog"`.

### Fixed
- **A static-file I/O error can no longer crash the server.** `serveFromDir` now
  attaches an error handler to its read streams, so a file deleted or locked
  mid-read tears down that one response instead of taking the whole single Node
  process down with it (it serves every page load, so the blast radius was total).
- **One-AI-call-at-a-time is now race-free.** Ask / Spark / Relay read the request
  body *before* claiming the busy flag, so two near-simultaneous requests can't both
  slip past the check and launch concurrent CLI calls.
- **`GET /api/todos` can't 500 on older data** — the sort now tolerates a todo with
  a missing `created`/`order` field.
- **Self-update is safer and never stale.** The downloaded-zip self-update
  cache-busts the download URL (so a CDN/browser cache can't hand back a stale,
  same-named zip), backs up the current app files first, and **rolls back** if the
  in-place copy fails partway. A git-checkout update now reports "already up to date"
  on a no-op pull.

### Security
- **Image import is SSRF-filtered.** `importAsset` resolves the target host
  (re-checked on every redirect) and refuses loopback / private / link-local
  (incl. the `169.254.169.254` cloud-metadata address) / CGNAT / unspecified
  addresses, so a pasted or redirected URL can't reach an internal service.
- **Self-update and restart are Origin-gated.** `POST /api/update/apply` and the new
  `POST /api/update/restart` — the only routes that rewrite program files or restart
  the process — reject cross-origin requests with `403`.

### Changed
- **macOS launchers resolve symlinks.** `Launch`/`Restart Oasis.command` resolve the
  real script directory through the Desktop symlink before they `cd`, so a
  Desktop-launched Oasis starts in the right folder (it used to `cd` into `~/Desktop`
  and the server never started). Setup now also marks `Restart Oasis.command`
  executable.
- **One source of truth for the version.** The `VERSION` constant in `server.js` is
  authoritative; `package.ps1` stamps `docs/version.json` from it at build time, and
  `package.json` is back in sync.

## [1.1.0 – 1.1.3] — 2026-06-13 → 2026-06-14

These shipped incrementally as the first 1.1 series: **1.1.0** introduced the relay,
the embedded terminal, YouTube audio, the "Connect Claude & Codex" intake step, and
in-app updates; **1.1.1** was a UX-hardening pass; **1.1.2** made downloaded copies
self-update in place; **1.1.3** added the "Restart Oasis" launcher. They were never
tracked as separate sections, so they're grouped here.

### Added
- **In-app updates (user-initiated).** Oasis now knows its own version and can
  check for a newer one on demand — a **Check for updates** action in the command
  palette and in Preferences (which also shows the current version). When a newer
  release is published, a slim banner offers **Update now**: a git checkout runs
  `git pull`; a downloaded copy is pointed straight at the new zip. The check is
  manual only — it runs a single `GET` of the public release manifest
  (`docs/version.json`) when you ask, sends nothing about you, and never runs
  automatically. Backed by `GET /api/version`, `GET /api/update/check`, and
  `POST /api/update/apply`.
- **Connect Claude & Codex at intake.** The setup wizard gains a step that
  detects whether the `claude` and `codex` CLIs are installed and shows, live,
  whether Ask / Ideas / the daily briefing and the relay are ready. If one isn't
  found it gives the one-line install command and the sign-in step; a **Re-check**
  button re-probes after you install or log in. No API keys are entered — Oasis
  calls the CLI you're already signed into, and nothing about your plan leaves the
  machine. Backed by `GET /api/ai-status` (cached probes, `?fresh=1` to re-check).
- **YouTube in the music panel.** A new **YouTube** tab alongside Lo-Fi, Ambient,
  and Spotify. Paste any YouTube video, playlist, or mix link (also `youtu.be`,
  `music.youtube.com`, `/shorts`, `/live`, or a bare id) and it plays the audio
  through YouTube's privacy-mode `youtube-nocookie.com` embed. A few lo-fi/ambient
  presets are built in, and **Save current** keeps your own playlists and mixes
  under **Your YouTube** — persisted locally in `config.json` (`ytSaved`), with no
  Google sign-in or API key. Starting another source (radio/Spotify) stops it, and
  vice-versa, so only one thing ever plays.
- **Relay — Claude × Codex orchestration.** A new glass overlay (toolbar relay
  button, or the command palette) where the two models work a task together
  instead of one model working it alone. Two modes: **Delegate** (Claude
  architects → Codex builds & critiques → Claude refines → a clean synthesis) and
  **Debate** (the two argue opposing positions, then a neutral verdict). Each turn
  sees the running transcript and is told to disagree when it thinks the partner
  is wrong, so mistakes get caught. Pick 1–3 rounds; turns stream in live as each
  model responds; the final answer can be copied, captured as an idea, or handed
  to a live Claude terminal. Codex runs in a **read-only sandbox** with the prompt
  over stdin; if the `codex` CLI isn't installed, Claude runs both sides and the
  panel says so. Backed by a background job engine (`POST /api/relay`, polled via
  `GET /api/relay/:id`); runs are kept in `data/relays.json`.
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
- **Terminal opens small, compact, and frosted.** The embedded terminal now
  defaults to a compact window tucked into the bottom-right corner instead of a
  wide bottom strip. Because the surface is small, it can afford a frosted-glass
  `backdrop-filter` and still stay within the T570 budget — so it's opaque *and*
  glass, matching the rest of the UI. (Existing saved sizes reset once to the new
  default; resize freely from there.)
- **Terminal wears the Oasis brand.** The terminal window now carries the Oasis
  boat mark + wordmark and the sea-glass palette (aqua/coral accents, sea-depth
  body) so it reads as part of Oasis rather than a detached black terminal window.
- **Project dock is a drag-to-reorder strip.** The bottom dock is now a single,
  tidy scrolling row of project chips you can **drag to reorder** (the order
  persists). The per-chip folder button and the "+N more / less" expander are
  gone — just the projects and a single add (+).
- Redesigned the GitHub Pages marketing page (`docs/`) as a cinematic film over
  the real looping ocean video.

### Fixed
- **Updates actually update now.** A downloaded copy used to only *open* the new
  zip in the browser, so unless you manually replaced the folder a restart reran
  the old version. **Update now** now applies in place: the app fetches the latest
  zip, unpacks it with the OS's own tool, and overwrites its program files —
  **preserving your `data/` and `assets/`** — so the next restart runs the new
  version. (A git checkout still updates via `git pull`.) The marketing-page
  download links are also version-stamped (`?v=…`) so a re-download is never served
  a stale, same-named zip from the browser/CDN cache.
- **A real "Restart Oasis" launcher.** `Launch Oasis` only ever *reused* an
  already-running server (Node loads `server.js` once at startup), so after an
  update the old version kept serving until the process was truly killed — and a
  relaunch silently lost the port race to it. New **`Restart Oasis.bat`** /
  **`Restart Oasis.command`** stop whatever holds port 7777 and relaunch fresh, so
  an updated build actually loads. The post-update message now points to it.
- **UX hardening pass (from a multi-agent audit).** A batch of papercuts:
  - **Panels fail loudly, not silently.** Ideas / Today / Journal / dock loaders
    now show an inline "couldn't load" message (or a toast) instead of a blank or
    stale panel when a fetch fails, and writes (save idea/task/journal) surface a
    toast if the save didn't take.
  - **Escape closes everything.** The Setup/Preferences modal (which was a trap —
    only Back/Continue) and the embedded terminal dock now close on Escape and, for
    Preferences, on shade-click — matching every other panel.
  - **Keyboard & screen-reader access.** A global `:focus-visible` ring makes the
    focused control visible for keyboard users; the activity ticker and gallery
    thumbnails are now real, Enter/Space-activatable buttons; scene buttons got
    `aria-label`s, the answer area an `aria-live` region, and the lightbox a dialog
    role. The hidden shortcuts (Ctrl+K, Ctrl+', /) are now listed in the palette.
  - **Safer deletes & clearer feedback.** "Clear all ask history" now confirms
    first; idea/task/journal/relay deletes show a toast.
  - **Remembers where you were.** The left panel (Today/Ideas), the music tab, and
    the relay mode persist across reloads; the gallery shows a "Loading…" state.
  - **Smaller things:** the terminal WebSocket now reports connection errors; a
    dropped relay connection shows a "retrying…" note instead of freezing; relay
    polling sleeps with the rest of the app when the tab is hidden; and several
    controls (Spotify/YouTube Play, scene picker, saved-YouTube chips) gained the
    hover/focus states they were missing.
- **Ask answers can be dismissed.** The center answer area (answers, idea cards,
  and the daily briefing) had no close control, so once triggered it stayed put
  and crowded the dashboard. Every answer now carries a dismiss (×) button, and
  Escape clears it. A late response that arrives after you've dismissed (or
  started something else) is now discarded instead of popping the panel back open.
- **`codex` now works in the terminal (and the relay uses real Codex).** The
  OpenAI desktop install tucks the Codex CLI under
  `%LOCALAPPDATA%\OpenAI\Codex\bin\…` and doesn't put it on `PATH`, so typing
  `codex` failed even though Codex was installed. Oasis now finds the binary the
  desktop app actually uses (via `CODEX_CLI_PATH` in `~/.codex/config.toml`,
  preferring the newest versioned build over the stale top-level launcher),
  prepends its folder to the embedded terminal's `PATH`, and calls it by full
  path in the relay — so Claude and Codex can genuinely talk. Override with the
  `OASIS_CODEX_BIN` env var if your `codex` lives elsewhere.
- **"Silence" / Spotify default no longer force lo-fi.** Pressing play before
  picking a station (toolbar button or the "Music: play / pause" palette command)
  used to start lo-fi for *everyone*, even users who chose **Silence** at setup.
  It now only auto-starts an actual radio bank.
- **Preferences no longer reset your radio station.** Saving the setup/preferences
  wizard wrote `radioStation: 0` every time, silently discarding the station you'd
  landed on; it now preserves it.
- **"Hand to Claude" button shows on first paint.** The Today list rendered before
  the config (with `terminalEnabled`) had loaded, so the per-todo terminal button
  could be missing until the next refresh; the list now re-renders once config
  resolves.
- **Tightened the one-AI-call-at-a-time lock.** The shared lock's wait cap was
  shorter than the longest Codex turn (300s), so a slow turn could in theory
  release a queued call into a second concurrent CLI invocation; the cap now sits
  above the longest turn.

### Removed
- Dropped the unused `autoplay` config key, the vestigial `radioBank: 'spotify'`
  value the validator accepted but nothing produced, and a stale `meadowName`
  fallback left over from the Meadow→Oasis rename.

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

When you ship a user-visible change, bump the `VERSION` constant in `server.js`
(`package.ps1` propagates it to `docs/version.json`) and add a new
`## [x.y.z] — YYYY-MM-DD` section at the top of this file describing it.
