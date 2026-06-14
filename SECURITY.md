# Security

Oasis is a **local-first** app: it runs on your own machine, binds only to
`127.0.0.1`, stores everything in local files, and sends nothing about you
anywhere. This document describes the threat model, the guards that enforce it,
and how to report a problem. Agents editing the relevant code must preserve every
guard in [§ Guards](#guards-in-the-code).

## Model & assumptions

- **Trust boundary:** the loopback interface on a single user's machine. Oasis
  binds `127.0.0.1:7777` and is not intended to be reachable from the network.
  Do not bind `0.0.0.0`, add a public listener, or put it behind a tunnel without
  redesigning the auth story (there is none today — it relies on being
  loopback-only).
- **Local user is trusted.** Oasis runs with the user's own privileges and can
  launch their projects and read their AI session logs. It is not a sandbox.
- **The three real attack surfaces** are: (1) untrusted *content* the user pastes
  or imports (image URLs, custom tool targets, model output), (2) path handling
  for the files it serves, and (3) the **embedded terminal**, which spawns a real
  shell. All three are guarded below; the terminal is the highest-privilege one
  and is gated by Origin + a per-boot token on top of being loopback-only.
- **No accounts, no secrets at rest** beyond an optional Spotify *Client ID*
  (public by design; PKCE flow, no client secret). No passwords, no tokens phoned
  anywhere.

## Privacy

- **No telemetry. Nothing about the user leaves the machine.** Outbound traffic
  happens only when the user asks for it: (a) an image import from an `https` URL
  the user pastes, (b) the local `claude` / `codex` CLIs doing whatever they
  normally do, and (c) the music panel — internet radio streams plus the optional
  Spotify and YouTube integrations (Spotify embeds and the user's own Spotify
  login, `youtube-nocookie.com` embeds for pasted/saved links). No analytics, no
  beacons — nothing about *you* is ever sent anywhere.
- **Personal data stays local and out of git.** `data/` (notes, todos, journal,
  ask history, briefings, config) and `assets/*` (imported images) are
  `.gitignore`d. The distributed zip ships **empty** data — `package.ps1` stages
  fresh files so nothing personal is ever packaged or published.
- Oasis *reads* (never writes) Claude Code session logs
  (`~/.claude/projects/**/*.jsonl`) and the Codex index
  (`~/.codex/session_index.jsonl`) only to show recent-activity titles, on the
  same machine.

## Guards in the code

These are load-bearing. If you change the surrounding code, keep them intact.

### Path traversal — filesystem reads are root-jailed
- `ASSET_ROOTS = [ ~/.codex/generated_images, <app>/assets ]`.
- `/asset/:id` (`serveAsset`) and `/api/reveal` (`revealAsset`) decode the opaque
  base64 path id and call `underRoot(abs)`, which resolves the path and rejects
  anything not equal to / under an allowed root. Out-of-root → `403`.
- Static serving (`serveFromDir`) normalizes the path and prefix-checks it against
  the base directory before reading. Out-of-base → `403`.
- Never serve a caller-influenced path without one of these checks.

### Command injection — shell-outs are sanitized
- **`claude` prompts go over stdin, never argv.** `runClaude` spawns
  `claude -p` with `{ shell: true }` and writes the prompt to `stdin`, then ends
  it. No user/model text ever reaches the command line, so quotes, `$`, backticks,
  newlines, and braces can't break out.
- **`codex` (the relay's second model) is the same plus a sandbox.** `runCodex`
  spawns `codex exec --sandbox read-only --skip-git-repo-check` with the prompt
  over `stdin`. The read-only sandbox means a relay turn can reason and write text
  but **cannot edit files or run commands** — orchestration is thinking, not
  acting. The only thing interpolated into the command line is an internal temp
  path for `--output-last-message` (server-generated, never user input).
- **Custom tool targets are character-filtered.** `POST /api/tools` rejects any
  target containing `"`, `` ` ``, `$`, or a line break before it can be
  interpolated into a shell command via `osOpen`.
- **Launch is allow-listed.** `launchTool` only runs an action that the scanned
  tool actually advertises (`bat`/`dev`/`folder`/`url`); unknown ids/actions are
  rejected.

### Embedded terminal — gated command execution (`/term` WebSocket)
The terminal feature (optional `node-pty`) spawns a real interactive shell with
the user's privileges. WebSocket handshakes are **not** subject to CORS, so a
malicious page in the user's browser could otherwise open `ws://127.0.0.1:7777`
and spawn a shell. Three gates prevent that — keep all of them:
- **Loopback only** — the server still binds `127.0.0.1`; nothing off-machine can
  reach the socket.
- **Origin check** — `handleUpgrade` rejects any handshake whose `Origin` isn't
  Oasis's own page (`http://localhost:7777` / `http://127.0.0.1:7777`). Browsers
  always send a truthful `Origin` on WS handshakes, so a cross-origin page fails.
- **Per-boot token** — a random `WS_TOKEN` is minted in memory at startup and
  handed to the page only via `/api/config` (same-origin; a cross-origin page
  can't read the response). The handshake must echo it back, or the socket is
  destroyed.

The spawned command is **built server-side** from a small allow-list
(`shell`/`claude`/`codex`) — the client never sends a raw command line. A session
id is charset-validated (`/^[A-Za-z0-9-]{6,64}$/`) before it's typed into the
shell, and the working directory is resolved from the server's own session index,
never from a client-supplied path. The token does **not** turn this into a remote
auth story: it's an anti-CSRF measure, not a substitute for staying loopback-only.

### Untrusted content — input is bounded
- **Image import** (`importAsset`): `https` only, ≤3 redirects, 30 MB cap, 60s
  timeout, written into `assets/` only with a server-chosen filename.
- **Request bodies** are capped at 2 MB (`readBody`); oversized bodies destroy the
  connection.
- **Model output is never trusted** as code or markup — it's parsed defensively
  (`extractJson`, shape validation) and only ever rendered as text/markdown.
- **No delete-from-disk endpoint** exists for gallery assets, by design — the app
  can reveal a file but never remove a user's file.

### Availability
- A single `sparkBusy` flag serializes AI calls (Ask / Spark / briefing); extra
  concurrent requests get `429`, so a burst can't spawn many `claude` processes.

## Known limitations (accepted trade-offs)

- **No authentication** on the loopback server. Any process able to reach
  `127.0.0.1:7777` on the machine can use the API. This is acceptable for a
  single-user local tool and is the reason it must stay loopback-only.
- **No CSRF protection.** Same rationale — it's not exposed to the web. Don't
  embed Oasis in a remotely-hosted page.
- The app launches the user's scripts/projects and reads their session logs by
  design; it is not a security sandbox.

## Reporting a vulnerability

Oasis is a personal, free project with no public release process yet. If you find
a security issue, contact the maintainer directly at **pilkingtondakota@gmail.com**
rather than opening a public issue. Please include repro steps and the affected
file/endpoint.
