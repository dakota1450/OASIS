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

const HOME = os.homedir();
const CLAUDE_PROJECTS = path.join(HOME, '.claude', 'projects');
const CODEX_INDEX = path.join(HOME, '.codex', 'session_index.jsonl');
const CODEX_IMAGES = path.join(HOME, '.codex', 'generated_images');
const DEFAULT_BUILD_DIR = path.join(HOME, 'Documents', 'build');

// Preferences, written by the first-run setup wizard. Defaults keep a fresh
// install working with zero configuration; the wizard only refines them.
const CONFIG_DEFAULTS = {
  name: '', buildDir: '', showActivity: true, defaultPhase: 'auto',
  radioBank: 'lofi', radioStation: 0, autoplay: false,
  spotifyClientId: '', setupDone: false,
};
function getConfig() { return { ...CONFIG_DEFAULTS, ...readJson(CONFIG_FILE, {}) }; }
function buildDir() { const c = getConfig(); return (c.buildDir && c.buildDir.trim()) ? c.buildDir.trim() : DEFAULT_BUILD_DIR; }

// Roots that /asset and /api/reveal are allowed to read from. Anything outside
// these (after path resolution) is rejected — guards against traversal.
const ASSET_ROOTS = [CODEX_IMAGES, ASSETS_DIR];

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
      title: cleanTitle(o.thread_name || '') || '(untitled thread)',
      lastActive: o.updated_at || null,
    }));
}

let activityCache = { at: 0, payload: null };
function getActivity() {
  if (!getConfig().showActivity) return { items: [], counts: { claude: 0, codex: 0 }, generatedAt: new Date().toISOString() };
  const now = Date.now();
  if (activityCache.payload && now - activityCache.at < 15000) return activityCache.payload;
  const claude = claudeActivity(40), codex = codexActivity(25);
  const items = [...claude, ...codex].filter((i) => i.lastActive)
    .sort((a, b) => b.lastActive.localeCompare(a.lastActive)).slice(0, 60);
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
      if (pkg.oasisName || pkg.meadowName) displayName = pkg.oasisName || pkg.meadowName;
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

// ---------- routing ----------

async function handleApi(req, res, url) {
  const seg = url.pathname.split('/').filter(Boolean); // ['api', ...]

  if (url.pathname === '/api/activity' && req.method === 'GET') return sendJson(res, 200, getActivity());

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
    return sendJson(res, 200, { ...cfg, defaultBuildDir: DEFAULT_BUILD_DIR, origin: `http://${host}` });
  }
  if (url.pathname === '/api/config' && req.method === 'POST') {
    const body = await readBody(req);
    const cfg = readJson(CONFIG_FILE, {});
    const str = (k) => { if (typeof body[k] === 'string') cfg[k] = body[k].trim(); };
    str('name'); str('buildDir'); str('spotifyClientId');
    if (['auto', 'dawn', 'day', 'dusk', 'night'].includes(body.defaultPhase)) cfg.defaultPhase = body.defaultPhase;
    if (['lofi', 'old', 'spotify', 'off'].includes(body.radioBank)) cfg.radioBank = body.radioBank;
    if (Number.isInteger(body.radioStation)) cfg.radioStation = body.radioStation;
    if (typeof body.showActivity === 'boolean') cfg.showActivity = body.showActivity;
    if (typeof body.autoplay === 'boolean') cfg.autoplay = body.autoplay;
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

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.error(`Oasis: port ${PORT} already in use.`); process.exit(1); }
  throw e;
});

server.listen(PORT, '127.0.0.1', () => console.log(`Oasis is open at http://localhost:${PORT}`));
