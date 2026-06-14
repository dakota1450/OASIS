// Oasis — a calm home base for people who build with AI.
// Local personal dashboard: Ask (claude -p), idea capture + inline develop,
// today's tasks, a journal, an image gallery, a daily briefing, a quiet ticker
// of recent agent activity, and a one-click tool dock.
// Zero npm dependencies. Node 18+, macOS & Windows.
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { exec, spawn } = require('child_process');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

// Open a file, folder, or URL with the OS's default handler.
function osOpen(target) {
  if (IS_WIN) return `start "" "${target}"`;
  if (IS_MAC) return `open "${target}"`;
  return `xdg-open "${target}"`;
}

const PORT = Number(process.env.PORT) || 7777;
const ROOT = __dirname;
// Bump on every release; the published docs/version.json carries the same number
// so a running copy can tell when a newer one has shipped. The update CHECK is
// user-initiated only (no automatic outbound, nothing phoned home — see SECURITY.md).
const VERSION = '1.1.2';
const UPDATE_MANIFEST = process.env.OASIS_UPDATE_MANIFEST || 'https://dakota1450.github.io/OASIS/version.json';
const PUBLIC_DIR = path.join(ROOT, 'public');
const SITE_DIR = path.join(ROOT, 'docs');                // marketing page (also the GitHub Pages site)
const DATA_DIR = path.join(ROOT, 'data');
const ASSETS_DIR = path.join(ROOT, 'assets');           // user/imported assets (NOT public/assets)
const NOTES_FILE = path.join(DATA_DIR, 'notes.json');
const TOOLS_FILE = path.join(DATA_DIR, 'tools.json');
const SPARKS_FILE = path.join(DATA_DIR, 'sparks.json');
const TODOS_FILE = path.join(DATA_DIR, 'todos.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const JOURNAL_FILE = path.join(DATA_DIR, 'journal.json');
const ASK_HISTORY_FILE = path.join(DATA_DIR, 'ask-history.json');
const BRIEFINGS_FILE = path.join(DATA_DIR, 'briefings.json');
const RELAYS_FILE = path.join(DATA_DIR, 'relays.json');       // Claude×Codex orchestration runs

const HOME = os.homedir();
const CLAUDE_PROJECTS = path.join(HOME, '.claude', 'projects');
const CODEX_INDEX = path.join(HOME, '.codex', 'session_index.jsonl');
const CODEX_IMAGES = path.join(HOME, '.codex', 'generated_images');
const DEFAULT_BUILD_DIR = path.join(HOME, 'Documents', 'build');

// Preferences, written by the first-run setup wizard. Defaults keep a fresh
// install working with zero configuration; the wizard only refines them.
const CONFIG_DEFAULTS = {
  name: '', buildDir: '', showActivity: true, defaultPhase: 'auto',
  radioBank: 'lofi', radioStation: 0,
  spotifyClientId: '', ytSaved: [], setupDone: false,
};
function getConfig() { return { ...CONFIG_DEFAULTS, ...readJson(CONFIG_FILE, {}) }; }
function buildDir() { const c = getConfig(); return (c.buildDir && c.buildDir.trim()) ? c.buildDir.trim() : DEFAULT_BUILD_DIR; }

// Roots that /asset and /api/reveal are allowed to read from. Anything outside
// these (after path resolution) is rejected — guards against traversal.
const ASSET_ROOTS = [CODEX_IMAGES, ASSETS_DIR];

// ---------- embedded terminal (the one optional native dependency) ----------
// node-pty is the SINGLE npm dependency and it is OPTIONAL: present → the glass
// terminal runs real interactive Claude/Codex/shell sessions over a PTY; absent
// → the app still boots and the terminal degrades (read transcript / pop out to
// the OS terminal). This is the one place Oasis steps outside the
// Node-stdlib-only rule — see AGENTS.md §3 and SECURITY.md.
let pty = null;
try { pty = require('node-pty'); } catch { pty = null; }
const TERMINAL_ENABLED = !!pty;

// Locate the Codex CLI. It frequently isn't on PATH — the OpenAI desktop install
// tucks `codex.exe` under %LOCALAPPDATA%\OpenAI\Codex\bin — which is exactly why
// `codex` "doesn't work" when typed in a terminal even though Codex is installed.
// We find it once and (a) prepend its dir to spawned shells' PATH so `codex`
// resolves in the embedded terminal, and (b) call it by full path in runCodex.
function findCodexBin() {
  const cands = [];
  if (process.env.OASIS_CODEX_BIN) cands.push(process.env.OASIS_CODEX_BIN);
  // The Codex desktop app records the exact CLI binary it currently uses in
  // config.toml (CODEX_CLI_PATH). Prefer it: the top-level bin\codex.exe is often
  // a STALE launcher that can't parse the newer config the app writes (e.g.
  // `service_tier = "priority"`), so it errors out — which looks like "codex
  // doesn't work" even though a working, newer binary sits right next to it.
  try {
    const cfg = fs.readFileSync(path.join(HOME, '.codex', 'config.toml'), 'utf8');
    const m = cfg.match(/CODEX_CLI_PATH\s*=\s*['"]([^'"]+)['"]/);
    if (m && m[1]) cands.push(m[1]);
  } catch {}
  if (IS_WIN) {
    const base = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    if (base) {
      // versioned subdirs (…\bin\<hash>\codex.exe), newest first, then the top-level launcher
      try {
        fs.readdirSync(base, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => ({ p: path.join(base, d.name, 'codex.exe'), m: (() => { try { return fs.statSync(path.join(base, d.name)).mtimeMs; } catch { return 0; } })() }))
          .sort((a, b) => b.m - a.m)
          .forEach((x) => cands.push(x.p));
      } catch {}
      cands.push(path.join(base, 'codex.exe'));
    }
    if (process.env.APPDATA) cands.push(path.join(process.env.APPDATA, 'npm', 'codex.cmd'));
    cands.push(path.join(HOME, '.cargo', 'bin', 'codex.exe'));
  } else {
    cands.push(path.join(HOME, '.codex', 'bin', 'codex'));
    cands.push('/usr/local/bin/codex', '/opt/homebrew/bin/codex');
    cands.push(path.join(HOME, '.local', 'bin', 'codex'), path.join(HOME, '.cargo', 'bin', 'codex'));
    if (IS_MAC) cands.push(path.join(HOME, 'Library', 'Application Support', 'Codex', 'bin', 'codex'));
  }
  for (const c of cands) { try { if (c && fs.existsSync(c)) return c; } catch {} }
  return null;
}
const CODEX_BIN = findCodexBin();

// Env for spawned shells/CLIs with our known tool dirs prepended to PATH, so
// `codex` (and friends) resolve even when the user's PATH doesn't include them.
function shellEnv() {
  const env = { ...process.env };
  const dirs = [];
  if (CODEX_BIN) dirs.push(path.dirname(CODEX_BIN));
  if (!dirs.length) return env;
  const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH';
  env[key] = dirs.join(path.delimiter) + path.delimiter + (env[key] || '');
  return env;
}
// Per-boot secret the page must echo on the WebSocket handshake. WebSockets are
// NOT subject to CORS, so a malicious page could otherwise open ws://127.0.0.1
// and spawn a shell. A cross-origin page can't read this token (same-origin
// policy on /api/config), so it can't authenticate the socket. Combined with
// the Origin check below it gates terminal access to Oasis's own page only.
const WS_TOKEN = crypto.randomBytes(16).toString('hex');
const WS_ORIGINS = new Set([`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

// ---------- small utils ----------

function ensureFiles() {
  for (const d of [DATA_DIR, ASSETS_DIR]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  if (!fs.existsSync(NOTES_FILE)) fs.writeFileSync(NOTES_FILE, '[]');
  if (!fs.existsSync(TOOLS_FILE)) fs.writeFileSync(TOOLS_FILE, '[]');
  if (!fs.existsSync(SPARKS_FILE)) fs.writeFileSync(SPARKS_FILE, '[]');
  if (!fs.existsSync(TODOS_FILE)) fs.writeFileSync(TODOS_FILE, '[]');
  if (!fs.existsSync(JOURNAL_FILE)) fs.writeFileSync(JOURNAL_FILE, '[]');
  if (!fs.existsSync(ASK_HISTORY_FILE)) fs.writeFileSync(ASK_HISTORY_FILE, '[]');
  if (!fs.existsSync(BRIEFINGS_FILE)) fs.writeFileSync(BRIEFINGS_FILE, '{}');
  if (!fs.existsSync(RELAYS_FILE)) fs.writeFileSync(RELAYS_FILE, '[]');
  if (!fs.existsSync(CONFIG_FILE)) fs.writeFileSync(CONFIG_FILE, '{}');
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2)); }
function newId() { return Date.now().toString(36) + crypto.randomBytes(3).toString('hex'); }

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 2e6) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function readHeadLines(file, maxBytes = 524288) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(maxBytes);
    const n = fs.readSync(fd, buf, 0, maxBytes, 0);
    const text = buf.subarray(0, n).toString('utf8');
    const lines = text.split('\n');
    if (n === maxBytes) lines.pop();
    return lines;
  } catch { return []; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

function cleanTitle(s) {
  if (typeof s !== 'string') return '';
  let t = s.replace(/^﻿/, '').replace(/^ï»¿/, '').replace(/\s+/g, ' ').trim();
  if (t.length > 110) t = t.slice(0, 107) + '…';
  return t;
}

// b64url of an absolute path → opaque asset id
const encId = (p) => Buffer.from(p, 'utf8').toString('base64url');
const decId = (id) => { try { return Buffer.from(id, 'base64url').toString('utf8'); } catch { return ''; } };
function underRoot(abs) {
  const r = path.resolve(abs);
  return ASSET_ROOTS.some((root) => { const rr = path.resolve(root); return r === rr || r.startsWith(rr + path.sep); });
}

// ---------- activity: Claude Code ----------

function acceptTitle(raw) {
  const text = cleanTitle(raw);
  const noise = !text || text.startsWith('<') || text.startsWith('Caveat:') ||
    text.startsWith('[Request') || text.startsWith('A session-scoped Stop hook') ||
    text.startsWith('This session is being continued');
  return noise ? '' : text;
}

function extractSessionMeta(file) {
  const lines = readHeadLines(file);
  let title = '', summary = '', cwd = '', scanned = 0;
  for (const line of lines) {
    if (scanned++ > 200) break;
    if (!line.trim()) continue;
    let obj; try { obj = JSON.parse(line); } catch { continue; }
    if (!cwd && obj.cwd) cwd = obj.cwd;
    if (!summary && obj.type === 'summary' && obj.summary) summary = cleanTitle(obj.summary);
    if (!title && obj.type === 'queue-operation' && obj.operation === 'enqueue' && typeof obj.content === 'string') {
      let text = obj.content.replace(/^[﻿\s]+/, '');
      if (text.startsWith('/')) text = text.replace(/^\/\S*\s*/, '');
      title = acceptTitle(text);
    }
    if (!title && obj.type === 'user' && obj.message && !obj.isSidechain) {
      const c = obj.message.content;
      let text = '';
      if (typeof c === 'string') text = c;
      else if (Array.isArray(c)) { const p = c.find((x) => x && x.type === 'text' && typeof x.text === 'string'); if (p) text = p.text; }
      if (text.startsWith('<command-name>')) { const m = text.match(/<command-args>([\s\S]*?)<\/command-args>/); text = m ? m[1] : ''; }
      title = acceptTitle(text);
    }
    if (summary && title && cwd) break;
  }
  return { title: summary || title, cwd };
}

function claudeActivity(limit) {
  let projectDirs = [];
  try {
    projectDirs = fs.readdirSync(CLAUDE_PROJECTS, { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => path.join(CLAUDE_PROJECTS, d.name));
  } catch { return []; }
  const files = [];
  for (const dir of projectDirs) {
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.jsonl') || e.name.startsWith('agent-')) continue;
      const full = path.join(dir, e.name);
      let st; try { st = fs.statSync(full); } catch { continue; }
      if (st.size < 200) continue;
      files.push({ full, mtime: st.mtimeMs, size: st.size });
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  const items = [];
  for (const f of files.slice(0, limit)) {
    const meta = extractSessionMeta(f.full);
    let project = '', isWorktree = false;
    if (meta.cwd) {
      if (meta.cwd.includes('.claude-worktrees')) {
        isWorktree = true;
        project = path.basename(meta.cwd.split(/[\\/]\.claude-worktrees[\\/]/)[0]);
      } else project = path.basename(meta.cwd);
    } else project = path.basename(path.dirname(f.full)).split('-').slice(-1)[0];
    items.push({
      source: 'claude', project, isWorktree,
      id: path.basename(f.full, '.jsonl'), cwd: meta.cwd || '',
      title: meta.title || '(untitled session)',
      lastActive: new Date(f.mtime).toISOString(),
    });
  }
  return items;
}

function codexActivity(limit) {
  let text; try { text = fs.readFileSync(CODEX_INDEX, 'utf8'); } catch { return []; }
  const byId = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let obj; try { obj = JSON.parse(line); } catch { continue; }
    if (!obj.id) continue;
    const prev = byId.get(obj.id);
    if (!prev || (obj.updated_at || '') > (prev.updated_at || '')) byId.set(obj.id, obj);
  }
  return [...byId.values()]
    .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
    .slice(0, limit)
    .map((o) => ({
      source: 'codex', project: 'Codex', isWorktree: false,
      id: o.id, cwd: typeof o.cwd === 'string' ? o.cwd : '',
      title: cleanTitle(o.thread_name || '') || '(untitled thread)',
      lastActive: o.updated_at || null,
    }));
}

let activityCache = { at: 0, payload: null };
// id -> { source, cwd } for recently-seen sessions. The terminal resolves a
// session's working directory from HERE (server-derived), never from the
// client, so a request can only resume a real session in its own project dir.
const SESSION_INDEX = new Map();
function getActivity() {
  if (!getConfig().showActivity) return { items: [], counts: { claude: 0, codex: 0 }, generatedAt: new Date().toISOString() };
  const now = Date.now();
  if (activityCache.payload && now - activityCache.at < 15000) return activityCache.payload;
  const claude = claudeActivity(40), codex = codexActivity(25);
  const items = [...claude, ...codex].filter((i) => i.lastActive)
    .sort((a, b) => b.lastActive.localeCompare(a.lastActive)).slice(0, 60);
  SESSION_INDEX.clear();
  for (const it of [...claude, ...codex]) if (it.id) SESSION_INDEX.set(it.id, { source: it.source, cwd: it.cwd || '' });
  const payload = { items, counts: { claude: claude.length, codex: codex.length }, generatedAt: new Date().toISOString() };
  activityCache = { at: now, payload };
  return payload;
}

// ---------- tools (the dock) ----------

let lastToolScan = [];
function scanTools() {
  const tools = [];
  const BASE = buildDir();
  let dirs = [];
  try { dirs = fs.readdirSync(BASE, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch {}
  for (const d of dirs) {
    if (d.name.startsWith('.')) continue;
    const dir = path.join(BASE, d.name);
    let entries = []; try { entries = fs.readdirSync(dir); } catch { continue; }
    // Platform launch script: a .bat on Windows, a .command/.sh on macOS/Linux.
    const isLaunch = (n) => IS_WIN ? /^launch.*\.bat$/i.test(n) : /^launch.*\.(command|sh)$/i.test(n);
    const isScript = (n) => IS_WIN ? /\.bat$/i.test(n) : /\.(command|sh)$/i.test(n);
    const bat = entries.find(isLaunch) || entries.find(isScript);
    let hasDev = false, displayName = d.name;
    if (entries.includes('package.json')) {
      const pkg = readJson(path.join(dir, 'package.json'), {});
      if (pkg.scripts && pkg.scripts.dev) hasDev = true;
      if (pkg.oasisName) displayName = pkg.oasisName;
    }
    let mtime = 0; try { mtime = fs.statSync(dir).mtimeMs; } catch {}
    const actions = [];
    if (bat) actions.push('bat');
    if (hasDev) actions.push('dev');
    actions.push('folder');
    tools.push({ id: 'b:' + d.name, name: displayName, kind: 'scanned', dir,
      bat: bat ? path.join(dir, bat) : null, actions, lastModified: new Date(mtime).toISOString() });
  }
  tools.sort((a, b) => b.lastModified.localeCompare(a.lastModified));
  const custom = readJson(TOOLS_FILE, []).map((t) => ({
    id: 'c:' + t.id, name: t.name, kind: 'custom', target: t.target,
    actions: [/^https?:\/\//i.test(t.target) ? 'url' : (/\.(bat|command|sh)$/i.test(t.target) ? 'bat' : 'folder')],
  }));
  lastToolScan = [...custom, ...tools];
  return lastToolScan;
}

function launchTool(id, action) {
  const tool = lastToolScan.find((t) => t.id === id);
  if (!tool) return { ok: false, error: 'unknown tool — refresh and retry' };
  if (!tool.actions.includes(action)) return { ok: false, error: 'action not available' };
  let cmd = null, cwd = tool.dir || ROOT;
  if (action === 'bat') {
    const b = tool.kind === 'custom' ? tool.target : tool.bat;
    cwd = path.dirname(b);
    if (IS_WIN) cmd = `start "" "${b}"`;
    else if (IS_MAC) cmd = /\.(command|sh)$/i.test(b) ? `chmod +x "${b}" 2>/dev/null; open "${b}"` : osOpen(b);
    else cmd = `sh "${b}"`;
  }
  else if (action === 'dev') {
    if (IS_WIN) cmd = `start "Oasis — ${tool.name}" cmd /k "npm run dev"`;
    else if (IS_MAC) {
      // Terminal's `do script` runs a fresh shell that does NOT inherit exec's
      // cwd, so we cd in — escaping any apostrophe in the path for the
      // single-quoted -e argument via the '\'' idiom.
      const q = cwd.replace(/'/g, "'\\''");
      cmd = `osascript -e 'tell application "Terminal" to do script "cd \\"${q}\\" && npm run dev"' -e 'tell application "Terminal" to activate'`;
    }
    // Linux: the spawned terminal inherits cwd from exec's options, so no cd
    // (which also removes the apostrophe-in-path quoting hazard).
    else cmd = `x-terminal-emulator -e sh -c 'npm run dev; exec sh' 2>/dev/null || xterm -e sh -c 'npm run dev; exec sh'`;
  }
  else if (action === 'folder') cmd = osOpen(tool.kind === 'custom' ? tool.target : tool.dir);
  else if (action === 'url') cmd = osOpen(tool.target);
  if (!cmd) return { ok: false, error: 'nothing to launch' };
  exec(cmd, { cwd, windowsHide: true }, () => {});
  return { ok: true };
}

// ---------- spark (claude -p idea generation) ----------

let sparkBusy = false;

function buildSparkPrompt(seed, mode) {
  const s = (seed || '').trim();
  if (mode === 'expand') {
    return `You are an idea-development partner. Take this idea and develop it along four fixed angles.
IDEA: ${s}
Return ONLY a JSON array of exactly 4 objects, no markdown, no commentary, in this exact order with these exact titles:
[{"title":"MVP cut","blurb":"the smallest version worth building, specific to this idea"},
 {"title":"Wild version","blurb":"the ambitious, surprising take"},
 {"title":"Money angle","blurb":"how it could make money or save money"},
 {"title":"First build step","blurb":"the very first concrete thing to build, today"}]
Each blurb <= 160 chars, concrete and specific to the idea. Output the JSON array only.`;
  }
  if (mode === 'imageprompt') {
    return `Turn this concept into ONE vivid image-generation prompt for a text-to-image model.
CONCEPT: ${s}
Cover subject, composition, lighting, color/mood, and art style. End with "no text". Keep it under 90 words.
Return ONLY a JSON object: {"prompt":"..."} — no markdown, no commentary.`;
  }
  // ideas
  const basis = s
    ? `Riff on this seed and generate 5 distinct ideas it inspires. Pull in different directions — don't give five flavors of the same thing.\nSEED: ${s}`
    : `Generate 5 original, surprising ideas worth making — apps, tools, art, products, experiments. Avoid clichés and anything that already exists in an obvious form.`;
  return `You are a sharp, fearless idea generator for a builder who ships fast. ${basis}
Each idea must be concrete enough to picture building, and genuinely different from the others. Favor specificity over buzzwords; no "AI-powered" filler.
Return ONLY a JSON array of exactly 5 objects, no markdown, no commentary:
[{"title":"short punchy name (<=60 chars)","blurb":"one vivid, specific sentence on what it is and why it's worth making (<=160 chars)"}]
Output the JSON array only.`;
}

function runClaude(prompt) {
  return new Promise((resolve) => {
    let out = '', err = '', done = false;
    // Pass the prompt on STDIN (not argv) so quotes/newlines/braces never touch
    // the Windows command line. Command is a single string → no arg-escaping warning.
    const child = spawn('claude -p', { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { if (!done) { done = true; try { child.kill(); } catch {} resolve({ ok: false, error: 'spark timed out' }); } }, 120000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ ok: false, error: 'could not run claude: ' + e.message }); } });
    child.on('close', () => { if (!done) { done = true; clearTimeout(timer); resolve({ ok: true, text: out, stderr: err }); } });
    try { child.stdin.write(prompt); child.stdin.end(); } catch {}
  });
}

