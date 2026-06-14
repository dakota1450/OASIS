/* Oasis — front-end. A calm place to ask, build, and reflect.
 * No emoji: every glyph is an inline SVG from the sprite in index.html. */
'use strict';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name) => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

function relTime(iso) {
  if (!iso) return '';
  const d = new Date(iso), s = (Date.now() - d.getTime()) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400 && d.getDate() === new Date().getDate()) return `${Math.round(s / 3600)}h ago`;
  if (s < 172800) return 'yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function fmtStamp(iso) { try { return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return ''; } }
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    try { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch { return false; }
  }
}
let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400); }

/* ---- tiny, safe markdown renderer (for Ask answers) ---- */
function mdInline(s) {
  return s
    .replace(/`([^`]+)`/g, (m, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
function md(src) {
  const e = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  src = e(String(src || ''));
  const blocks = [];
  src = src.replace(/```(\w*)\n?([\s\S]*?)```/g, (m, lang, code) => { blocks.push(code.replace(/\n+$/, '')); return `@CB@${blocks.length - 1}@CB@`; });
  const lines = src.split('\n'); let html = '', i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const ph = line.match(/^@CB@(\d+)@CB@$/);
    if (ph) { html += `<pre><code>${blocks[+ph[1]]}</code></pre>`; i++; continue; }
    if (/^\s*$/.test(line)) { i++; continue; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { const lv = Math.min(h[1].length + 1, 4); html += `<h${lv}>${mdInline(h[2])}</h${lv}>`; i++; continue; }
    if (/^\s*[-*+]\s+/.test(line)) { html += '<ul>'; while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { html += `<li>${mdInline(lines[i].replace(/^\s*[-*+]\s+/, ''))}</li>`; i++; } html += '</ul>'; continue; }
    if (/^\s*\d+\.\s+/.test(line)) { html += '<ol>'; while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { html += `<li>${mdInline(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>`; i++; } html += '</ol>'; continue; }
    const para = [line]; i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^\s*[-*+]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i]) && !/^#{1,4}\s/.test(lines[i]) && !/^@CB@\d+@CB@$/.test(lines[i])) { para.push(lines[i]); i++; }
    html += `<p>${mdInline(para.join(' '))}</p>`;
  }
  return html;
}

let cfg = { name: '', defaultPhase: 'auto', radioBank: 'lofi', radioStation: 0, autoplay: false, showActivity: true, spotifyClientId: '', origin: '', setupDone: true, defaultBuildDir: '' };

/* ================= phase + clock + sea ================= */
let phaseOverride = 'auto';
function computePhase() {
  if (phaseOverride !== 'auto') return phaseOverride;
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  if (h >= 5 && h < 7.5) return 'dawn';
  if (h >= 7.5 && h < 17.5) return 'day';
  if (h >= 17.5 && h < 20.75) return 'dusk';
  return 'night';
}
// The backdrop is a looping cinemagraph video. Two palettes: a bright midday
// look and a warm golden look — dawn & dusk take the warm one; day & night take
// the bright one (night darkened by the CSS wash). A still photo poster paints
// instantly and is the graceful fallback if a video can't load or play.
const SEA_VID = { day: 'assets/ocean-day.mp4?v=1', dusk: 'assets/ocean-dusk.mp4?v=1' };
const SEA_IMG = { day: 'assets/ocean-day.jpg?v=1', dusk: 'assets/ocean-dusk.jpg?v=1' };
const seaForPhase = (p) => (p === 'dawn' || p === 'dusk') ? 'dusk' : 'day';
const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
let seaKind = null, seaTop = 'a';
function crossfadeSea(p) {
  const kind = seaForPhase(p);
  if (kind === seaKind) return;
  seaKind = kind;
  const poster = $('#sea-poster'); if (poster) poster.src = SEA_IMG[kind];
  if (reduceMotion()) return;                 // honor reduced motion — hold the still poster
  const show = seaTop === 'a' ? $('#sea-b') : $('#sea-a');
  const hide = seaTop === 'a' ? $('#sea-a') : $('#sea-b');
  show.oncanplay = () => { show.oncanplay = null; show.classList.add('on'); hide.classList.remove('on'); try { hide.pause(); } catch {} };
  show.onerror = () => { show.oncanplay = null; show.classList.remove('on'); };  // leave the still poster showing
  show.src = SEA_VID[kind];
  try { show.load(); } catch {}
  const pr = show.play(); if (pr && pr.catch) pr.catch(() => {});
  seaTop = seaTop === 'a' ? 'b' : 'a';
}
function seaPause() { ['#sea-a', '#sea-b'].forEach((s) => { const v = $(s); if (v) { try { v.pause(); } catch {} } }); }
function seaResume() { if (reduceMotion()) return; const v = document.querySelector('video.sea.on'); if (v) { const pr = v.play(); if (pr && pr.catch) pr.catch(() => {}); } }
function applyPhase() {
  const p = computePhase();
  document.documentElement.dataset.phase = p;
  crossfadeSea(p);
}
function tickClock() {
  const now = new Date();
  let h = now.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  $('#clock').textContent = `${h}:${String(now.getMinutes()).padStart(2, '0')} ${ap}`;
  const hour = now.getHours();
  const name = cfg.name ? `, ${cfg.name}` : '';
  $('#greeting').textContent = hour < 5 ? `still up${name}` : hour < 12 ? `good morning${name}` :
    hour < 17 ? `good afternoon${name}` : hour < 22 ? `good evening${name}` : `good night${name}`;
}
function setPhaseControl(p) {
  phaseOverride = p;
  $$('#scene button').forEach((x) => x.classList.toggle('active', x.dataset.phase === p));
  applyPhase();
}
function sceneInit() { $$('#scene button').forEach((b) => b.addEventListener('click', () => setPhaseControl(b.dataset.phase))); }

/* ================= panel tabs (Today | Ideas) ================= */
function showTab(name) {
  $$('.panel-tabs .ptab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $$('#left .panel-pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === name));
}
function panelTabsInit() { $$('.panel-tabs .ptab').forEach((tab) => tab.addEventListener('click', () => showTab(tab.dataset.tab))); }

/* ================= ASK (the search bar, reimagined) ================= */
let asking = false;
async function ask(q) {
  q = (q || '').trim();
  if (!q) { $('#ask-input').focus(); return; }
  if (asking) { toast('Still thinking on the last one'); return; }
  asking = true; $('#ask').classList.add('busy'); $('#ask-go').disabled = true; $('#ask-ideas').disabled = true;
  $('#ask-answer').innerHTML = `<div class="ans-card thinking"><span class="ripple-dots"><i></i><i></i><i></i></span>Thinking…</div>`;
  try {
    const r = await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q }) });
    const data = await r.json();
    if (!data.ok) { $('#ask-answer').innerHTML = ''; toast(data.error || 'No answer came back'); return; }
    renderAnswer(q, data.answer);
  } catch { $('#ask-answer').innerHTML = ''; toast("Couldn't reach the assistant"); }
  finally { asking = false; $('#ask').classList.remove('busy'); $('#ask-go').disabled = false; $('#ask-ideas').disabled = false; }
}
function renderAnswer(q, answer) {
  const box = $('#ask-answer'); box.onclick = null;
  box.innerHTML = `<div class="ans-card"><div class="ans-body">${md(answer)}</div>
    <div class="ans-ops">
      <button data-act="copy">${icon('copy')}Copy</button>
      <button class="cap" data-act="capture">${icon('plus')}Capture</button>
    </div></div>`;
  box.querySelector('.ans-ops').onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.act === 'copy') toast((await copyText(answer)) ? 'Copied' : 'Copy failed');
    else if (b.dataset.act === 'capture') showCaptureMenu(b, answer, q);
  };
}
async function driftIdeas(seed) {
  if (asking) { toast('Still thinking on the last one'); return; }
  asking = true; $('#ask').classList.add('busy'); $('#ask-go').disabled = true; $('#ask-ideas').disabled = true;
  $('#ask-answer').innerHTML = `<div class="ans-card thinking"><span class="ripple-dots"><i></i><i></i><i></i></span>Finding ideas…</div>`;
  try {
    const r = await fetch('/api/spark', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seed, mode: 'ideas' }) });
    const data = await r.json();
    if (!data.ok || !Array.isArray(data.items)) { $('#ask-answer').innerHTML = ''; toast(data.error || 'No ideas came back'); return; }
    renderIdeaCards(data.items);
  } catch { $('#ask-answer').innerHTML = ''; toast("Couldn't reach the assistant"); }
  finally { asking = false; $('#ask').classList.remove('busy'); $('#ask-go').disabled = false; $('#ask-ideas').disabled = false; }
}
function renderIdeaCards(items) {
  const box = $('#ask-answer');
  box.innerHTML = items.map((it) => {
    const text = `${it.title} — ${it.blurb}`;
    return `<div class="ans-card"><div class="ans-body"><strong>${esc(it.title)}</strong><p style="margin:.3em 0 0">${esc(it.blurb)}</p></div>
      <div class="ans-ops">
        <button data-act="copy" data-text="${esc(text)}">${icon('copy')}Copy</button>
        <button class="cap" data-act="capture" data-text="${esc(text)}">${icon('plus')}Capture</button>
      </div></div>`;
  }).join('');
  box.querySelectorAll('.ans-card').forEach((c, i) => { c.style.animationDelay = Math.min(i * 70, 400) + 'ms'; });
  box.onclick = (e) => {
    const b = e.target.closest('button[data-act]'); if (!b) return; const text = b.dataset.text;
    if (b.dataset.act === 'copy') copyText(text).then((ok) => toast(ok ? 'Copied' : 'Copy failed'));
    else if (b.dataset.act === 'capture') showCaptureMenu(b, text, '');
  };
}
function askInit() {
  $('#ask-form').addEventListener('submit', (e) => { e.preventDefault(); closeAllPops(); ask($('#ask-input').value); });
  $('#ask-ideas').addEventListener('click', () => { closeAllPops(); driftIdeas($('#ask-input').value.trim()); });
}

/* ================= ideas (notes) ================= */
async function keepIdea(text, source = 'spark') {
  await fetch('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, source }) });
  loadIdeas();
}
async function loadIdeas() { renderIdeas(await (await fetch('/api/notes')).json()); }
let ideasCache = [];
function renderIdeas(notes) {
  const list = $('#ideas-list');
  if (!notes.length) { ideasCache = []; list.innerHTML = '<div class="empty">No ideas yet.<br>Catch one above, or generate a few from Ask.</div>'; return; }
  const sorted = [...notes].sort((a, b) => (b.pinned - a.pinned) || b.created.localeCompare(a.created));
  ideasCache = sorted;
  list.innerHTML = sorted.map((n, i) => `
    <div class="idea ${n.pinned ? 'pinned' : ''}" data-id="${n.id}" style="animation-delay:${Math.min(i * 35, 350)}ms">
      <div class="idea-main">
        <span class="idea-text" title="Develop this idea">${esc(n.text)}</span>
        <span class="when">${relTime(n.created)}</span>
      </div>
      <span class="ops">
        <button class="develop" title="Develop into angles">${icon('arrow')}</button>
        <button class="pin" title="Pin">${icon(n.pinned ? 'star-fill' : 'star')}</button>
        <button class="del" title="Remove">${icon('x')}</button>
      </span>
      <div class="idea-angles" hidden></div>
    </div>`).join('');
}
// Develop an idea inline into four angles via the local Claude CLI (Spark "expand").
async function developIdea(ideaEl, n) {
  const box = ideaEl.querySelector('.idea-angles'); if (!box) return;
  if (ideaEl.classList.contains('open')) { ideaEl.classList.remove('open'); box.hidden = true; return; }
  ideaEl.classList.add('open'); box.hidden = false;
  if (box.dataset.loaded === '1') return;                 // keep what we already fetched
  box.innerHTML = `<div class="angles-note"><span class="ripple-dots"><i></i><i></i><i></i></span>Developing…</div>`;
  try {
    const r = await fetch('/api/spark', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seed: n.text, mode: 'expand' }) });
    const data = await r.json();
    if (!data.ok || !Array.isArray(data.items)) { box.innerHTML = `<div class="angles-note dim">${esc(data.error || 'Could not develop this one')}</div>`; return; }
    box.dataset.loaded = '1';
    box.innerHTML = data.items.map((it) => `
      <div class="angle">
        <div class="angle-h">${esc(it.title)}</div>
        <div class="angle-b">${esc(it.blurb)}</div>
        <div class="angle-ops">
          <button data-task="${esc(it.title + ': ' + it.blurb)}" title="Make a task">${icon('check')}</button>
          <button data-copy="${esc(it.title + ' — ' + it.blurb)}" title="Copy">${icon('copy')}</button>
        </div>
      </div>`).join('');
  } catch { box.innerHTML = `<div class="angles-note dim">Couldn't reach the assistant</div>`; }
}
function ideasInit() {
  $('#ideas-input').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return; const text = e.target.value.trim(); if (!text) return;
    e.target.value = ''; await keepIdea(text, 'me'); toast('Idea saved');
  });
  $('#ideas-list').addEventListener('click', async (e) => {
    const idea = e.target.closest('.idea'); if (!idea) return; const id = idea.dataset.id;
    const taskBtn = e.target.closest('[data-task]');
    if (taskBtn) { const t = taskBtn.dataset.task; await addTask(t.length > 90 ? t.slice(0, 89) + '…' : t); toast('Added to Today'); return; }
    const copyBtn = e.target.closest('[data-copy]');
    if (copyBtn) { toast((await copyText(copyBtn.dataset.copy)) ? 'Copied' : 'Copy failed'); return; }
    if (e.target.closest('.del')) { await fetch(`/api/notes/${id}`, { method: 'DELETE' }); loadIdeas(); return; }
    if (e.target.closest('.pin')) { await patchNote(id, { pinned: !idea.classList.contains('pinned') }); return; }
    if (e.target.closest('.develop') || e.target.closest('.idea-text')) { const n = ideasCache.find((x) => x.id === id); if (n) developIdea(idea, n); }
  });
}
async function patchNote(id, body) { await fetch(`/api/notes/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); loadIdeas(); }

/* ================= today (tasks) ================= */
async function addTask(text) {
  await fetch('/api/todos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  loadTasks();
}
async function loadTasks() { renderTasks(await (await fetch('/api/todos')).json()); }
function renderTasks(todos) {
  const list = $('#today-list');
  if (!todos.length) { list.innerHTML = '<div class="empty">Nothing here yet.<br>Add a task above.</div>'; return; }
  const open = todos.filter((t) => !t.done), done = todos.filter((t) => t.done);
  const row = (t) => `<div class="task ${t.done ? 'done' : ''}" data-id="${t.id}" draggable="true">
    <span class="box" title="Toggle">${t.done ? icon('check') : ''}</span>
    <span class="txt">${esc(t.text)}</span>
    ${!t.done && cfg.terminalEnabled ? `<button class="run" title="Hand to Claude — open a terminal in the project and do this">${icon('boat')}</button>` : ''}
    <button class="x" title="Remove">${icon('x')}</button></div>`;
  list.innerHTML = open.map(row).join('') + done.map(row).join('');
}
// Hand a task to Claude: open a Claude terminal in the Oasis project, seeded with
// the task. Claude works it live in the glass window (and still asks before it
// edits or runs anything — you stay in the loop).
function runTaskWithClaude(text) {
  text = (text || '').trim(); if (!text) return;
  const short = text.length > 42 ? text.slice(0, 40) + '…' : text;
  openTerminal({ kind: 'claude', seed: text, title: short, sub: 'Claude · ' + (cfg.projectName || 'project') });
  toast('Handing it to Claude…');
}
function tasksInit() {
  $('#today-input').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return; const text = e.target.value.trim(); if (!text) return;
    e.target.value = ''; await addTask(text);
  });
  $('#today-list').addEventListener('click', async (e) => {
    const row = e.target.closest('.task'); if (!row) return; const id = row.dataset.id;
    if (e.target.closest('.run')) { runTaskWithClaude(row.querySelector('.txt').textContent); return; }
    if (e.target.closest('.x')) { await fetch(`/api/todos/${id}`, { method: 'DELETE' }); loadTasks(); }
    else if (e.target.closest('.box')) {
      await fetch(`/api/todos/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done: !row.classList.contains('done') }) });
      loadTasks();
    }
  });
  let dragId = null;
  const list = $('#today-list');
  list.addEventListener('dragstart', (e) => { const r = e.target.closest('.task'); if (!r) return; dragId = r.dataset.id; r.classList.add('dragging'); });
  list.addEventListener('dragend', (e) => { const r = e.target.closest('.task'); if (r) r.classList.remove('dragging'); dragId = null; });
  list.addEventListener('dragover', (e) => {
    e.preventDefault(); const after = [...list.querySelectorAll('.task:not(.dragging)')].find((el) => e.clientY < el.getBoundingClientRect().top + el.offsetHeight / 2);
    const dragging = list.querySelector('.dragging'); if (!dragging) return;
    if (after) list.insertBefore(dragging, after); else list.appendChild(dragging);
  });
  list.addEventListener('drop', async (e) => {
    e.preventDefault(); const ids = [...list.querySelectorAll('.task')].map((el) => el.dataset.id);
    try { const r = await fetch('/api/todos/reorder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) }); if (!r.ok) toast('Reorder failed'); }
    catch { toast('Reorder failed'); }
    loadTasks();
  });
}

/* ================= journal (new) ================= */
const MOODS = [
  { v: 'calm', c: 'var(--calm)' }, { v: 'focused', c: 'var(--focused)' }, { v: 'grateful', c: 'var(--grateful)' },
  { v: 'restless', c: 'var(--restless)' }, { v: 'tired', c: 'var(--tired)' },
];
const moodColor = (m) => (MOODS.find((x) => x.v === m) || { c: 'var(--calm)' }).c;
let journalMood = '';
async function addJournal(text, mood) {
  text = (text || '').trim(); if (!text) return;
  await fetch('/api/journal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, mood: mood || '' }) });
  loadJournal();
}
async function loadJournal() { renderJournal(await (await fetch('/api/journal')).json()); }
function dayKey(d) { return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }
function renderJournal(items) {
  const list = $('#journal-list');
  // last-7-days mood pulse
  const days = []; const now = new Date();
  for (let i = 6; i >= 0; i--) { const d = new Date(now); d.setDate(now.getDate() - i); days.push({ key: dayKey(d), label: d.toLocaleDateString(undefined, { weekday: 'short' }), moods: {}, count: 0 }); }
  items.forEach((e) => { const day = days.find((x) => x.key === dayKey(new Date(e.created))); if (day) { day.count++; if (e.mood) day.moods[e.mood] = (day.moods[e.mood] || 0) + 1; } });
  const spark = days.map((d) => {
    const dom = Object.keys(d.moods).sort((a, b) => d.moods[b] - d.moods[a])[0];
    const col = d.count ? (dom ? moodColor(dom) : 'var(--aqua)') : 'var(--ink-faint)';
    const op = d.count ? Math.min(0.4 + d.count * 0.2, 1) : 0.2;
    const t = `${d.label} · ${d.count ? `${d.count} ${d.count === 1 ? 'entry' : 'entries'}${dom ? ` · ${dom}` : ''}` : 'no entries'}`;
    return `<i style="background:${col};opacity:${op}" title="${esc(t)}"></i>`;
  }).join('');
  $('#journal-count').innerHTML = `${items.length ? `${items.length} ${items.length === 1 ? 'entry' : 'entries'}` : 'your journal'}<span class="mood-spark">${spark}</span>`;
  if (!items.length) { list.innerHTML = '<div class="empty">No entries yet.<br>Write your first below.</div>'; return; }
  list.innerHTML = items.map((e, i) => `
    <div class="jentry" data-id="${e.id}" style="border-left-color:${moodColor(e.mood)};animation-delay:${Math.min(i * 30, 300)}ms">
      <button class="jdel" title="Remove">${icon('x')}</button>
      <div class="jmeta"><span class="jdate">${esc(fmtStamp(e.created))}</span>${e.mood ? `<span class="jmood">feeling ${esc(e.mood)}</span>` : ''}</div>
      <div class="jtext">${esc(e.text)}</div>
    </div>`).join('');
}
function renderMoodChips() {
  $('#journal-mood').innerHTML = MOODS.map((m) => `<button title="${m.v}" data-mood="${m.v}" style="background:${m.c}"></button>`).join('');
}
async function saveJournalEntry() {
  const ta = $('#journal-input'), text = ta.value.trim();
  if (!text) { ta.focus(); return; }
  await addJournal(text, journalMood);
  ta.value = ''; journalMood = ''; $$('#journal-mood button').forEach((b) => b.classList.remove('sel'));
  toast('Logged');
}
function journalInit() {
  renderMoodChips();
  $('#journal-mood').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mood]'); if (!b) return;
    const m = b.dataset.mood; journalMood = (journalMood === m) ? '' : m;
    $$('#journal-mood button').forEach((x) => x.classList.toggle('sel', x.dataset.mood === journalMood));
  });
  $('#journal-save').addEventListener('click', saveJournalEntry);
  $('#journal-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveJournalEntry(); } });
  $('#journal-list').addEventListener('click', async (e) => {
    const del = e.target.closest('.jdel'); if (!del) return;
    const entry = del.closest('.jentry'); await fetch(`/api/journal/${entry.dataset.id}`, { method: 'DELETE' }); loadJournal();
  });
}

