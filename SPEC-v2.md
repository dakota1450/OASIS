# Meadow v2 — "the studio in the grass" — build spec

Meadow v1 (current code in this folder) is a homepage that mostly *watches*
agent chats. v2 reorients it around **making**: idea generation, asset
generation, and a gallery — while keeping the lying-in-the-grass identity,
now rendered with real AI-generated photography instead of procedural SVG.

Hard constraints (unchanged from v1):
- Zero npm dependencies. Plain Node 24 (`http`, `fs`, `child_process`...), Windows 10.
- Server: `server.js`, port `Number(process.env.PORT) || 7777`, binds 127.0.0.1.
- Static frontend in `public/` (index.html, style.css, app.js — no frameworks).
- Data persisted as JSON files in `data/`.
- Target hardware is a ThinkPad T570 with integrated graphics: NO CSS
  `filter: blur()` on large animated elements, no heavy per-frame raster work.
  `backdrop-filter` on a handful of glass panels is fine. Canvas fx ~30fps cap.

## Backdrop (replaces ALL procedural scenery)

Four AI photos will exist at (16:9, ~2k wide, may not exist during the build —
reference them anyway):

- `public/assets/meadow-dawn.jpg`
- `public/assets/meadow-day.jpg`
- `public/assets/meadow-dusk.jpg`
- `public/assets/meadow-night.jpg`

Each is a POV shot lying in grass looking straight up: open sky center,
soft-focus grass framing all four edges. The UI floats on the open sky.

Frontend behavior:
- Two stacked full-bleed `<img>` layers; phase changes crossfade (1.5s) by
  swapping the hidden layer's src and fading. `object-fit: cover`, sized ~106%
  with -3% offsets so it can move without showing edges.
- Ken Burns: very slow scale 1.0→1.05 (~50s, ease-in-out, alternate).
- Mouse parallax (lerped, like v1): photo translates up to ~10px opposite the
  cursor; glass panels translate ~3px; gives the "turning your head" feel.
- Phase = dawn 5:00–7:30, day 7:30–17:30, dusk 17:30–20:45, night otherwise,
  recomputed every minute, manual override pill stays (bottom-right, subtle).
- KEEP the canvas fx overlay but ONLY: drifting dandelion seeds (day/dawn/dusk,
  ~10), fireflies (dusk/night, ~10), occasional shooting star (night). DELETE
  procedural stars, clouds, sun, moon, god rays, and ALL SVG grass code.
- A faint radial vignette div on top is fine (no filter).

## Layout v2 (desktop-first, 1920×1080 primary)

```
            greeting · clock (compact, top center)
                 ┌──────────────────────────┐
                 │  ✦  what are we making   │   ← THE SPARK BAR (hero, center,
                 │     today?               │      ~46% from top, max-w 720px)
                 └──────────────────────────┘
   [spark result cards fan in below the bar, up to 5, staggered]

 GARDEN (left rail, w~300px)              DARKROOM (right rail, w~340px)
 kept ideas as small cards                asset thumbnail grid (3 cols)

        ── ticker: one subtle line of recent agent activity ──
        [ dock: tool pills, bottom center, compact ]
```

- The photo is the star; glass is MORE transparent than v1 (bg rgba ~.06–.10),
  blur 22–26px, 1px rgba-white borders, radius ~28px, soft shadow. Night
  phase adds a darker inner tint for readability.
- Type: keep light "Segoe UI" for numbers/UI; use Georgia italic as an
  editorial accent for the spark placeholder, panel subtitles, empty states.
- Rails are calm: headers tiny uppercase letterspaced; content scrolls
  (thin scrollbars); panels do NOT bob — only a barely-there float on the
  spark bar (±4px, 9s). No rotation tilts in v2.
- Mobile/narrow (<900px): single column, rails stack below hero.

## Features & API contract

### 1. Spark — idea generation (server shells out to `claude -p`)

`POST /api/spark` body `{seed: string, mode: "ideas" | "expand" | "imageprompt"}`
- `ideas`: seed may be "" → 5 wild original ideas; else 5 ideas riffing on seed.
  Response: `{ok:true, items:[{title: string(<=60), blurb: string(<=160)}]}`
- `expand`: seed is an existing idea's text. Returns 4 items with FIXED titles:
  "MVP cut", "Wild version", "Money angle", "First build step" (blurbs specific
  to the idea).
- `imageprompt`: seed is an idea/asset description. Response
  `{ok:true, prompt: string}` — a single detailed cinematic image-generation
  prompt (subject, composition, lighting, mood, style, "no text") ready to
  paste into Claude/Higgsfield.