// One model process at a time. Ask/Spark/briefing flip `sparkBusy` and 429 a
// collision outright; the relay (which fires many calls in a row) instead waits
// politely for the flag to clear, then claims it for the duration of one call.
// Shared lock = a Claude turn and a Codex turn can never run concurrently
// (concurrent CLI invocations are slow and racy — see AGENTS.md §9).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function aiAcquire() {
  let waited = 0;
  // Wait past the longest single CLI turn (codex: 300s) so a slow turn can never
  // release us early into a second concurrent invocation — the one-at-a-time invariant.
  while (sparkBusy) { await sleep(200); waited += 200; if (waited > 310000) break; }
  sparkBusy = true;
}
function aiRelease() { sparkBusy = false; }

// Run the local `codex` CLI non-interactively, mirroring runClaude. Prompt goes
// over STDIN (codex exec reads it there when no positional prompt is given), so
// quotes/newlines/braces never touch the command line. We pin a READ-ONLY
// sandbox so an orchestration "thinking" turn can never edit files or run
// commands, and capture only the final assistant message via
// --output-last-message (a temp file → no fragile stdout-log parsing). Codex may
// not be installed; callers detect that up front with probeCodex().
const CODEX_ARGS = 'exec --sandbox read-only --skip-git-repo-check --color never';
function runCodex(prompt) {
  return new Promise((resolve) => {
    const outFile = path.join(os.tmpdir(), 'oasis-codex-' + newId() + '.txt');
    let out = '', err = '', done = false;
    const bin = CODEX_BIN ? `"${CODEX_BIN}"` : 'codex';
    const child = spawn(`${bin} ${CODEX_ARGS} --output-last-message "${outFile}"`, { shell: true, stdio: ['pipe', 'pipe', 'pipe'], env: shellEnv() });
    const finish = (res) => { if (done) return; done = true; clearTimeout(timer); try { fs.unlinkSync(outFile); } catch {} resolve(res); };
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish({ ok: false, error: 'codex timed out' }); }, 300000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => finish({ ok: false, error: 'could not run codex: ' + e.message }));
    child.on('close', () => {
      let text = '';
      try { text = fs.readFileSync(outFile, 'utf8').trim(); } catch {}
      if (!text) text = (out || '').trim();                 // fallback if the flag is unsupported
      if (!text) return finish({ ok: false, error: (err || '').trim().split('\n')[0] || 'codex returned nothing' });
      finish({ ok: true, text });
    });
    try { child.stdin.write(prompt); child.stdin.end(); } catch {}
  });
}