/* ================= gallery + lightbox ================= */
let assetsCache = [];
async function loadGallery() {
  try { const data = await (await fetch('/api/assets')).json(); assetsCache = data.items || []; renderGallery(); }
  catch { $('#gallery-grid').innerHTML = '<div class="gal-empty">Could not open the gallery.</div>'; }
}
function renderGallery() {
  const grid = $('#gallery-grid');
  if (!assetsCache.length) { grid.innerHTML = '<div class="gal-empty">Nothing here yet — generate or import an image to keep it.</div>'; return; }
  grid.innerHTML = assetsCache.map((a, i) => `<div class="thumb" data-id="${esc(a.id)}" style="animation-delay:${Math.min(i * 14, 320)}ms"><img loading="lazy" src="${a.rel}" alt="${esc(a.name)}"></div>`).join('');
}
function openGallery() { $('#gallery').classList.remove('hidden'); loadGallery(); }
function closeGallery() { $('#gallery').classList.add('hidden'); }
function galleryInit() {
  $('#btn-gallery').addEventListener('click', openGallery);
  $('#gallery-close').addEventListener('click', closeGallery);
  $('.gal-shade').addEventListener('click', closeGallery);
  $('#gallery-grid').addEventListener('click', (e) => { const t = e.target.closest('.thumb'); if (t) openLightbox(t.dataset.id); });
  $('#import-input').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return; const url = e.target.value.trim(); if (!url) return; toast('Importing…');
    try {
      const data = await (await fetch('/api/assets/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })).json();
      if (data.ok) { e.target.value = ''; toast('Kept in the gallery'); loadGallery(); } else toast(data.error || 'Import failed');
    } catch { toast('Import failed'); }
  });
}
let lbCurrent = null;
function openLightbox(id) { const a = assetsCache.find((x) => x.id === id); if (!a) return; lbCurrent = a; $('#lb-img').src = a.rel; $('#lb-name').textContent = a.name; $('#lightbox').classList.remove('hidden'); }
function closeLightbox() { $('#lightbox').classList.add('hidden'); $('#lb-img').src = ''; lbCurrent = null; }
function lightboxInit() {
  $('#lb-close').addEventListener('click', closeLightbox); $('.lb-shade').addEventListener('click', closeLightbox);
  $('#lb-reveal').addEventListener('click', async () => { if (!lbCurrent) return; try { const data = await (await fetch('/api/reveal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: lbCurrent.id }) })).json(); if (!data.ok) toast(data.error || 'Could not open'); } catch { toast('Could not open'); } });
  $('#lb-copy').addEventListener('click', async () => { if (!lbCurrent) return; toast((await copyText(lbCurrent.name)) ? 'Filename copied' : 'Copy failed'); });
}

/* ================= ticker + HUD agent status ================= */
let tickerItems = [], tickerIdx = 0, tickerPaused = false;
async function loadTicker() {
  try {
    const data = await (await fetch('/api/activity')).json();
    tickerItems = (data.items || []).slice(0, 12);
    showTicker();
  } catch {}
}
function showTicker() {
  const el = $('#ticker .tk-text');
  if (!tickerItems.length) { el.textContent = cfg.showActivity ? 'No recent activity' : ''; $('#ticker').style.display = cfg.showActivity ? '' : 'none'; return; }
  $('#ticker').style.display = '';
  const it = tickerItems[tickerIdx % tickerItems.length];
  el.style.opacity = '0';
  setTimeout(() => { el.innerHTML = `<span class="tk-dot ${it.source}"></span>${esc(it.project)} — “${esc(it.title)}” <span class="tk-when">· ${relTime(it.lastActive)}</span>`; el.style.opacity = '1'; }, 200);
}
// Hovering the ticker holds it still so it's readable; clicking opens the full
// recent-agent-work list (wired in agentLogInit).
function tickerInit() {
  const t = $('#ticker');
  t.addEventListener('mouseenter', () => { tickerPaused = true; });
  t.addEventListener('mouseleave', () => { tickerPaused = false; });
}

/* ================= dock ================= */
const ACTION_ORDER = ['bat', 'dev', 'url', 'folder'];
let dockExpanded = false, dockTools = [];
async function loadDock() { dockTools = await (await fetch('/api/tools')).json(); renderDock(dockTools); }
function primaryAction(t) { return ACTION_ORDER.find((a) => t.actions.includes(a)) || 'folder'; }
async function launchTool(id, action) {
  try {
    const data = await (await fetch('/api/launch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action }) })).json();
    toast(data.ok ? 'Launched' : (data.error || 'Could not launch'));
  } catch { toast('Could not launch'); }
}
function renderDock(tools) {
  const dock = $('#dock'), visible = dockExpanded ? tools : tools.slice(0, 7);
  let html = visible.map((t) => { const hasFolder = t.actions.includes('folder') && primaryAction(t) !== 'folder';
    return `<button class="pill" data-id="${esc(t.id)}" data-action="${primaryAction(t)}" title="${esc(t.name)}">${esc(t.name)}${hasFolder ? `<span class="home" data-folder="1" title="Open folder">${icon('folder')}</span>` : ''}</button>`; }).join('');
  if (!dockExpanded && tools.length > 7) html += `<button class="pill more" data-more="1">+${tools.length - 7}</button>`;
  if (dockExpanded && tools.length > 7) html += `<button class="pill more" data-more="0">less</button>`;
  html += `<button class="pill add" id="dock-add" title="Add a tool">${icon('plus')}</button>`;
  dock.innerHTML = html;
}
function dockInit() {
  $('#dock').addEventListener('click', async (e) => {
    if (e.target.closest('#dock-add')) { $('#tool-add').classList.toggle('hidden'); if (!$('#tool-add').classList.contains('hidden')) $('#tool-name').focus(); return; }
    const more = e.target.closest('[data-more]'); if (more) { dockExpanded = more.dataset.more === '1'; renderDock(dockTools); return; }
    const home = e.target.closest('[data-folder]'); const pill = e.target.closest('.pill');
    if (!pill || pill.classList.contains('add') || pill.classList.contains('more')) return;
    launchTool(pill.dataset.id, home ? 'folder' : pill.dataset.action);
  });
  $('#tool-add-form').addEventListener('submit', async (e) => {
    e.preventDefault(); const name = $('#tool-name').value.trim(), target = $('#tool-target').value.trim(); if (!name || !target) return;
    await fetch('/api/tools', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, target }) });
    $('#tool-name').value = ''; $('#tool-target').value = ''; $('#tool-add').classList.add('hidden'); loadDock(); toast('Added to the dock');
  });
}

/* ================= music: lo-fi + ambient (one <audio>) ================= */
const RADIO = {
  lofi: [
    { name: 'Lo-Fi', url: 'https://stream.laut.fm/lofi', tag: 'lo-fi hip hop' },
    { name: 'Chillhop', url: 'https://streams.fluxfm.de/Chillhop/mp3-320/streams.fluxfm.de/', tag: 'FluxFM · 320k' },
    { name: 'Jamz', url: 'https://usa9.fastcast4u.com/proxy/jamz?mp=/1', tag: 'lo-fi beats' },
  ],
  old: [
    { name: 'Groove Salad', url: 'https://ice1.somafm.com/groovesalad-128-mp3', tag: 'ambient downtempo' },
    { name: 'Drone Zone', url: 'https://ice1.somafm.com/dronezone-128-mp3', tag: 'deep ambient space' },
    { name: 'Fluid', url: 'https://ice1.somafm.com/fluid-128-mp3', tag: 'instrumental, dreamy' },
    { name: 'Deep Space One', url: 'https://ice1.somafm.com/deepspaceone-128-mp3', tag: 'ambient space' },
    { name: 'Mission Control', url: 'https://ice1.somafm.com/missioncontrol-128-mp3', tag: 'ambient with comms' },
  ],
};
let curBank = null, curStation = -1;
function renderStations() {
  $('#lofi-stations').innerHTML = RADIO.lofi.map((s, i) =>
    `<button class="station" data-bank="lofi" data-i="${i}"><span class="st-name">${esc(s.name)}</span><span class="st-tag">${esc(s.tag)}</span></button>`).join('');
  $('#amb-stations').innerHTML = RADIO.old.map((s, i) =>
    `<button class="station" data-bank="old" data-i="${i}"><span class="st-name">${esc(s.name)}</span><span class="st-tag">${esc(s.tag)}</span></button>`).join('');
}
function markStations() {
  $$('#lofi-stations .station, #amb-stations .station').forEach((b) =>
    b.classList.toggle('active', b.dataset.bank === curBank && +b.dataset.i === curStation));
}
function playStation(bank, i) {
  const audio = $('#radio-audio'), s = RADIO[bank] && RADIO[bank][i];
  if (!s) return;
  clearSpotify();
  if (curBank === bank && curStation === i && !audio.paused) { audio.pause(); return; }
  curBank = bank; curStation = i;
  audio.src = s.url;
  $('#radio-label').textContent = s.name;
  markStations();
  audio.play().catch(() => toast('Stream unavailable — try another station'));
}
function radioToggle() {
  const audio = $('#radio-audio');
  if (curBank === null) { playStation(cfg.radioBank === 'old' ? 'old' : 'lofi', cfg.radioStation || 0); return; }
  if (audio.paused) audio.play().catch(() => toast('Stream unavailable')); else audio.pause();
}
function setRadioState(playing, label) {
  $('#player').classList.toggle('playing', playing);
  $('#pl-state').innerHTML = icon('note');
  if (label) $('#pl-now').textContent = label;
  else if (!playing && !spotifyActive) $('#pl-now').textContent = 'Music';
  $('#radio-play').innerHTML = playing ? icon('pause') : icon('play');
}
function radioInit() {
  const audio = $('#radio-audio');
  audio.volume = 0.6;
  renderStations();
  $('#lofi-stations').addEventListener('click', (e) => { const b = e.target.closest('.station'); if (b) playStation('lofi', +b.dataset.i); });
  $('#amb-stations').addEventListener('click', (e) => { const b = e.target.closest('.station'); if (b) playStation('old', +b.dataset.i); });
  $('#radio-play').addEventListener('click', radioToggle);
  $('#radio-vol').addEventListener('input', (e) => { audio.volume = e.target.value / 100; });
  audio.addEventListener('playing', () => { const s = RADIO[curBank] && RADIO[curBank][curStation]; setRadioState(true, s ? (curBank === 'old' ? 'Ambient · ' : 'Lo-Fi · ') + s.name : 'Music'); });
  audio.addEventListener('pause', () => setRadioState(false));
  audio.addEventListener('error', () => { if (audio.src) toast('Stream unavailable — try another station'); });
}

/* ================= spotify ================= */
const SP_PRESETS = [
  { name: 'lofi beats', id: '37i9dQZF1DWWQRwui0ExPn' },
  { name: 'Deep Focus', id: '37i9dQZF1DWZeKCadgRdKQ' },
  { name: 'Ocean Waves', id: '37i9dQZF1DX1s9knjP51Oa' },
  { name: 'Peaceful Piano', id: '37i9dQZF1DX4sWSpwq3LiO' },
];
let spotifyActive = false;
function parseSpotify(url) {
  url = url.trim();
  let m = url.match(/spotify\.com\/(?:intl-[a-z]+\/)?(playlist|album|track|artist|episode|show)\/([A-Za-z0-9]+)/);
  if (m) return { type: m[1], id: m[2] };
  m = url.match(/spotify:(playlist|album|track|artist|episode|show):([A-Za-z0-9]+)/);
  if (m) return { type: m[1], id: m[2] };
  if (/^[A-Za-z0-9]{22}$/.test(url)) return { type: 'playlist', id: url };
  return null;
}
function loadSpotifyEmbed(type, id, label) {
  $('#radio-audio').pause();
  spotifyActive = true;
  $('#sp-embed').innerHTML = `<iframe src="https://open.spotify.com/embed/${type}/${id}?utm_source=oasis" height="152" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>`;
  setRadioState(true, 'Spotify' + (label ? ' · ' + label : ''));
}
function clearSpotify() { if (spotifyActive) { $('#sp-embed').innerHTML = ''; spotifyActive = false; } }
function spotifyInit() {
  $('#sp-presets').innerHTML = SP_PRESETS.map((p) => `<button class="station" data-id="${p.id}" data-name="${esc(p.name)}"><span class="st-name">${esc(p.name)}</span></button>`).join('');
  $('#sp-presets').addEventListener('click', (e) => { const b = e.target.closest('.station'); if (b) loadSpotifyEmbed('playlist', b.dataset.id, b.dataset.name); });
  $('#sp-load').addEventListener('click', () => {
    const parsed = parseSpotify($('#sp-url').value); if (!parsed) { toast('Not a Spotify link'); return; }
    loadSpotifyEmbed(parsed.type, parsed.id); $('#sp-url').value = '';
  });
  $('#sp-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#sp-load').click(); });
  $('#sp-connect-btn').addEventListener('click', spotifyConnect);
  $('#sp-save-id').addEventListener('click', async () => {
    const id = $('#sp-clientid').value.trim(); if (!id) return;
    await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spotifyClientId: id }) });
    cfg.spotifyClientId = id; toast('Saved — now hit Connect'); $('#sp-setup').classList.add('hidden');
  });
}
function randStr(n) { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'; let s = ''; const r = crypto.getRandomValues(new Uint8Array(n)); for (let i = 0; i < n; i++) s += a[r[i] % a.length]; return s; }
async function pkceChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function spotifyConnect() {
  if (!cfg.spotifyClientId) { $('#sp-setup').classList.toggle('hidden'); return; }
  const verifier = randStr(64);
  sessionStorage.setItem('sp_verifier', verifier);
  const challenge = await pkceChallenge(verifier);
  const url = new URL('https://accounts.spotify.com/authorize');
  url.search = new URLSearchParams({
    client_id: cfg.spotifyClientId, response_type: 'code', redirect_uri: cfg.origin + '/',
    code_challenge_method: 'S256', code_challenge: challenge,
    scope: 'playlist-read-private playlist-read-collaborative',
  }).toString();
  location.href = url.toString();
}
async function spotifyHandleRedirect() {
  const params = new URLSearchParams(location.search);
  const error = params.get('error');
  const code = params.get('code'); const verifier = sessionStorage.getItem('sp_verifier');
  if (error) { history.replaceState({}, '', location.pathname); sessionStorage.removeItem('sp_verifier'); toast(error === 'access_denied' ? 'Spotify connect cancelled' : 'Spotify error: ' + error); return; }
  if (!code || !verifier) return;
  history.replaceState({}, '', location.pathname);
  try {
    const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: cfg.origin + '/', client_id: cfg.spotifyClientId, code_verifier: verifier });
    const tok = await (await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })).json();
    if (!tok.access_token) { toast('Spotify connect failed'); return; }
    sessionStorage.setItem('sp_token', tok.access_token);
    $('#player').classList.remove('collapsed');
    spotifySwitchTab('spotify');
    loadMyPlaylists(tok.access_token);
  } catch { toast('Spotify connect failed'); }
  finally { sessionStorage.removeItem('sp_verifier'); }
}
async function loadMyPlaylists(token) {
  try {
    const data = await (await fetch('https://api.spotify.com/v1/me/playlists?limit=40', { headers: { Authorization: 'Bearer ' + token } })).json();
    if (!data.items) return;
    $('#sp-connect-btn').textContent = 'Connected — your playlists';
    $('#sp-playlists').innerHTML = data.items.map((p) => `<button class="pl-item" data-id="${p.id}" data-name="${esc(p.name)}">${esc(p.name)}</button>`).join('');
    $('#sp-playlists').onclick = (e) => { const b = e.target.closest('.pl-item'); if (b) loadSpotifyEmbed('playlist', b.dataset.id, b.dataset.name); };
  } catch { toast('Could not load playlists'); }
}
function spotifySwitchTab(src) {
  $('#player').dataset.tab = src;
  $$('.pl-tab').forEach((t) => t.classList.toggle('active', t.dataset.src === src));
  $$('.pl-pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === src));
}
function playerInit() {
  $('#player-toggle').addEventListener('click', () => $('#player').classList.toggle('collapsed'));
  $$('.pl-tab').forEach((t) => t.addEventListener('click', () => spotifySwitchTab(t.dataset.src)));
  radioInit(); spotifyInit();
}

/* ================= command palette ================= */
let palItems = [], palActive = 0;
function paletteActions() {
  const a = [];
  const add = (ic, label, hint, run, keywords) => a.push({ ic, label, hint, run, keywords: (label + ' ' + (keywords || '')).toLowerCase() });
  add('search', 'Ask a question', 'ask', () => { closePalette(); $('#ask-input').focus(); }, 'question answer claude help');
  add('boat', 'Brainstorm ideas', 'ask', () => { closePalette(); driftIdeas($('#ask-input').value.trim()); }, 'idea generate spark');
  add('clock', 'Recent asks', 'ask', () => { closePalette(); openAskHistory(); }, 'history past previous question recall');
  add('sun', 'Daily briefing', 'ask', () => { closePalette(); showBriefing(); }, 'summary day standup recap reflect');
  add('feather', 'New journal entry', 'write', () => { closePalette(); $('#journal-input').focus(); }, 'reflect log diary write');
  add('check', 'Go to Today', 'view', () => { closePalette(); showTab('today'); $('#today-input').focus(); }, 'tasks todo');
  add('boat', 'Go to Ideas', 'view', () => { closePalette(); showTab('ideas'); $('#ideas-input').focus(); }, 'notes');
  add('grid', 'Open gallery', 'view', () => { closePalette(); openGallery(); }, 'images assets pictures');
  add('boat', 'Recent agent work', 'view', () => { closePalette(); openAgentLog(); }, 'claude codex sessions activity');
  [15, 25, 50, 90].forEach((m) => add('timer', `Focus ${m} min`, 'focus', () => { closePalette(); startTimer(m); }, 'pomodoro countdown session'));
  add('timer', 'Open / hide focus timer', 'focus', () => { closePalette(); toggleTimer(); }, 'timer pomodoro session');
  ['auto', 'dawn', 'day', 'dusk', 'night'].forEach((p) => add('sun', `Scene: ${p[0].toUpperCase() + p.slice(1)}`, 'scene', () => { closePalette(); setPhaseControl(p); }, 'backdrop background time scene'));
  add('note', 'Music: play / pause', 'sound', () => { closePalette(); radioToggle(); }, 'radio lofi ambient');
  add('note', 'Open music', 'sound', () => { closePalette(); $('#player').classList.remove('collapsed'); }, 'radio');
  add('settings', 'Preferences', 'system', () => { closePalette(); openSetup(true); }, 'settings config');
  add('plus', 'Add a tool to the dock', 'system', () => { closePalette(); $('#tool-add').classList.remove('hidden'); $('#tool-name').focus(); }, 'launcher');
  dockTools.forEach((t) => add('arrow', `Launch ${t.name}`, 'launch', () => { closePalette(); launchTool(t.id, primaryAction(t)); }, 'open run tool project'));
  return a;
}
function renderPalette(q) {
  const all = paletteActions();
  const query = (q || '').trim().toLowerCase();
  palItems = query ? all.filter((it) => query.split(/\s+/).every((w) => it.keywords.includes(w))) : all;
  palActive = 0;
  const list = $('#palette-list');
  if (!palItems.length) { list.innerHTML = '<div class="pal-empty">No command matches that.</div>'; return; }
  list.innerHTML = palItems.map((it, i) =>
    `<div class="pal-item ${i === 0 ? 'active' : ''}" data-i="${i}">${icon(it.ic)}<span class="pal-label">${esc(it.label)}</span><span class="pal-hint">${esc(it.hint)}</span></div>`).join('');
}
function setPalActive(i) {
  palActive = (i + palItems.length) % palItems.length;
  $$('#palette-list .pal-item').forEach((el, j) => el.classList.toggle('active', j === palActive));
  const el = $$('#palette-list .pal-item')[palActive]; if (el) el.scrollIntoView({ block: 'nearest' });
}
function openPalette() { $('#palette').classList.remove('hidden'); $('#palette-input').value = ''; renderPalette(''); $('#palette-input').focus(); }
function closePalette() { $('#palette').classList.add('hidden'); }
function paletteOpen() { return !$('#palette').classList.contains('hidden'); }
function paletteInit() {
  $('#btn-command').addEventListener('click', openPalette);
  $('.pal-shade').addEventListener('click', closePalette);
  $('#palette-input').addEventListener('input', (e) => renderPalette(e.target.value));
  $('#palette-input').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setPalActive(palActive + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setPalActive(palActive - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); const it = palItems[palActive]; if (it) it.run(); }
  });
  $('#palette-list').addEventListener('click', (e) => { const el = e.target.closest('.pal-item'); if (!el) return; const it = palItems[+el.dataset.i]; if (it) it.run(); });
}