- Implementation: `spawn` claude via shell (`claude` resolves to the npm shim;
  use `{shell: true}`), args `['-p', fullPrompt]`, `stdio: ['ignore','pipe','pipe']`
  (stdin MUST be ignored — otherwise claude waits 3s for stdin). Timeout 120s
  then kill → `{ok:false, error:"spark timed out"}`. The fullPrompt must demand
  STRICT JSON ONLY output matching the response shape, no markdown fences.
  Parse defensively: slice from first `[`/`{` to last `]`/`}`, JSON.parse,
  validate shape; on failure `{ok:false, error:"could not parse"}`.
- Every successful batch appends `{at, seed, mode, items}` to `data/sparks.json`
  (keep last 100). `GET /api/sparks` returns last 20, newest first.
- Concurrency guard: one spark at a time; concurrent request → 429
  `{ok:false, error:"already sparking"}`.

### 2. Garden — ideas (evolution of v1 notes; keep `/api/notes` paths)

Note shape: `{id, text, created, pinned: bool, status: "seed"|"sprouting"|"ready", source: "me"|"spark"}`.
Old notes without status/source get defaults on read (`seed`, `me`).
- `GET /api/notes` → array.
- `POST /api/notes` `{text, source?}` → created note.
- `PATCH /api/notes/:id` accepts `{pinned?, text?, status?}` (validate status).
- `DELETE /api/notes/:id`.
Frontend: input at top of Garden rail ("plant an idea…"); spark cards' 🌱 keep
action POSTs with `source:"spark"` (text = `title — blurb`). Card shows status
dot; clicking the dot cycles seed→sprouting→ready. Pin ★ floats to top.
Spark-sourced cards get a tiny ✦ glyph.

### 3. Darkroom — asset gallery

- `GET /api/assets` → `{items:[{id, name, rel, mtime, sizeKB}]}` scanning two
  roots (recursive, depth ≤3): `C:\Users\T570\.codex\generated_images` and
  `<app>\assets` (create `<app>\assets` dir at boot). Image extensions only
  (.jpg .jpeg .png .webp .gif). Exclude `public/assets` backdrops. Sort mtime
  desc, cap 200. `id` = URL-safe base64 of absolute path.
- `GET /asset/:id` → decode, REJECT any path not under a scan root (resolve +
  prefix check), serve bytes with right content-type, `Cache-Control: max-age=3600`.
- `POST /api/assets/import` `{url}` → https only; download (follow ≤3
  redirects, 30MB cap, 60s timeout) to `assets/imported-<ts>.<ext>` (ext from
  content-type or url, default .jpg). → `{ok:true, name}` or `{ok:false,error}`.
- Frontend: 3-col square-thumb grid (`background-image` thumbs are fine,
  loading="lazy" if `<img>`); click → glass lightbox (big preview, filename,
  buttons: copy path, open containing folder, delete-from-disk is NOT allowed);
  small input row "paste an image URL to import…". "open folder" uses a new
  `POST /api/reveal` `{id}` → `explorer /select,"<path>"` (same root validation).

### 4. Ticker — agent activity (demoted from panel to one line)

`GET /api/activity` unchanged from v1 (claude+codex merged feed). Frontend
shows ONE line above the dock: `✳ design-studio — "title…" · 12m ago`,
crossfading to the next item every 6s, cycling the 12 most recent. Click
pauses/resumes. That's the only chat surface in v2.

### 5. Dock — tools (demoted from panel to dock)

`GET /api/tools`, `POST /api/launch`, `POST/DELETE /api/tools` unchanged from
v1 server code. Frontend: bottom-center row of pill buttons (name only,
max ~8 visible, then a "+N" overflow pill that expands upward into a glass
list). Click = primary action (bat > dev > url > folder); a tiny ⌂ glyph on
hover opens the folder. The v1 "+ add" custom tool form lives behind a tiny
"+" pill at the row's end.

### 6. Toasts, misc

- Keep v1 toast pattern. Clipboard copies use `navigator.clipboard.writeText`
  with a fallback `<textarea>` trick (clipboard API can fail on http://localhost
  in some browsers — fallback REQUIRED).
- Spark bar: Enter = ideas mode with input text; a "wild" ✦ button = ideas with
  empty seed; while sparking, the bar shows an animated shimmer + the input
  disabled; errors toast.
- Empty states are poetry, Georgia italic (e.g. Darkroom: "nothing developed
  yet — go make something").
- Everything must work with `fetch` against same-origin; no external CDNs,
  no web fonts, no internet assumptions.

## Division of labor

- BACKEND agent: rewrite `server.js` only. Keep v1's static file serving,
  MIME map, notes/tools/launch/activity code (improve freely), add spark,
  sparks, assets, asset, import, reveal. Do not touch `public/`.
- FRONTEND agent: rewrite `public/index.html`, `public/style.css`,
  `public/app.js` from scratch per this spec. Do not touch `server.js`.
- Old v1 code is reference, not gospel — keep its activity/launch logic ideas.