// Is `codex` on PATH? Probe once and cache — the relay falls back to a
// Claude-only run (Claude wears both hats) when it isn't, and says so honestly.
let codexAvail = null;
function probeCodex() {
  if (codexAvail !== null) return Promise.resolve(codexAvail);
  if (CODEX_BIN) { codexAvail = true; return Promise.resolve(true); }   // found on disk → trust it
  return new Promise((resolve) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; codexAvail = v; resolve(v); } };
    let child; try { child = spawn('codex --version', { shell: true, stdio: 'ignore', env: shellEnv() }); } catch { return fin(false); }
    const t = setTimeout(() => { try { child.kill(); } catch {} fin(false); }, 6000);
    child.on('error', () => { clearTimeout(t); fin(false); });
    child.on('close', (code) => { clearTimeout(t); fin(code === 0); });
  });
}

// Is the `claude` CLI installed? (Powers Ask, Ideas-develop, the briefing, and the
// relay.) Same probe-once-and-cache shape as probeCodex; `claude --version` exits 0
// when present. This only confirms the CLI is on PATH — the user signs into their
// plan through the CLI itself; the AI features surface an auth error if they haven't.
let claudeAvail = null;
function probeClaude() {
  if (claudeAvail !== null) return Promise.resolve(claudeAvail);
  return new Promise((resolve) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; claudeAvail = v; resolve(v); } };
    let child; try { child = spawn('claude --version', { shell: true, stdio: 'ignore', env: shellEnv() }); } catch { return fin(false); }
    const t = setTimeout(() => { try { child.kill(); } catch {} fin(false); }, 6000);
    child.on('error', () => { clearTimeout(t); fin(false); });
    child.on('close', (code) => { clearTimeout(t); fin(code === 0); });
  });
}