/* ================= focus timer ================= */
let timerMin = 25, timerEndAt = 0, timerRemain = 25 * 60, timerRunning = false, timerInt = null, timerDone = false;
function fmtTime(s) { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function paintTimer() {
  const ro = $('#tp-readout'); ro.textContent = fmtTime(timerRemain);
  ro.classList.toggle('run', timerRunning); ro.classList.toggle('done', timerDone && !timerRunning);
  const chip = $('#timer-chip'), btn = $('#btn-timer');
  if (timerRunning) { chip.textContent = fmtTime(timerRemain); chip.classList.remove('hidden'); btn.classList.add('run'); }
  else { chip.classList.add('hidden'); btn.classList.remove('run'); }
  $('#tp-startstop').textContent = timerRunning ? 'Pause' : (timerRemain < timerMin * 60 && timerRemain > 0 ? 'Resume' : 'Start');
}
function timerTick() {
  timerRemain = (timerEndAt - Date.now()) / 1000;
  if (timerRemain <= 0) { timerRemain = 0; timerDone = true; stopTimer(true); paintTimer(); toast('Focus session complete'); chime(); return; }
  paintTimer();
}
function startTimer(min) {
  timerDone = false;
  if (min) { timerMin = min; timerRemain = min * 60; $$('#tp-presets button').forEach((b) => b.classList.toggle('sel', +b.dataset.min === min)); }
  if (timerRemain <= 0) timerRemain = timerMin * 60;
  timerEndAt = Date.now() + timerRemain * 1000; timerRunning = true;
  clearInterval(timerInt); timerInt = setInterval(timerTick, 250);
  $('#timer-pop').classList.remove('hidden'); paintTimer();
}
function stopTimer(finished) { timerRunning = false; clearInterval(timerInt); timerInt = null; if (!finished) timerRemain = (timerEndAt - Date.now()) / 1000; paintTimer(); }
function resetTimer() { stopTimer(true); timerDone = false; timerRemain = timerMin * 60; timerEndAt = 0; paintTimer(); }
function toggleTimer() { $('#timer-pop').classList.toggle('hidden'); if (!$('#timer-pop').classList.contains('hidden')) paintTimer(); }
function chime() { try { const AC = window.AudioContext || window.webkitAudioContext; const ac = new AC(); const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(660, ac.currentTime); o.frequency.setValueAtTime(880, ac.currentTime + 0.2); o.connect(g); g.connect(ac.destination); g.gain.setValueAtTime(0.0001, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.2, ac.currentTime + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 1.1); o.start(); o.stop(ac.currentTime + 1.15); } catch {} }
function timerInit() {
  $('#btn-timer').addEventListener('click', toggleTimer);
  $('#tp-presets').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; timerMin = +b.dataset.min; $$('#tp-presets button').forEach((x) => x.classList.toggle('sel', x === b)); if (!timerRunning) { timerDone = false; timerRemain = timerMin * 60; timerEndAt = 0; } paintTimer(); });
  $('#tp-startstop').addEventListener('click', () => { if (timerRunning) stopTimer(false); else startTimer(); });
  $('#tp-reset').addEventListener('click', resetTimer);
  paintTimer();
}