// pull the first balanced JSON array/object out of model text
function extractJson(text, wantArray) {
  if (typeof text !== 'string') return null;
  const open = wantArray ? '[' : '{', close = wantArray ? ']' : '}';
  const start = text.indexOf(open);
  const end = text.lastIndexOf(close);
  if (start === -1 || end === -1 || end < start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

async function handleSpark(req, res) {
  if (sparkBusy) return sendJson(res, 429, { ok: false, error: 'already sparking' });
  const body = await readBody(req);
  const mode = ['ideas', 'expand', 'imageprompt'].includes(body.mode) ? body.mode : 'ideas';
  const seed = typeof body.seed === 'string' ? body.seed : '';
  if (mode !== 'ideas' && !seed.trim()) return sendJson(res, 400, { ok: false, error: 'seed required for ' + mode });
  sparkBusy = true;
  try {
    const result = await runClaude(buildSparkPrompt(seed, mode));
    if (!result.ok) return sendJson(res, 200, result);

    if (mode === 'imageprompt') {
      const obj = extractJson(result.text, false);
      const prompt = obj && typeof obj.prompt === 'string' ? obj.prompt.trim() : '';
      if (!prompt) return sendJson(res, 200, { ok: false, error: 'could not parse' });
      return sendJson(res, 200, { ok: true, prompt });
    }

    const arr = extractJson(result.text, true);
    if (!Array.isArray(arr)) return sendJson(res, 200, { ok: false, error: 'could not parse' });
    const items = arr
      .filter((x) => x && typeof x.title === 'string' && typeof x.blurb === 'string')
      .map((x) => ({ title: cleanTitle(x.title).slice(0, 60), blurb: cleanTitle(x.blurb).slice(0, 160) }));
    if (!items.length) return sendJson(res, 200, { ok: false, error: 'could not parse' });

    const log = readJson(SPARKS_FILE, []);
    log.unshift({ at: new Date().toISOString(), seed, mode, items });
    writeJson(SPARKS_FILE, log.slice(0, 100));
    return sendJson(res, 200, { ok: true, items });
  } finally {
    sparkBusy = false;
  }
}

// ---------- ask (claude -p, freeform answer — the main search bar) ----------

function buildAskPrompt(q) {
  return `You are a calm, sharp thinking partner living inside someone's personal dashboard called Oasis. Answer the user's question or request directly and usefully.
- Lead with the answer. No preamble, no "Great question", no restating the prompt.
- Use concise GitHub-flavoured markdown: short paragraphs, with bullet or numbered lists when they genuinely help.
- Be warm but economical — a few tight sentences beat an essay unless real depth is asked for.
QUESTION:
${q}`;
}
async function handleAsk(req, res) {
  if (sparkBusy) return sendJson(res, 429, { ok: false, error: 'still thinking on the last one' });
  const body = await readBody(req);
  const q = (typeof body.q === 'string' ? body.q : '').trim();
  if (!q) return sendJson(res, 400, { ok: false, error: 'ask something first' });
  sparkBusy = true;
  try {
    const result = await runClaude(buildAskPrompt(q));
    if (!result.ok) return sendJson(res, 200, result);
    const answer = (result.text || '').trim();
    if (!answer) return sendJson(res, 200, { ok: false, error: 'no answer came back' });
    const hist = readJson(ASK_HISTORY_FILE, []);
    hist.unshift({ id: newId(), q, answer, at: new Date().toISOString() });
    writeJson(ASK_HISTORY_FILE, hist.slice(0, 30));
    return sendJson(res, 200, { ok: true, answer });
  } finally {
    sparkBusy = false;
  }
}

// ---------- daily briefing (one cached claude -p insight per day) ----------

function localDateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function handleBriefing(req, res) {
  const key = localDateKey();
  const isToday = (iso) => { try { return localDateKey(new Date(iso)) === key; } catch { return false; } };
  const todos = readJson(TODOS_FILE, []);
  const journal = readJson(JOURNAL_FILE, []);
  const doneToday = todos.filter((t) => t.done && isToday(t.created)).length;
  const open = todos.filter((t) => !t.done).length;
  const jToday = journal.filter((j) => isToday(j.created));
  const moods = {}; jToday.forEach((j) => { if (j.mood) moods[j.mood] = (moods[j.mood] || 0) + 1; });
  const mood = Object.keys(moods).sort((a, b) => moods[b] - moods[a])[0] || '';
  const counts = getActivity().counts || { claude: 0, codex: 0 };
  const stats = { done: doneToday, open, journal: jToday.length, mood, claude: counts.claude || 0, codex: counts.codex || 0 };
  const cache = readJson(BRIEFINGS_FILE, {});
  if (cache[key] && cache[key].insight) return sendJson(res, 200, { ok: true, date: key, insight: cache[key].insight, stats });
  if (sparkBusy) return sendJson(res, 200, { ok: true, date: key, insight: '', stats, pending: true });
  sparkBusy = true;
  const prompt = `Write ONE warm, grounding sentence (max 22 words) reflecting on someone's day so far, in second person. No preamble, no quotes, no markdown, no numbers spelled out — just the sentence, and never mention "threads" or "sessions".
Signals to draw on (use only what's notable, don't list them): ${stats.done} task${stats.done === 1 ? '' : 's'} done today, ${stats.open} still open, ${stats.journal} journal entr${stats.journal === 1 ? 'y' : 'ies'}${mood ? `, feeling "${mood}"` : ''}.`;
  runClaude(prompt).then((result) => {
    sparkBusy = false;
    let insight = result.ok ? ((result.text || '').trim().split('\n').filter((l) => l.trim())[0] || '') : '';
    insight = insight.replace(/^["'\s]+|["'\s]+$/g, '').slice(0, 240);
    if (insight) { const c = readJson(BRIEFINGS_FILE, {}); c[key] = { insight, stats, generatedAt: new Date().toISOString() }; writeJson(BRIEFINGS_FILE, c); }
    sendJson(res, 200, { ok: true, date: key, insight, stats });
  }).catch(() => { sparkBusy = false; sendJson(res, 200, { ok: true, date: key, insight: '', stats }); });
}

// ---------- relay: Claude × Codex orchestration ----------
// Two models, passed a shared transcript, take turns to plan → build/critique →
// refine → synthesise (or debate → verdict). The point is to beat a single
// model: each turn sees what the other said and is told to disagree when it
// genuinely thinks the partner is wrong, so mistakes get caught. A relay fires
// many CLI calls in a row, so it runs as a background job — POST starts it and
// returns an id; the page polls GET /api/relay/:id for turns as they land.

let relayBusy = false;
const RELAY_JOBS = new Map();                 // id -> live job object (mutated in place)

function relayPersist(job) {
  const all = readJson(RELAYS_FILE, []);
  const i = all.findIndex((j) => j.id === job.id);
  if (i >= 0) all[i] = job; else all.unshift(job);
  writeJson(RELAYS_FILE, all.slice(0, 20));
}
function relayGet(id) { return RELAY_JOBS.get(id) || readJson(RELAYS_FILE, []).find((j) => j.id === id) || null; }

// Render the conversation so far for the next model's prompt. Labels are
// mode-aware; an errored turn is surfaced so the partner can route around it.
function relayTranscript(job) {
  if (!job.turns.length) return '(nothing yet — you open)';
  const label = (t) => {
    if (t.agent === 'codex') return 'CODEX';
    if (t.claimed === 'codex') return job.mode === 'debate' ? 'CHALLENGER (Claude)' : 'CRITIC (Claude)';
    return job.mode === 'debate' ? 'CLAUDE' : 'ARCHITECT (Claude)';
  };
  return job.turns.map((t) => {
    const body = t.error ? `(this turn failed: ${t.text})` : t.text;
    return `━━━━━ ${label(t)} · ${t.role} ━━━━━\n${body}`;
  }).join('\n\n');
}

// --- prompt builders (one per step kind) ---
const RP = {
  plan: (j) => `You are ARCHITECT, one half of a two-model engineering relay inside a local tool called Oasis. Your partner is CODEX — a sharp, independent coding model who will scrutinise your work, catch your mistakes, and build on it. Together you should beat what either of you could do alone.
Open the relay: turn the user's request into a crisp, concrete plan of attack.

USER REQUEST:
${j.task}

Give the approach in 1–2 sentences, the key steps, the main risks or unknowns, and what "done" looks like. Be specific and decisive — no hedging, no filler, no restating the request. Tight markdown.`,

  build: (j) => `You are CODEX, the implementer-critic in a two-model relay inside Oasis. Your partner is ARCHITECT (Claude). Read the exchange so far and PUSH THE WORK FORWARD: name concrete flaws, gaps, or wrong assumptions in the latest plan, fix them, and add the implementation detail — real code, commands, edge cases — that would make it actually work. Disagree when you genuinely think Architect is wrong; catching each other's mistakes is the entire point.

USER REQUEST:
${j.task}

CONVERSATION SO FAR:
${relayTranscript(j)}

Respond as CODEX. Be concrete and critical — improve on what's there, don't restate it.`,

  refine: (j) => `You are ARCHITECT (Claude) in a two-model relay with CODEX. Read CODEX's latest response. Where Codex is right, fold it in and say so; where Codex is wrong or missed something, push back and correct it. Converge toward one coherent, stronger approach — don't just agree to agree.

USER REQUEST:
${j.task}

CONVERSATION SO FAR:
${relayTranscript(j)}

Respond as ARCHITECT.`,

  synth: (j) => `You are closing out a two-model relay between ARCHITECT (Claude) and CODEX. Synthesise the WHOLE exchange into the single best, final answer to the user's request. Resolve any disagreement decisively, keep what both models got right, drop the dead ends. Do not mention the relay, the roles, or the process — just deliver the strongest possible answer, ready to act on.

USER REQUEST:
${j.task}

FULL CONVERSATION:
${relayTranscript(j)}

Write the final answer in clean markdown.`,

  open: (j) => `You are CLAUDE in a two-model debate inside Oasis, against CODEX. The debate exists to stress-test the answer so the user gets the truth, not a comfortable consensus.
Stake out your position on the user's question and argue it as well as you can.

USER QUESTION:
${j.task}

Give your answer and your strongest reasoning. Be specific and committed.`,

  counter: (j) => `You are CODEX in a two-model debate inside Oasis, against CLAUDE. Read what Claude argued, then take the strongest OPPOSING or alternative position you honestly can and make the case for it — expose weak assumptions, missing trade-offs, or better options. If Claude is simply right about something, name it, then attack the weakest remaining point. Don't roll over; the debate only helps if it's adversarial.

USER QUESTION:
${j.task}

CONVERSATION SO FAR:
${relayTranscript(j)}

Respond as CODEX.`,

  respond: (j) => `You are CLAUDE, continuing the debate with CODEX. Defend what holds up, concede what doesn't, and sharpen your position in light of Codex's challenge. Move toward the truth, not toward winning.

USER QUESTION:
${j.task}

CONVERSATION SO FAR:
${relayTranscript(j)}

Respond as CLAUDE.`,

  verdict: (j) => `Step out of both roles. You are now a neutral judge closing a debate between CLAUDE and CODEX. Weigh the whole exchange and deliver the verdict the user should walk away with: the best-supported answer, what each side got right, and where real uncertainty remains. Be decisive and honest. Don't narrate "the debate" — just give the clearest possible bottom line.

USER QUESTION:
${j.task}

FULL DEBATE:
${relayTranscript(j)}

Write the verdict in clean markdown.`,
};

const RELAY_STEPS = {
  plan:    { agent: 'claude', role: 'Plan',      critical: true,  prompt: RP.plan },
  build:   { agent: 'codex',  role: 'Build',     critical: false, prompt: RP.build },
  refine:  { agent: 'claude', role: 'Refine',    critical: false, prompt: RP.refine },
  synth:   { agent: 'claude', role: 'Synthesis', critical: false, prompt: RP.synth, final: true },
  open:    { agent: 'claude', role: 'Opening',   critical: true,  prompt: RP.open },
  counter: { agent: 'codex',  role: 'Counter',   critical: false, prompt: RP.counter },
  respond: { agent: 'claude', role: 'Response',  critical: false, prompt: RP.respond },
  verdict: { agent: 'claude', role: 'Verdict',   critical: false, prompt: RP.verdict, final: true },
};

function relaySteps(mode, rounds) {
  const s = [];
  if (mode === 'debate') {
    s.push(RELAY_STEPS.open);
    for (let r = 0; r < rounds; r++) { s.push(RELAY_STEPS.counter); s.push(RELAY_STEPS.respond); }
    s.push(RELAY_STEPS.verdict);
  } else {
    s.push(RELAY_STEPS.plan);
    for (let r = 0; r < rounds; r++) { s.push(RELAY_STEPS.build); s.push(RELAY_STEPS.refine); }
    s.push(RELAY_STEPS.synth);
  }
  return s;
}

// Serialise each model call through the shared AI lock (one process at a time).
async function relayAgentRun(agent, prompt) {
  await aiAcquire();
  try { return agent === 'codex' ? await runCodex(prompt) : await runClaude(prompt); }
  finally { aiRelease(); }
}

async function runRelay(job) {
  for (const step of relaySteps(job.mode, job.rounds)) {
    // A Codex step runs as Claude (clearly flagged) when codex isn't installed.
    const fallback = step.agent === 'codex' && !job.codexAvailable;
    const agent = fallback ? 'claude' : step.agent;
    const t0 = Date.now();
    const res = await relayAgentRun(agent, step.prompt(job));
    const turn = {
      agent, claimed: step.agent, role: step.role, final: !!step.final, fallback,
      at: new Date().toISOString(), ms: Date.now() - t0,
    };
    if (res.ok && (res.text || '').trim()) turn.text = res.text.trim();
    else { turn.text = res.error || 'no response'; turn.error = true; }
    job.turns.push(turn);
    relayPersist(job);
    if (turn.error && step.critical) { job.status = 'error'; job.error = turn.text; break; }
  }
  if (job.status !== 'error') job.status = 'done';
  job.finishedAt = new Date().toISOString();
  relayPersist(job);
}

async function handleRelay(req, res) {
  if (relayBusy) return sendJson(res, 429, { ok: false, error: 'a relay is already running' });
  const body = await readBody(req);
  const task = (typeof body.task === 'string' ? body.task : '').trim();
  if (!task) return sendJson(res, 400, { ok: false, error: 'describe the task first' });
  if (task.length > 6000) return sendJson(res, 400, { ok: false, error: 'task is too long (6000 char max)' });
  const mode = body.mode === 'debate' ? 'debate' : 'delegate';
  const rounds = Math.min(3, Math.max(1, parseInt(body.rounds, 10) || 1));
  relayBusy = true;
  let codexAvailable = false;
  try { codexAvailable = await probeCodex(); } catch {}
  const job = { id: newId(), task, mode, rounds, codexAvailable, status: 'running', turns: [], startedAt: new Date().toISOString() };
  if (RELAY_JOBS.size > 30) { const oldest = RELAY_JOBS.keys().next().value; RELAY_JOBS.delete(oldest); }
  RELAY_JOBS.set(job.id, job);
  relayPersist(job);
  runRelay(job)
    .catch((e) => { job.status = 'error'; job.error = String((e && e.message) || e); job.finishedAt = new Date().toISOString(); relayPersist(job); })
    .finally(() => { relayBusy = false; });
  return sendJson(res, 200, { ok: true, id: job.id, mode, rounds, codexAvailable });
}

// ---------- assets (the darkroom) ----------

function scanAssets() {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full, depth + 1); continue; }
      const ext = path.extname(e.name).toLowerCase();
      if (!IMAGE_EXT.has(ext)) continue;
      let st; try { st = fs.statSync(full); } catch { continue; }
      out.push({ id: encId(full), name: e.name, mtime: st.mtimeMs, sizeKB: Math.round(st.size / 1024) });
    }
  };
  for (const root of ASSET_ROOTS) walk(root, 0);
  out.sort((a, b) => b.mtime - a.mtime);
  return out.slice(0, 200).map((a) => ({ id: a.id, name: a.name, rel: '/asset/' + a.id,
    mtime: new Date(a.mtime).toISOString(), sizeKB: a.sizeKB }));
}

function serveAsset(res, id) {
  const abs = decId(id);
  if (!abs || !underRoot(abs)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(abs, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'max-age=3600' });
    res.end(data);
  });
}

function importAsset(url, cb, redirects = 0) {
  if (!/^https:\/\//i.test(url)) return cb({ ok: false, error: 'https url required' });
  if (redirects > 3) return cb({ ok: false, error: 'too many redirects' });
  let req;
  const to = setTimeout(() => { try { req.destroy(); } catch {} cb({ ok: false, error: 'import timed out' }); }, 60000);
  req = https.get(url, (resp) => {
    if ([301, 302, 303, 307, 308].includes(resp.statusCode) && resp.headers.location) {
      clearTimeout(to); resp.resume();
      return importAsset(new URL(resp.headers.location, url).href, cb, redirects + 1);
    }
    if (resp.statusCode !== 200) { clearTimeout(to); resp.resume(); return cb({ ok: false, error: 'http ' + resp.statusCode }); }
    const ct = (resp.headers['content-type'] || '').split(';')[0].trim();
    let ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }[ct];
    if (!ext) { const m = url.split('?')[0].match(/\.(jpe?g|png|webp|gif)$/i); ext = m ? '.' + m[1].toLowerCase() : '.jpg'; }
    const name = 'imported-' + Date.now() + ext;
    const dest = path.join(ASSETS_DIR, name);
    const file = fs.createWriteStream(dest);
    let size = 0, aborted = false;
    resp.on('data', (c) => { size += c.length; if (size > 30 * 1024 * 1024 && !aborted) { aborted = true; req.destroy(); file.destroy(); try { fs.unlinkSync(dest); } catch {} clearTimeout(to); cb({ ok: false, error: 'file too large (>30MB)' }); } });
    resp.pipe(file);
    file.on('finish', () => { if (aborted) return; clearTimeout(to); file.close(() => cb({ ok: true, name })); });
    file.on('error', () => { clearTimeout(to); try { fs.unlinkSync(dest); } catch {} cb({ ok: false, error: 'write failed' }); });
  });
  req.on('error', (e) => { clearTimeout(to); cb({ ok: false, error: e.message }); });
}

function revealAsset(id) {
  const abs = decId(id);
  if (!abs || !underRoot(abs)) return { ok: false, error: 'forbidden' };
  if (!fs.existsSync(abs)) return { ok: false, error: 'not found' };
  if (IS_WIN) exec(`explorer /select,"${abs}"`, () => {});
  else if (IS_MAC) exec(`open -R "${abs}"`, () => {});
  else exec(`xdg-open "${path.dirname(abs)}"`, () => {});
  return { ok: true };
}

// ---------- updates (user-initiated check against the published manifest) ----------
// A small GET of docs/version.json on the public site, only when the user clicks
// "Check for updates" — no automatic outbound, no data sent. A git checkout can
// self-update via `git pull`; a downloaded copy is pointed at the new zip.
const isGitCheckout = () => fs.existsSync(path.join(ROOT, '.git'));

function cmpVer(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d < 0 ? -1 : 1; }
  return 0;
}