/* ================= setup wizard / preferences ================= */
let suStep = 0, suMax = 5, suPrefs = false, suSel = { bank: 'lofi', phase: 'auto' };
function renderSetupChoices() {
  $('#su-sound').innerHTML = [
    { v: 'lofi', name: 'Lo-Fi hip hop', tag: 'beats to focus to' },
    { v: 'old', name: 'Ambient & downtempo', tag: 'calm sounds for deep focus' },
    { v: 'off', name: 'Silence', tag: 'no audio on open' },
  ].map((o) => `<button type="button" class="su-pick ${suSel.bank === o.v ? 'sel' : ''}" data-sound="${o.v}"><span class="su-pick-name">${o.name}</span><span class="su-pick-tag">${o.tag}</span></button>`).join('');
  $('#su-phase').innerHTML = [
    { v: 'auto', name: 'Auto' }, { v: 'dawn', name: 'Dawn' }, { v: 'day', name: 'Day' }, { v: 'dusk', name: 'Dusk' }, { v: 'night', name: 'Night' },
  ].map((o) => `<button type="button" class="su-phase-pick ${suSel.phase === o.v ? 'sel' : ''}" data-phase="${o.v}">${o.name}</button>`).join('');
  $('#setup-dots').innerHTML = Array.from({ length: suMax }, (_, i) => `<span class="${i === suStep ? 'on' : ''}"></span>`).join('');
}
function showStep(n) {
  suStep = Math.max(0, Math.min(suMax - 1, n));
  $$('.setup-step').forEach((s) => s.classList.toggle('active', +s.dataset.step === suStep));
  $('#su-back').style.visibility = suStep === 0 ? 'hidden' : 'visible';
  $('#su-next').textContent = suStep === suMax - 1 ? (suPrefs ? 'Save' : 'Enter Oasis') : 'Continue';
  renderSetupChoices();
}
function openSetup(prefs) {
  suPrefs = prefs; suStep = 0;
  $('#su-name').value = cfg.name || '';
  $('#su-builddir').value = cfg.buildDir || '';
  $('#su-builddir').placeholder = cfg.defaultBuildDir || 'C:\\Users\\you\\Documents\\build';
  $('#su-activity').checked = cfg.showActivity !== false;
  suSel.bank = (cfg.radioBank === 'old' || cfg.radioBank === 'off') ? cfg.radioBank : 'lofi';
  suSel.phase = cfg.defaultPhase || 'auto';
  $('#setup .setup-tag').textContent = prefs ? 'Adjust your preferences below.' : "Let's get you set up. This takes about a minute.";
  $('#setup .setup-head h1').textContent = prefs ? 'Preferences' : 'Welcome to Oasis';
  $('#setup').classList.remove('hidden');
  showStep(0);
}
async function finishSetup() {
  const body = {
    name: $('#su-name').value.trim(), buildDir: $('#su-builddir').value.trim(),
    showActivity: $('#su-activity').checked, defaultPhase: suSel.phase, radioBank: suSel.bank,
    radioStation: 0, setupDone: true,
  };
  try { const r = await (await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    if (r.config) cfg = { ...cfg, ...r.config }; } catch { toast('Could not save preferences'); }
  $('#setup').classList.add('hidden');
  tickClock(); setPhaseControl(cfg.defaultPhase || 'auto'); loadTicker(); loadDock();
  if (suPrefs) toast('Preferences saved');
}
function setupInit() {
  $('#open-settings').addEventListener('click', () => openSetup(true));
  $('#su-next').addEventListener('click', () => { if (suStep === suMax - 1) finishSetup(); else showStep(suStep + 1); });
  $('#su-back').addEventListener('click', () => showStep(suStep - 1));
  $('#su-sound').addEventListener('click', (e) => { const b = e.target.closest('[data-sound]'); if (b) { suSel.bank = b.dataset.sound; renderSetupChoices(); } });
  $('#su-phase').addEventListener('click', (e) => { const b = e.target.closest('[data-phase]'); if (b) { suSel.phase = b.dataset.phase; renderSetupChoices(); } });
  $('#su-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#su-next').click(); });
}