function httpsGetText(url, cb, redirects = 0) {
  if (!/^https:\/\//i.test(url)) return cb(new Error('https only'));
  if (redirects > 3) return cb(new Error('too many redirects'));
  let req;
  const to = setTimeout(() => { try { if (req) req.destroy(); } catch {} cb(new Error('timed out')); }, 10000);
  req = https.get(url, { headers: { 'User-Agent': 'Oasis' } }, (resp) => {
    if ([301, 302, 303, 307, 308].includes(resp.statusCode) && resp.headers.location) {
      clearTimeout(to); resp.resume();
      return httpsGetText(new URL(resp.headers.location, url).href, cb, redirects + 1);
    }
    if (resp.statusCode !== 200) { clearTimeout(to); resp.resume(); return cb(new Error('http ' + resp.statusCode)); }
    let data = '', over = false;
    resp.on('data', (c) => { data += c; if (data.length > 1e6 && !over) { over = true; req.destroy(); clearTimeout(to); cb(new Error('too large')); } });
    resp.on('end', () => { if (!over) { clearTimeout(to); cb(null, data); } });
  });
  req.on('error', (e) => { clearTimeout(to); cb(e); });
}

function checkUpdate(cb) {
  httpsGetText(UPDATE_MANIFEST, (err, text) => {
    if (err) return cb({ ok: false, error: 'could not reach the update server', current: VERSION, isGit: isGitCheckout() });
    let m; try { m = JSON.parse(text); } catch { return cb({ ok: false, error: 'bad update manifest', current: VERSION, isGit: isGitCheckout() }); }
    const latest = String(m.version || '');
    const downloadUrl = (IS_WIN ? m.windows : IS_MAC ? m.macos : (m.windows || m.macos)) || '';
    cb({
      ok: true, current: VERSION, latest,
      updateAvailable: !!latest && cmpVer(latest, VERSION) > 0,
      notes: typeof m.notes === 'string' ? m.notes.slice(0, 300) : '',
      downloadUrl, isGit: isGitCheckout(),
    });
  });
}

// Download a URL to a file (https, ≤3 redirects, 150 MB cap, 120s) — for self-update.
function downloadTo(url, dest, cb, redirects = 0) {
  if (!/^https:\/\//i.test(url)) return cb(new Error('https only'));
  if (redirects > 3) return cb(new Error('too many redirects'));
  let req;
  const to = setTimeout(() => { try { if (req) req.destroy(); } catch {} cb(new Error('timed out')); }, 120000);
  req = https.get(url, { headers: { 'User-Agent': 'Oasis' } }, (resp) => {
    if ([301, 302, 303, 307, 308].includes(resp.statusCode) && resp.headers.location) {
      clearTimeout(to); resp.resume(); return downloadTo(new URL(resp.headers.location, url).href, dest, cb, redirects + 1);
    }
    if (resp.statusCode !== 200) { clearTimeout(to); resp.resume(); return cb(new Error('http ' + resp.statusCode)); }
    const file = fs.createWriteStream(dest);
    let size = 0, aborted = false;
    resp.on('data', (c) => { size += c.length; if (size > 150 * 1024 * 1024 && !aborted) { aborted = true; try { req.destroy(); file.destroy(); fs.unlinkSync(dest); } catch {} clearTimeout(to); cb(new Error('file too large')); } });
    resp.pipe(file);
    file.on('finish', () => { if (!aborted) { clearTimeout(to); file.close(() => cb(null)); } });
    file.on('error', (e) => { clearTimeout(to); try { fs.unlinkSync(dest); } catch {} cb(e); });
  });
  req.on('error', (e) => { clearTimeout(to); cb(e); });
}

// Unpack a zip with the OS's own tool (keeps us npm-dependency-free).
function extractZip(zipPath, dest, cb) {
  try { fs.mkdirSync(dest, { recursive: true }); } catch {}
  let cmd;
  if (IS_WIN) cmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${dest}' -Force"`;
  else if (IS_MAC) cmd = `ditto -x -k "${zipPath}" "${dest}"`;
  else cmd = `unzip -o "${zipPath}" -d "${dest}"`;
  exec(cmd, { windowsHide: true, timeout: 120000 }, (err) => cb(err || null));
}

// Self-update a DOWNLOADED (non-git) install: fetch the latest zip, unpack it, and
// copy the app files over this folder — PRESERVING the user's data/ and assets/
// (and node_modules/). Node doesn't hold a lock on the already-loaded server.js, so
// overwriting it is safe; the new code takes effect on the next restart.
const UPDATE_PRESERVE = new Set(['data', 'assets', 'node_modules', '.git']);
function applyDownloadUpdate(cb) {
  checkUpdate((info) => {
    if (!info.ok) return cb({ ok: false, error: info.error || 'could not check for an update', downloadUrl: info.downloadUrl || '' });
    if (!info.updateAvailable) return cb({ ok: false, error: 'already up to date', latest: info.latest });
    if (!info.downloadUrl) return cb({ ok: false, error: 'no download for this platform' });
    const id = newId();
    const zipPath = path.join(os.tmpdir(), 'oasis-update-' + id + '.zip');
    const exDir = path.join(os.tmpdir(), 'oasis-update-' + id);
    const cleanup = () => { try { fs.unlinkSync(zipPath); } catch {} try { fs.rmSync(exDir, { recursive: true, force: true }); } catch {} };
    const fail = (msg) => { cleanup(); cb({ ok: false, error: msg, downloadUrl: info.downloadUrl }); };
    downloadTo(info.downloadUrl, zipPath, (err) => {
      if (err) return fail('download failed: ' + err.message);
      extractZip(zipPath, exDir, (err2) => {
        if (err2) return fail('could not unpack the update');
        // The payload may land directly in exDir or inside one subfolder — find server.js.
        let src = exDir;
        if (!fs.existsSync(path.join(src, 'server.js'))) {
          try { for (const d of fs.readdirSync(exDir, { withFileTypes: true })) { if (d.isDirectory() && fs.existsSync(path.join(exDir, d.name, 'server.js'))) { src = path.join(exDir, d.name); break; } } } catch {}
        }
        if (!fs.existsSync(path.join(src, 'server.js')) || !fs.existsSync(path.join(src, 'public'))) return fail('update package looked wrong — nothing changed');
        try {
          fs.cpSync(src, ROOT, { recursive: true, force: true, filter: (s) => {
            const rel = path.relative(src, s);
            return !rel || !UPDATE_PRESERVE.has(rel.split(/[\\/]/)[0]);   // skip user data + node_modules
          } });
        } catch (e) { return fail('could not apply the update: ' + ((e && e.message) || e)); }
        cleanup();
        cb({ ok: true, restartNeeded: true, latest: info.latest });
      });
    });
  });
}

// ---------- terminal: PTY over a hand-rolled WebSocket ----------
// We implement RFC 6455 framing in stdlib (no `ws` dep). Browsers send each
// .send() as a single FIN=1 masked frame, so we treat one data frame as one
// message — enough for terminal I/O. Application protocol is tiny JSON:
//   client -> server : {t:'i',d} keystrokes · {t:'r',c,r} resize
//   server -> client : {t:'o',d} output      · {t:'x',code} exited

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
function wsAccept(key) { return crypto.createHash('sha1').update(key + WS_GUID).digest('base64'); }

// Encode an unmasked server->client frame.
function wsFrame(payload, opcode = 1) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  const len = data.length;
  let header;
  if (len < 126) { header = Buffer.alloc(2); header[1] = len; }
  else if (len < 65536) { header = Buffer.alloc(4); header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[1] = 127; header.writeUInt32BE(0, 2); header.writeUInt32BE(len, 6); }
  header[0] = 0x80 | (opcode & 0x0f);
  return Buffer.concat([header, data]);
}

// Buffering parser for masked client->server frames. Calls onMessage(Buffer)
// per data frame, onClose() on a close frame; replies to pings itself.
function wsParser(socket, onMessage, onClose) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f, offset = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); offset = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = buf.readUInt32BE(6); offset = 10; }
      let mask;
      if (masked) { if (buf.length < offset + 4) return; mask = buf.subarray(offset, offset + 4); offset += 4; }
      if (buf.length < offset + len) return;
      let payload = buf.subarray(offset, offset + len);
      if (masked) { const out = Buffer.alloc(len); for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3]; payload = out; }
      buf = buf.subarray(offset + len);
      if (opcode === 0x8) return onClose();                                   // close
      if (opcode === 0x9) { try { socket.write(wsFrame(payload, 0xA)); } catch {} continue; } // ping->pong
      if (opcode === 0x0 || opcode === 0x1 || opcode === 0x2) onMessage(payload); // continuation/text/binary
      // 0xA (pong) ignored
    }
  };
}

const safeSessionId = (s) => (typeof s === 'string' && /^[A-Za-z0-9-]{6,64}$/.test(s)) ? s : '';
function defaultShell() {
  if (IS_WIN) return 'powershell.exe';
  return process.env.SHELL || (IS_MAC ? '/bin/zsh' : '/bin/bash');
}

// Build the optional launch command typed into a fresh shell. `id` is already
// charset-validated; `cwd` is passed to pty.spawn (never shell-interpolated).
function terminalLaunchCommand(kind, id, source) {
  if (kind === 'claude') return id && source === 'claude' ? `claude --resume ${id}` : 'claude';
  if (kind === 'codex') return 'codex';
  return '';
}

function handleUpgrade(req, socket, head) {
  let url; try { url = new URL(req.url, `http://localhost:${PORT}`); } catch { return socket.destroy(); }
  if (url.pathname !== '/term') return socket.destroy();
  // Gate: feature on, our own page's Origin, and the per-boot token.
  if (!TERMINAL_ENABLED) return socket.destroy();
  if (!WS_ORIGINS.has(req.headers.origin)) return socket.destroy();
  if (url.searchParams.get('token') !== WS_TOKEN) return socket.destroy();
  const key = req.headers['sec-websocket-key'];
  if (!key) return socket.destroy();

  socket.write([
    'HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket',
    'Connection: Upgrade', `Sec-WebSocket-Accept: ${wsAccept(key)}`, '\r\n',
  ].join('\r\n'));
  socket.setTimeout(0); socket.setNoDelay(true);

  // Resolve what to run — kind from the client, cwd from OUR session index.
  const kind = ['shell', 'claude', 'codex'].includes(url.searchParams.get('kind')) ? url.searchParams.get('kind') : 'shell';
  const id = safeSessionId(url.searchParams.get('id'));
  getActivity();                                   // refresh SESSION_INDEX (cached)
  const known = id ? SESSION_INDEX.get(id) : null;
  // A resumed session opens in its own project; a fresh terminal opens in the
  // Oasis project itself (not the home folder), so it's "in the project".
  let cwd = known && known.cwd && fs.existsSync(known.cwd) ? known.cwd : ROOT;
  const launch = terminalLaunchCommand(kind, id, known && known.source);

  let term;
  try {
    term = pty.spawn(defaultShell(), [], {
      name: 'xterm-color', cols: 80, rows: 24, cwd, env: shellEnv(),
    });
  } catch (e) {
    try { socket.write(wsFrame(JSON.stringify({ t: 'o', d: `\r\n[oasis] could not start terminal: ${e.message}\r\n` }))); } catch {}
    return socket.destroy();
  }

  const send = (obj) => { try { socket.write(wsFrame(JSON.stringify(obj))); } catch {} };
  let launched = !launch;                          // type the launch command after the shell's first prompt
  term.onData((d) => {
    if (!launched) { launched = true; setTimeout(() => { try { term.write(launch + '\r'); } catch {} }, 140); }
    send({ t: 'o', d });
  });
  term.onExit(({ exitCode }) => { send({ t: 'x', code: exitCode }); try { socket.end(); } catch {} });

  let dead = false;
  const cleanup = () => { if (dead) return; dead = true; try { term.kill(); } catch {} try { socket.destroy(); } catch {} };
  const feed = wsParser(socket,
    (payload) => {
      let msg; try { msg = JSON.parse(payload.toString('utf8')); } catch { return; }
      if (msg.t === 'i' && typeof msg.d === 'string') { try { term.write(msg.d); } catch {} }
      else if (msg.t === 'r') { const c = msg.c | 0, r = msg.r | 0; if (c > 0 && r > 0) { try { term.resize(c, r); } catch {} } }
    },
    cleanup);
  if (head && head.length) feed(head);
  socket.on('data', feed);
  socket.on('close', cleanup);
  socket.on('error', cleanup);
}

// ---------- routing ----------