/* ================= global keyboard ================= */
function keyboardInit() {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); paletteOpen() ? closePalette() : openPalette(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === "'") { e.preventDefault(); askPopEl ? closeAskPop() : openAskHistory(); return; }
    if (e.key === 'Escape') {
      if (anyPopOpen()) return closeAllPops();
      if (paletteOpen()) return closePalette();
      if (!$('#lightbox').classList.contains('hidden')) return closeLightbox();
      if (!$('#gallery').classList.contains('hidden')) return closeGallery();
      if (!$('#tool-add').classList.contains('hidden')) return $('#tool-add').classList.add('hidden');
      if (!$('#timer-pop').classList.contains('hidden')) return $('#timer-pop').classList.add('hidden');
      return;
    }
    const typing = /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
    if (e.key === '/' && !typing && !paletteOpen()) { e.preventDefault(); $('#ask-input').focus(); }
  });
}

/* ================= floating popovers (history / capture / agent) ================= */
let askPopEl = null, captureEl = null, agentPopEl = null;
function anyPopOpen() { return !!(askPopEl || captureEl || agentPopEl); }
function closeAllPops() { closeAskPop(); closeCapture(); closeAgentPop(); }

/* ---- ask history (recall, re-ask) ---- */
async function fetchAskHistory() { try { return await (await fetch('/api/ask-history')).json(); } catch { return []; } }
function closeAskPop() { if (askPopEl) { askPopEl.remove(); askPopEl = null; document.removeEventListener('click', askPopOutside, true); } }
function askPopOutside(e) { if (askPopEl && !askPopEl.contains(e.target) && !e.target.closest('#ask-form')) closeAskPop(); }
async function openAskHistory() {
  const items = await fetchAskHistory();
  closeAllPops();
  const el = document.createElement('div'); el.className = 'pop'; el.id = 'ask-history';
  el.innerHTML = `<div class="pop-head"><h3>Recent asks</h3>${items.length ? '<button data-clear="1">clear all</button>' : ''}</div>` +
    (items.length ? items.map((h) => `<div class="pop-row" data-id="${esc(h.id)}">
        <div class="pr-main"><div class="pr-q">${esc(h.q)}</div><div class="pr-meta">${relTime(h.at)}</div></div>
        <div class="pr-acts"><button data-reask title="Ask again">${icon('send')}</button><button data-del title="Remove">${icon('trash')}</button></div>
      </div>`).join('') : '<div class="pop-empty">No questions yet — ask something above.</div>');
  document.body.appendChild(el);
  const f = $('#ask-form').getBoundingClientRect();
  el.style.width = Math.min(f.width, window.innerWidth - 24) + 'px';
  el.style.left = Math.round(f.left) + 'px';
  el.style.top = Math.round(f.bottom + 8) + 'px';
  if (el.getBoundingClientRect().bottom > window.innerHeight - 8) el.style.top = Math.max(8, window.innerHeight - el.offsetHeight - 8) + 'px';
  el.setAttribute('role', 'menu'); el.setAttribute('aria-label', 'Recent asks'); el.tabIndex = -1;
  askPopEl = el; el.focus();
  el.onclick = async (e) => {
    if (e.target.closest('[data-clear]')) { await fetch('/api/ask-history', { method: 'DELETE' }); closeAskPop(); toast('History cleared'); return; }
    const row = e.target.closest('.pop-row'); if (!row) return; const h = items.find((x) => x.id === row.dataset.id); if (!h) return;
    if (e.target.closest('[data-del]')) { await fetch('/api/ask-history/' + h.id, { method: 'DELETE' }); openAskHistory(); return; }
    if (e.target.closest('[data-reask]')) { closeAskPop(); $('#ask-input').value = h.q; ask(h.q); return; }
    closeAskPop(); renderAnswer(h.q, h.answer);
  };
  setTimeout(() => document.addEventListener('click', askPopOutside, true), 0);
}
function askHistoryInit() {
  // recall is intentional only — Ctrl/Cmd+' or the command palette. Typing dismisses it.
  $('#ask-input').addEventListener('input', closeAskPop);
}

/* ---- smart capture menu (answer / idea -> task, idea, journal) ---- */
function closeCapture() { if (captureEl) { captureEl.remove(); captureEl = null; document.removeEventListener('click', captureOutside, true); } }
function captureOutside(e) { if (captureEl && !captureEl.contains(e.target) && !e.target.closest('[data-act="capture"]')) closeCapture(); }
function showCaptureMenu(anchor, text, q) {
  closeAllPops();
  const taskText = (q && q.trim()) ? q.trim() : text;
  const el = document.createElement('div'); el.className = 'capture-menu';
  el.innerHTML = `
    <button data-c="task">${icon('check')}Make a task</button>
    <button data-c="idea">${icon('boat')}Keep as idea</button>
    <button data-c="journal">${icon('feather')}Save to journal</button>
    <button data-c="copy">${icon('copy')}Copy</button>`;
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  el.style.left = Math.round(Math.min(r.left, window.innerWidth - el.offsetWidth - 12)) + 'px';
  el.style.top = Math.round(Math.min(r.bottom + 6, window.innerHeight - el.offsetHeight - 12)) + 'px';
  el.setAttribute('role', 'menu'); el.setAttribute('aria-label', 'Capture'); el.tabIndex = -1;
  captureEl = el; el.focus();
  el.onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return; const c = b.dataset.c;
    if (c === 'copy') { toast((await copyText(text)) ? 'Copied' : 'Copy failed'); closeCapture(); return; }
    if (c === 'task') await addTask(taskText.length > 90 ? taskText.slice(0, 89) + '…' : taskText);
    else if (c === 'idea') await keepIdea(text, 'spark');
    else if (c === 'journal') await addJournal(q && q.trim() ? `On: ${q}\n\n${text}` : text, '');
    b.disabled = true; b.classList.add('done'); b.innerHTML = `${icon('check')}Saved`;
  };
  setTimeout(() => document.addEventListener('click', captureOutside, true), 0);
}