async function handleApi(req, res, url) {
  const seg = url.pathname.split('/').filter(Boolean); // ['api', ...]

  if (url.pathname === '/api/activity' && req.method === 'GET') return sendJson(res, 200, getActivity());

  // ai-status — which CLIs are installed, so intake can guide the user. `?fresh=1`
  // clears the cache so a "Re-check" picks up a just-finished install/sign-in.
  if (url.pathname === '/api/ai-status' && req.method === 'GET') {
    if (url.searchParams.get('fresh')) { claudeAvail = null; codexAvail = null; }
    const [claude, codex] = await Promise.all([probeClaude(), probeCodex()]);
    return sendJson(res, 200, { claude, codex, codexBin: CODEX_BIN || null });
  }

  // updates — version + user-initiated check/apply
  if (url.pathname === '/api/version' && req.method === 'GET') return sendJson(res, 200, { version: VERSION, isGit: isGitCheckout() });
  if (url.pathname === '/api/update/check' && req.method === 'GET') return checkUpdate((r) => sendJson(res, 200, r));
  if (url.pathname === '/api/update/apply' && req.method === 'POST') {
    if (isGitCheckout()) {
      return exec('git pull --ff-only', { cwd: ROOT, windowsHide: true, timeout: 60000 }, (err, stdout, stderr) => {
        if (err) return sendJson(res, 200, { ok: false, error: ((stderr || err.message || 'git pull failed') + '').split('\n')[0] });
        return sendJson(res, 200, { ok: true, output: ((stdout || '') + '').slice(0, 500), restartNeeded: true });
      });
    }
    return applyDownloadUpdate((r) => sendJson(res, 200, r));   // downloaded copy: fetch + unpack + overwrite in place
  }

  // notes
  if (url.pathname === '/api/notes' && req.method === 'GET') {
    const notes = readJson(NOTES_FILE, []).map((n) => ({
      pinned: false, status: 'seed', source: 'me', sprouting_at: null, ready_at: null, ...n,
    }));
    return sendJson(res, 200, notes);
  }
  if (url.pathname === '/api/notes' && req.method === 'POST') {
    const body = await readBody(req);
    const text = (body.text || '').trim();
    if (!text) return sendJson(res, 400, { error: 'empty note' });
    const source = body.source === 'spark' ? 'spark' : 'me';
    const notes = readJson(NOTES_FILE, []);
    const note = { id: newId(), text, created: new Date().toISOString(), pinned: false, status: 'seed', source };
    notes.unshift(note);
    writeJson(NOTES_FILE, notes);
    return sendJson(res, 200, note);
  }
  if (seg[0] === 'api' && seg[1] === 'notes' && seg[2] && req.method === 'PATCH') {
    const body = await readBody(req);
    const notes = readJson(NOTES_FILE, []);
    const note = notes.find((n) => n.id === seg[2]);
    if (!note) return sendJson(res, 404, { error: 'not found' });
    if (typeof body.pinned === 'boolean') note.pinned = body.pinned;
    if (typeof body.text === 'string' && body.text.trim()) note.text = body.text.trim();
    if (['seed', 'sprouting', 'ready'].includes(body.status)) {
      note.status = body.status;
      if (body.status === 'sprouting' && !note.sprouting_at) note.sprouting_at = new Date().toISOString();
      if (body.status === 'ready' && !note.ready_at) note.ready_at = new Date().toISOString();
    }
    writeJson(NOTES_FILE, notes);
    return sendJson(res, 200, note);
  }
  if (seg[0] === 'api' && seg[1] === 'notes' && seg[2] && req.method === 'DELETE') {
    writeJson(NOTES_FILE, readJson(NOTES_FILE, []).filter((n) => n.id !== seg[2]));
    return sendJson(res, 200, { ok: true });
  }

  // ask — the main search bar (freeform AI answer)
  if (url.pathname === '/api/ask' && req.method === 'POST') return handleAsk(req, res);
  if (url.pathname === '/api/ask-history' && req.method === 'GET') return sendJson(res, 200, readJson(ASK_HISTORY_FILE, []).slice(0, 30));
  if (url.pathname === '/api/ask-history' && req.method === 'DELETE') { writeJson(ASK_HISTORY_FILE, []); return sendJson(res, 200, { ok: true }); }
  if (seg[0] === 'api' && seg[1] === 'ask-history' && seg[2] && req.method === 'DELETE') { writeJson(ASK_HISTORY_FILE, readJson(ASK_HISTORY_FILE, []).filter((h) => h.id !== seg[2])); return sendJson(res, 200, { ok: true }); }
  if (url.pathname === '/api/briefing' && req.method === 'GET') return handleBriefing(req, res);

  // spark
  if (url.pathname === '/api/spark' && req.method === 'POST') return handleSpark(req, res);
  if (url.pathname === '/api/sparks' && req.method === 'GET') {
    return sendJson(res, 200, readJson(SPARKS_FILE, []).slice(0, 20));
  }

  // relay — Claude × Codex orchestration (background job + polling)
  if (url.pathname === '/api/relay' && req.method === 'POST') return handleRelay(req, res);
  if (seg[0] === 'api' && seg[1] === 'relay' && seg[2] && req.method === 'GET') {
    const job = relayGet(seg[2]);
    return job ? sendJson(res, 200, job) : sendJson(res, 404, { error: 'no such relay' });
  }
  if (url.pathname === '/api/relays' && req.method === 'GET') {
    const items = readJson(RELAYS_FILE, []).map((j) => ({
      id: j.id, task: j.task, mode: j.mode, rounds: j.rounds, status: j.status,
      codexAvailable: j.codexAvailable, turns: (j.turns || []).length,
      startedAt: j.startedAt, finishedAt: j.finishedAt || null,
    }));
    return sendJson(res, 200, items);
  }
  if (seg[0] === 'api' && seg[1] === 'relays' && seg[2] && req.method === 'DELETE') {
    RELAY_JOBS.delete(seg[2]);
    writeJson(RELAYS_FILE, readJson(RELAYS_FILE, []).filter((j) => j.id !== seg[2]));
    return sendJson(res, 200, { ok: true });
  }

  // assets
  if (url.pathname === '/api/assets' && req.method === 'GET') return sendJson(res, 200, { items: scanAssets() });
  if (url.pathname === '/api/assets/import' && req.method === 'POST') {
    const body = await readBody(req);
    return importAsset((body.url || '').trim(), (r) => sendJson(res, r.ok ? 200 : 400, r));
  }
  if (url.pathname === '/api/reveal' && req.method === 'POST') {
    const body = await readBody(req);
    const r = revealAsset(body.id);
    return sendJson(res, r.ok ? 200 : 400, r);
  }

  // todos — the running list
  if (url.pathname === '/api/todos' && req.method === 'GET') {
    const todos = readJson(TODOS_FILE, []).sort((a, b) => (a.order - b.order) || a.created.localeCompare(b.created));
    return sendJson(res, 200, todos);
  }
  if (url.pathname === '/api/todos' && req.method === 'POST') {
    const body = await readBody(req);
    const text = (body.text || '').trim();
    if (!text) return sendJson(res, 400, { error: 'empty todo' });
    const todos = readJson(TODOS_FILE, []);
    const order = todos.reduce((m, t) => Math.max(m, t.order || 0), 0) + 1;
    const todo = { id: newId(), text, done: false, created: new Date().toISOString(), order };
    todos.push(todo);
    writeJson(TODOS_FILE, todos);
    return sendJson(res, 200, todo);
  }
  if (url.pathname === '/api/todos/reorder' && req.method === 'POST') {
    const body = await readBody(req);
    const ids = Array.isArray(body.ids) ? body.ids : [];
    const todos = readJson(TODOS_FILE, []);
    ids.forEach((id, i) => { const t = todos.find((x) => x.id === id); if (t) t.order = i; });
    writeJson(TODOS_FILE, todos);
    return sendJson(res, 200, { ok: true });
  }
  if (seg[0] === 'api' && seg[1] === 'todos' && seg[2] && req.method === 'PATCH') {
    const body = await readBody(req);
    const todos = readJson(TODOS_FILE, []);
    const todo = todos.find((t) => t.id === seg[2]);
    if (!todo) return sendJson(res, 404, { error: 'not found' });
    if (typeof body.done === 'boolean') todo.done = body.done;
    if (typeof body.text === 'string' && body.text.trim()) todo.text = body.text.trim();
    if (typeof body.order === 'number') todo.order = body.order;
    writeJson(TODOS_FILE, todos);
    return sendJson(res, 200, todo);
  }
  if (seg[0] === 'api' && seg[1] === 'todos' && seg[2] && req.method === 'DELETE') {
    writeJson(TODOS_FILE, readJson(TODOS_FILE, []).filter((t) => t.id !== seg[2]));
    return sendJson(res, 200, { ok: true });
  }

  // journal — dated reflective entries
  if (url.pathname === '/api/journal' && req.method === 'GET') {
    const items = readJson(JOURNAL_FILE, []).sort((a, b) => (b.created || '').localeCompare(a.created || ''));
    return sendJson(res, 200, items);
  }
  if (url.pathname === '/api/journal' && req.method === 'POST') {
    const body = await readBody(req);
    const text = (body.text || '').trim();
    if (!text) return sendJson(res, 400, { error: 'empty entry' });
    const items = readJson(JOURNAL_FILE, []);
    const entry = { id: newId(), text, mood: typeof body.mood === 'string' ? body.mood.slice(0, 24) : '', created: new Date().toISOString() };
    items.unshift(entry);
    writeJson(JOURNAL_FILE, items);
    return sendJson(res, 200, entry);
  }
  if (seg[0] === 'api' && seg[1] === 'journal' && seg[2] && req.method === 'PATCH') {
    const body = await readBody(req);
    const items = readJson(JOURNAL_FILE, []);
    const e = items.find((x) => x.id === seg[2]);
    if (!e) return sendJson(res, 404, { error: 'not found' });
    if (typeof body.text === 'string' && body.text.trim()) e.text = body.text.trim();
    if (typeof body.mood === 'string') e.mood = body.mood.slice(0, 24);
    writeJson(JOURNAL_FILE, items);
    return sendJson(res, 200, e);
  }
  if (seg[0] === 'api' && seg[1] === 'journal' && seg[2] && req.method === 'DELETE') {
    writeJson(JOURNAL_FILE, readJson(JOURNAL_FILE, []).filter((x) => x.id !== seg[2]));
    return sendJson(res, 200, { ok: true });
  }

  // config — preferences set by the setup wizard
  if (url.pathname === '/api/config' && req.method === 'GET') {
    const cfg = getConfig();
    const host = (req.headers.host || `localhost:${PORT}`);
    return sendJson(res, 200, { ...cfg, defaultBuildDir: DEFAULT_BUILD_DIR, origin: `http://${host}`,
      terminalEnabled: TERMINAL_ENABLED, wsToken: WS_TOKEN, projectName: path.basename(ROOT) });
  }
  if (url.pathname === '/api/config' && req.method === 'POST') {
    const body = await readBody(req);
    const cfg = readJson(CONFIG_FILE, {});
    const str = (k) => { if (typeof body[k] === 'string') cfg[k] = body[k].trim(); };
    str('name'); str('buildDir'); str('spotifyClientId');
    if (['auto', 'dawn', 'day', 'dusk', 'night'].includes(body.defaultPhase)) cfg.defaultPhase = body.defaultPhase;
    if (['lofi', 'old', 'off'].includes(body.radioBank)) cfg.radioBank = body.radioBank;
    if (Number.isInteger(body.radioStation)) cfg.radioStation = body.radioStation;
    if (typeof body.showActivity === 'boolean') cfg.showActivity = body.showActivity;
    // Saved YouTube playlists/mixes ("Your YouTube"). Re-validated client-side
    // (parseYouTube) before they ever become an iframe src; never shell-touched.
    if (Array.isArray(body.ytSaved)) {
      cfg.ytSaved = body.ytSaved
        .filter((x) => x && typeof x.url === 'string' && x.url.trim())
        .slice(0, 24)
        .map((x) => ({ name: String(x.name || '').slice(0, 80), url: x.url.trim().slice(0, 400) }));
    }
    if (typeof body.setupDone === 'boolean') cfg.setupDone = body.setupDone;
    writeJson(CONFIG_FILE, cfg);
    return sendJson(res, 200, { ok: true, config: { ...CONFIG_DEFAULTS, ...cfg } });
  }

  // tools
  if (url.pathname === '/api/tools' && req.method === 'GET') return sendJson(res, 200, scanTools());
  if (url.pathname === '/api/tools' && req.method === 'POST') {
    const body = await readBody(req);
    const name = (body.name || '').trim(), target = (body.target || '').trim();
    if (!name || !target) return sendJson(res, 400, { error: 'name and target required' });
    // The target is later interpolated into a shell command (osOpen). Reject the
    // characters that could break out of the quoting / trigger substitution, so a
    // pasted path or URL can't smuggle in a command. Normal paths/URLs don't use these.
    if (/["`$\r\n]/.test(target)) return sendJson(res, 400, { error: 'target can\'t contain " ` $ or line breaks' });
    const custom = readJson(TOOLS_FILE, []);
    custom.unshift({ id: newId(), name, target });
    writeJson(TOOLS_FILE, custom);
    return sendJson(res, 200, { ok: true });
  }
  if (seg[0] === 'api' && seg[1] === 'tools' && seg[2] && req.method === 'DELETE') {
    const custom = readJson(TOOLS_FILE, []);
    writeJson(TOOLS_FILE, custom.filter((t) => 'c:' + t.id !== seg[2] && t.id !== seg[2]));
    return sendJson(res, 200, { ok: true });
  }
  if (url.pathname === '/api/launch' && req.method === 'POST') {
    const body = await readBody(req);
    if (!lastToolScan.length) scanTools();
    const r = launchTool(body.id, body.action);
    return sendJson(res, r.ok ? 200 : 400, r);
  }

  sendJson(res, 404, { error: 'no such endpoint' });
}

function serveFromDir(res, baseDir, relPath, req) {
  let rel = decodeURIComponent(relPath || '/');
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(baseDir, rel));
  if (file !== baseDir && !file.startsWith(baseDir + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req && req.headers && req.headers.range;
    const m = range && /^bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end = m[2] ? parseInt(m[2], 10) : st.size - 1;
      if (isNaN(start) || start < 0) start = 0;
      if (isNaN(end) || end >= st.size) end = st.size - 1;
      if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(file).pipe(res);
  });
}
function serveStatic(req, res, url) { serveFromDir(res, PUBLIC_DIR, url.pathname, req); }

ensureFiles();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith('/asset/')) serveAsset(res, url.pathname.slice('/asset/'.length));
    else if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else if (url.pathname === '/site' || url.pathname.startsWith('/site/')) serveFromDir(res, SITE_DIR, url.pathname.replace(/^\/site/, '') || '/index.html');
    else serveStatic(req, res, url);
  } catch (e) {
    sendJson(res, 500, { error: String(e && e.message || e) });
  }
});

server.on('upgrade', (req, socket, head) => {
  try { handleUpgrade(req, socket, head); } catch { try { socket.destroy(); } catch {} }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.error(`Oasis: port ${PORT} already in use.`); process.exit(1); }
  throw e;
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Oasis is open at http://localhost:${PORT}`);
  console.log(TERMINAL_ENABLED ? 'Terminal: enabled (node-pty loaded)' : 'Terminal: disabled (node-pty not installed)');
  console.log(CODEX_BIN ? `Codex CLI: ${CODEX_BIN} (added to terminal PATH)` : 'Codex CLI: relying on PATH (set OASIS_CODEX_BIN if `codex` is elsewhere)');
});