/* ---- daily briefing (one cached claude -p insight per day) ---- */
function renderBriefing(data) {
  const box = $('#ask-answer'); box.onclick = null;
  const s = data.stats || {};
  const line = data.insight || (data.pending ? 'Looking over your day…' : 'A fresh, open day — nothing logged yet.');
  const chip = (val, label) => `<span class="brief-chip"><b>${val}</b> ${label}</span>`;
  box.innerHTML = `<div class="ans-card brief">
    <div class="brief-line ${data.insight ? '' : 'empty-line'}">${esc(line)}</div>
    <div class="brief-stats">
      ${chip(s.done || 0, 'done today')}
      ${chip(s.open || 0, 'open')}
      ${chip(s.journal || 0, s.journal === 1 ? 'journal entry' : 'journal entries')}
      ${s.mood ? `<span class="brief-chip"><span class="dot" style="background:${moodColor(s.mood)}"></span>${esc(s.mood)}</span>` : ''}
    </div></div>`;
}
async function showBriefing() {
  closeAllPops();
  const box = $('#ask-answer'); box.onclick = null;
  box.innerHTML = `<div class="ans-card thinking"><span class="ripple-dots"><i></i><i></i><i></i></span>Gathering your day…</div>`;
  try {
    const data = await (await fetch('/api/briefing')).json();
    renderBriefing(data);
    if (data.pending) setTimeout(async () => { try { const d2 = await (await fetch('/api/briefing')).json(); if (!d2.pending) renderBriefing(d2); } catch {} }, 6500);
  } catch { box.innerHTML = ''; toast('Could not load briefing'); }
}
function briefingInit() { $('#btn-briefing').addEventListener('click', showBriefing); }
function maybeAutoBriefing() {
  try {
    const key = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem('oasis_briefing_seen') === key) return;
    localStorage.setItem('oasis_briefing_seen', key);
    setTimeout(() => { if (!$('#ask-answer').innerHTML.trim() && !asking) showBriefing(); }, 1500);
  } catch {}
}

/* ---- recent agent work -> task / journal ---- */
function closeAgentPop() { if (agentPopEl) { agentPopEl.remove(); agentPopEl = null; document.removeEventListener('click', agentPopOutside, true); } }
function agentPopOutside(e) { if (agentPopEl && !agentPopEl.contains(e.target) && !e.target.closest('#ticker')) closeAgentPop(); }
function openAgentLog() {
  if (agentPopEl) { closeAgentPop(); return; }                 // ticker click toggles
  closeAllPops();
  const items = tickerItems || [];
  const el = document.createElement('div'); el.className = 'pop'; el.id = 'agent-log';
  el.innerHTML = `<div class="pop-head"><h3>Recent agent work</h3></div>` +
    (items.length ? items.map((it, i) => `<div class="pop-row" data-i="${i}">
        <span class="tk-dot ${it.source === 'codex' ? 'codex' : 'claude'}"></span>
        <div class="pr-main"><div class="pr-q">${esc(it.title)}</div><div class="pr-meta">${esc(it.project)} · ${relTime(it.lastActive)}</div></div>
        <div class="pr-acts">${it.id ? `<button data-term title="Resume in a terminal">${icon('terminal')}</button>` : ''}<button data-task title="Make a task">${icon('check')}</button><button data-journal title="Note to journal">${icon('feather')}</button></div>
      </div>`).join('') : '<div class="pop-empty">No recent agent activity.</div>');
  document.body.appendChild(el);
  const r = $('#ticker').getBoundingClientRect();
  el.style.left = Math.round(Math.max(12, Math.min(r.left, window.innerWidth - el.offsetWidth - 12))) + 'px';
  el.style.top = Math.round(Math.max(12, r.top - el.offsetHeight - 8)) + 'px';   // opens upward from the dock
  el.setAttribute('role', 'menu'); el.setAttribute('aria-label', 'Recent agent work'); el.tabIndex = -1;
  agentPopEl = el; el.focus();
  el.onclick = async (e) => {
    const row = e.target.closest('.pop-row'); if (!row) return; const it = items[+row.dataset.i]; if (!it) return;
    if (e.target.closest('[data-term]')) { openTerminal({ kind: it.source, id: it.id, title: it.project || it.source, sub: it.source === 'claude' ? 'resume' : 'session' }); closeAgentPop(); }
    else if (e.target.closest('[data-task]')) { await addTask(`Follow up: ${it.title}`); toast('Added to Today'); closeAgentPop(); }
    else if (e.target.closest('[data-journal]')) { await addJournal(`Agent (${it.project}): ${it.title}`, ''); toast('Saved to journal'); closeAgentPop(); }
  };
  setTimeout(() => document.addEventListener('click', agentPopOutside, true), 0);
}
function agentLogInit() { $('#ticker').addEventListener('click', openAgentLog); }

/* ================= built-in terminal dock ================= */
/* A docked panel in the #ui grid — NOT a floating window. Each session is a tab
   hosting an xterm bound to a server PTY over a WebSocket; only the active tab's
   host is shown. The one optional native dep (node-pty) lives on the server; we
   gate on cfg.terminalEnabled. Tiny JSON protocol: see server.js. */
const TERM_THEME = {
  background: 'rgba(0,0,0,0)', foreground: '#e9f3f1', cursor: '#aee9df', cursorAccent: '#0b1417',
  selectionBackground: 'rgba(120,200,190,.35)',
  black: '#0b1417', red: '#ff9d8a', green: '#9be7c4', yellow: '#ffd9a0', blue: '#9cc9ff',
  magenta: '#e3b3ff', cyan: '#aee9df', white: '#d8e6e3', brightBlack: '#5b6e6b',
  brightRed: '#ffb3a3', brightGreen: '#b6f0d6', brightYellow: '#ffe6c2', brightBlue: '#bcd9ff',
  brightMagenta: '#eecbff', brightCyan: '#c8f3ec', brightWhite: '#ffffff',
};
let termSessions = [], activeTermId = null, termSeq = 0;

const TERM_GEO_KEY = 'oasis_term_geo';
const TERM_MINW = 360, TERM_MINH = 180;
let termGeoSet = false;
const isTermOpen = () => $('#terminal-dock').classList.contains('open');
function termDefaultGeo() {                            // opens docked across the bottom
  const m = 16, w = Math.min(window.innerWidth - m * 2, 1180), h = 340;
  return { left: Math.round((window.innerWidth - w) / 2), top: Math.max(m, window.innerHeight - h - 84), width: w, height: h };
}
function termClampGeo(g) {
  g.width = Math.max(TERM_MINW, Math.min(g.width, window.innerWidth - 8));
  g.height = Math.max(TERM_MINH, Math.min(g.height, window.innerHeight - 8));
  g.left = Math.round(Math.max(140 - g.width, Math.min(g.left, window.innerWidth - 140)));  // keep ≥140px on screen
  g.top = Math.round(Math.max(4, Math.min(g.top, window.innerHeight - 44)));                 // keep the bar reachable
  g.width = Math.round(g.width); g.height = Math.round(g.height);
  return g;
}
function termApplyGeo(g) {
  const d = $('#terminal-dock').style;
  d.left = g.left + 'px'; d.top = g.top + 'px'; d.width = g.width + 'px'; d.height = g.height + 'px';
}
function termLoadGeo() {
  let g; try { g = JSON.parse(localStorage.getItem(TERM_GEO_KEY)); } catch {}
  return termClampGeo(g && typeof g.width === 'number' ? g : termDefaultGeo());
}
function termSaveGeo() {
  const r = $('#terminal-dock').getBoundingClientRect();
  try { localStorage.setItem(TERM_GEO_KEY, JSON.stringify({ left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) })); } catch {}
}
function openTermDock() {
  if (!termGeoSet) { termApplyGeo(termLoadGeo()); termGeoSet = true; }
  $('#terminal-dock').classList.add('open');
  requestAnimationFrame(fitActiveTerm);
}
function closeTermDock() { $('#terminal-dock').classList.remove('open'); }
function fitActiveTerm() { const s = termSessions.find((x) => x.id === activeTermId); if (s) { try { s.fit.fit(); } catch {} } }

function renderTermTabs() {
  $('#td-tabs').innerHTML = termSessions.map((s) => `<button class="td-tab ${s.id === activeTermId ? 'active' : ''}" data-id="${s.id}" title="${esc(s.sub ? s.title + ' · ' + s.sub : s.title)}">
      <span class="td-dot ${s.kind}"></span><span class="td-tab-name">${esc(s.title)}</span>
      <span class="td-tab-x" data-close="${s.id}" title="Close">${icon('x')}</span></button>`).join('');
  const s = termSessions.find((x) => x.id === activeTermId);
  $('#td-send').innerHTML = (s && s.seed && !s.seedSent)
    ? `<button class="td-sendbtn" title="Type this task into Claude and run it">${icon('boat')}<span>Send task</span></button>` : '';
}

function activateTerm(id) {
  activeTermId = id;
  termSessions.forEach((s) => { s.host.style.display = s.id === id ? '' : 'none'; });
  renderTermTabs();
  fitActiveTerm();
  const s = termSessions.find((x) => x.id === id); if (s) setTimeout(() => { try { s.term.focus(); } catch {} }, 0);
}

function openTerminal(opts = {}) {
  if (!cfg.terminalEnabled) { toast('Embedded terminal needs node-pty — run npm install in Oasis'); return; }
  if (!window.Terminal) { toast('Terminal failed to load'); return; }
  const kind = ['shell', 'claude', 'codex'].includes(opts.kind) ? opts.kind : 'shell';
  const title = opts.title || (kind === 'claude' ? 'Claude' : kind === 'codex' ? 'Codex' : 'Terminal');
  const sub = opts.sub || cfg.projectName || '';        // which project this session lives in
  const id = 't' + (termSeq++);

  const host = document.createElement('div'); host.className = 'td-host'; host.dataset.id = id;
  $('#td-body').appendChild(host);
  const term = new Terminal({
    allowTransparency: true, cursorBlink: true, fontSize: 13, scrollback: 5000,
    fontFamily: 'ui-monospace, "Cascadia Code", "Cascadia Mono", Consolas, Menlo, monospace', theme: TERM_THEME,
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit); term.open(host);

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const qs = new URLSearchParams({ token: cfg.wsToken || '', kind });
  if (opts.id) qs.set('id', opts.id);
  const ws = new WebSocket(`${proto}://${location.host}/term?${qs}`);
  const session = { id, kind, title, sub, seed: opts.seed || '', seedSent: false, term, fit, ws, host, status: 'connecting' };
  const send = (o) => { try { if (ws.readyState === 1) ws.send(JSON.stringify(o)); } catch {} };
  session.send = send;
  const sendResize = () => send({ t: 'r', c: term.cols, r: term.rows });
  ws.onopen = () => { session.status = 'connected'; sendResize(); if (id === activeTermId) setTimeout(() => { try { term.focus(); } catch {} }, 0); };
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.t === 'o') term.write(m.d);
    else if (m.t === 'x') { term.write(`\r\n\x1b[2m[process exited${m.code != null ? ' · ' + m.code : ''}]\x1b[0m\r\n`); session.status = 'exited'; }
  };
  ws.onclose = () => { if (session.status !== 'exited') session.status = 'disconnected'; };
  term.onData((d) => send({ t: 'i', d }));
  term.onResize(() => sendResize());

  termSessions.push(session);
  openTermDock();
  activateTerm(id);
  return session;
}

function closeTerm(id) {
  const i = termSessions.findIndex((s) => s.id === id); if (i < 0) return;
  const s = termSessions[i];
  try { s.ws.close(); } catch {} try { s.term.dispose(); } catch {}
  s.host.remove();
  termSessions.splice(i, 1);
  if (activeTermId === id) {
    const next = termSessions[i] || termSessions[i - 1];
    if (next) activateTerm(next.id);
    else { activeTermId = null; renderTermTabs(); closeTermDock(); }
  } else renderTermTabs();
}

// Inject the staged task into the active Claude session's prompt and run it.
function sendSeedActive() {
  const s = termSessions.find((x) => x.id === activeTermId);
  if (!s || !s.seed || s.seedSent) return;
  s.send({ t: 'i', d: String(s.seed) + '\r' }); s.seedSent = true;
  toast('Sent to Claude'); renderTermTabs(); try { s.term.focus(); } catch {}
}

// New-terminal menu (a fresh shell / Claude / Codex), anchored under `anchorEl`.
function openTermMenu(anchorEl) {
  const open = $('#term-menu'); if (open) { open.remove(); return; }
  if (!cfg.terminalEnabled) { toast('Embedded terminal needs node-pty — run npm install in Oasis'); return; }
  const anchor = anchorEl || $('#btn-terminal');
  const m = document.createElement('div'); m.className = 'pop'; m.id = 'term-menu';
  m.innerHTML = `<div class="pop-head"><h3>New terminal</h3></div>
    <div class="pop-row" data-kind="shell"><span class="tk-dot" style="background:#8fb6c2"></span><div class="pr-main"><div class="pr-q">Shell</div><div class="pr-meta">a fresh interactive shell</div></div></div>
    <div class="pop-row" data-kind="claude"><span class="tk-dot claude"></span><div class="pr-main"><div class="pr-q">Claude</div><div class="pr-meta">start a new claude session</div></div></div>
    <div class="pop-row" data-kind="codex"><span class="tk-dot codex"></span><div class="pr-main"><div class="pr-q">Codex</div><div class="pr-meta">start a new codex session</div></div></div>`;
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  m.style.left = Math.round(Math.max(12, Math.min(r.left, window.innerWidth - m.offsetWidth - 12))) + 'px';
  const top = (r.bottom + 8 + m.offsetHeight > window.innerHeight) ? r.top - m.offsetHeight - 8 : r.bottom + 8;
  m.style.top = Math.round(Math.max(12, top)) + 'px';
  m.onclick = (e) => { const row = e.target.closest('[data-kind]'); if (!row) return; openTerminal({ kind: row.dataset.kind }); m.remove(); };
  setTimeout(() => document.addEventListener('click', function out(ev) {
    if (!m.contains(ev.target) && !ev.target.closest('#btn-terminal') && !ev.target.closest('#td-new')) { m.remove(); document.removeEventListener('click', out, true); }
  }, true), 0);
}

function terminalInit() {
  const chip = $('#btn-terminal');
  if (chip) chip.addEventListener('click', () => {
    if (!cfg.terminalEnabled) { toast('Embedded terminal needs node-pty — run npm install in Oasis'); return; }
    if (isTermOpen() && termSessions.length) closeTermDock();
    else { openTermDock(); if (!termSessions.length) openTermMenu(chip); }
  });
  $('#td-new').addEventListener('click', () => openTermMenu($('#td-new')));
  $('#td-hide').addEventListener('click', closeTermDock);
  $('#td-tabs').addEventListener('click', (e) => {
    const x = e.target.closest('[data-close]'); if (x) { closeTerm(x.dataset.close); return; }
    const tab = e.target.closest('.td-tab'); if (tab) activateTerm(tab.dataset.id);
  });
  $('#td-send').addEventListener('click', (e) => { if (e.target.closest('.td-sendbtn')) sendSeedActive(); });
  // drag to move — grab the tab bar (but not its tabs/buttons)
  const dock = $('#terminal-dock'), bar = dock.querySelector('.td-bar');
  bar.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.td-tab, .td-btn, .td-sendbtn')) return;
    e.preventDefault();
    const r = dock.getBoundingClientRect(), sx = e.clientX, sy = e.clientY, ox = r.left, oy = r.top, w = r.width, h = r.height;
    dock.classList.add('dragging'); try { bar.setPointerCapture(e.pointerId); } catch {}
    const move = (ev) => termApplyGeo(termClampGeo({ left: ox + ev.clientX - sx, top: oy + ev.clientY - sy, width: w, height: h }));
    const up = () => { dock.classList.remove('dragging'); try { bar.releasePointerCapture(e.pointerId); } catch {} bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); termSaveGeo(); };
    bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', up);
  });
  // resize from the side / bottom-corner handles
  dock.querySelectorAll('.td-rz').forEach((h) => h.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const dir = h.dataset.dir, r = dock.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY, o = { left: r.left, top: r.top, width: r.width, height: r.height };
    dock.classList.add('resizing'); try { h.setPointerCapture(e.pointerId); } catch {}
    const move = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy, g = { ...o };
      if (dir.includes('e')) g.width = o.width + dx;
      if (dir.includes('s')) g.height = o.height + dy;
      if (dir.includes('w')) { const nw = Math.max(TERM_MINW, o.width - dx); g.left = o.left + (o.width - nw); g.width = nw; }
      termApplyGeo(termClampGeo(g)); fitActiveTerm();
    };
    const up = () => { dock.classList.remove('resizing'); try { h.releasePointerCapture(e.pointerId); } catch {} h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); fitActiveTerm(); termSaveGeo(); };
    h.addEventListener('pointermove', move); h.addEventListener('pointerup', up);
  }));
  // keep it on-screen and refit when the window resizes
  window.addEventListener('resize', () => {
    if (termGeoSet) { const r = dock.getBoundingClientRect(); termApplyGeo(termClampGeo({ left: r.left, top: r.top, width: r.width, height: r.height })); }
    fitActiveTerm();
  });
}

/* ================= config + boot ================= */
async function loadConfig() {
  try { cfg = { ...cfg, ...(await (await fetch('/api/config')).json()) }; } catch {}
  $('#sp-redirect').textContent = (cfg.origin || '') + '/';
  if (cfg.spotifyClientId) $('#sp-clientid').value = cfg.spotifyClientId;
  setPhaseControl(cfg.defaultPhase || 'auto');
  tickClock();
  if (cfg.radioBank === 'old' || cfg.radioBank === 'lofi') {
    curBank = null; curStation = -1;
    const b = cfg.radioBank, i = cfg.radioStation || 0, s = RADIO[b] && RADIO[b][i];
    if (s) $('#radio-label').textContent = s.name;
  }
  if (!cfg.setupDone) openSetup(false);
}

/* ================= efficiency: sleep when hidden ================= */
let timers = [];
function startTimers() {
  stopTimers();
  timers = [
    setInterval(tickClock, 1000),
    setInterval(applyPhase, 60000),
    setInterval(() => { if (!tickerPaused && tickerItems.length) { tickerIdx++; showTicker(); } }, 6000),
    setInterval(loadTicker, 45000),
    setInterval(loadDock, 120000),
    setInterval(loadTasks, 90000),
  ];
}
function stopTimers() { timers.forEach(clearInterval); timers = []; }
function visibilityInit() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { seaPause(); stopTimers(); }
    else { seaResume(); tickClock(); applyPhase(); startTimers(); }
  });
}

/* ================= boot ================= */
tickClock(); applyPhase();
$('#sea-poster').addEventListener('error', () => document.body.classList.add('no-photo'));  // both video + poster gone → gradient
document.addEventListener('pointerdown', seaResume, { once: true });                          // resume if autoplay was blocked
sceneInit(); panelTabsInit(); askInit(); askHistoryInit(); ideasInit(); tasksInit(); journalInit(); galleryInit(); lightboxInit(); tickerInit(); dockInit(); playerInit(); paletteInit(); timerInit(); briefingInit(); agentLogInit(); terminalInit(); setupInit(); visibilityInit(); keyboardInit();
loadTasks(); loadIdeas(); loadJournal(); loadTicker(); loadDock();
loadConfig().then(spotifyHandleRedirect);
startTimers();
maybeAutoBriefing();
