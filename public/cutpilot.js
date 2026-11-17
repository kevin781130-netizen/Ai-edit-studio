// CutPilot AI clip selection panel (Moments tab). Separate from Studio's own "Find clips".
// CutPilot only ranks; Studio previews, applies and renders. The browser sends projectId + sourceIndex,
// never a file path to rank. Flow: analyse → preview in a NEW draft project (dryRun) → apply after an
// explicit confirmation → render only through Studio's own Export.
import { t, tm } from './i18n.js';
import { formatTime } from './edit-ops.js';
import { mountHybridAssets } from './hybrid-assets.js';

const $ = id => document.getElementById(id);
function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
const option = (value, label) => Object.assign(el('option', '', label), { value });
const MODES = [['visual', 'Visual activity (fast, no speech model)'], ['speech', 'Speech + virality (Whisper)']];
let ctx;
const S = { job: null, timer: null, preview: null, applied: null, status: null, busy: false, include: null };

function field(label, input) { const l = el('label', '', t(label)); l.append(input); return l; }
function numberInput(id, value, min, max, step = 1) { return Object.assign(el('input'), { id, type: 'number', value: String(value), min: String(min), max: String(max), step: String(step) }); }

function build() {
  const host = $('moments')?.parentElement; if (!host || $('cutpilot-panel')) return;
  const box = el('section', 'clip-finder cutpilot'); box.id = 'cutpilot-panel';
  const h = el('h4', '', t('✦ CutPilot AI clip selection')); h.append(' ', el('small', '', t('ranking by CutPilot, editing by Studio')));
  const source = Object.assign(el('select'), { id: 'cp-source' });
  const mode = Object.assign(el('select'), { id: 'cp-mode' }); mode.append(...MODES.map(([v, l]) => option(v, t(l))));
  const two1 = el('div', 'two'); two1.append(field('Source video', source), field('Selection mode', mode));
  const three = el('div', 'three'); three.append(field('Candidates', numberInput('cp-count', 5, 1, 20)), field('Shortest · s', numberInput('cp-min', 20, 0.5, 1199, 0.5)), field('Longest · s', numberInput('cp-max', 55, 1, 1200, 0.5)));
  const run = Object.assign(el('button', 'secondary', t('Run CutPilot analysis')), { id: 'cp-run', type: 'button' });
  const gear = Object.assign(el('button', 'ghost', t('CutPilot settings')), { id: 'cp-settings-toggle', type: 'button' });
  const actions = el('div', 'row-actions'); actions.append(run, gear);
  const settings = el('div', 'cutpilot-settings'); settings.id = 'cp-settings'; settings.hidden = true;
  const repo = Object.assign(el('input'), { id: 'cp-repo', placeholder: t('CutPilot folder (contains cutpilot/rank_only.py)') });
  const py = Object.assign(el('input'), { id: 'cp-python', placeholder: t('Python executable (empty = automatic)') });
  const sActions = el('div', 'row-actions');
  sActions.append(Object.assign(el('button', 'ghost', t('Save')), { id: 'cp-save', type: 'button' }), Object.assign(el('button', 'ghost', t('Check connection')), { id: 'cp-check', type: 'button' }));
  settings.append(field('CutPilot folder', repo), field('Python', py), sActions, Object.assign(el('p', 'muted small', ''), { id: 'cp-config' }),
    el('p', 'help', t('CUTPILOT_REPO and CUTPILOT_PYTHON environment variables override these settings.')));
  const statusLine = Object.assign(el('p', 'muted small', ''), { id: 'cp-status' });
  const list = el('div', 'clips-list'); list.id = 'cp-list';
  const flow = el('div', 'cutpilot-flow'); flow.id = 'cp-flow';
  box.append(h, two1, three, actions, settings, statusLine, list, flow,
    el('p', 'help', t('CutPilot only ranks moments. The preview is made in a NEW draft project; your current project is never changed. Nothing is applied without your confirmation and nothing is rendered until you export.')));
  host.insertBefore(box, host.querySelector('.clip-finder'));
  run.onclick = runAnalysis;
  gear.onclick = () => { settings.hidden = !settings.hidden; if (!settings.hidden) loadStatus(); };
  $('cp-save').onclick = saveSettings;
  $('cp-check').onclick = checkConnection;
}

function setStatus(text) { const n = $('cp-status'); if (n) n.textContent = text; }

async function loadStatus() {
  try {
    const s = await ctx.api('/api/cutpilot/status'); S.status = s;
    if (document.activeElement !== $('cp-repo')) $('cp-repo').value = s.repoSource === 'settings' ? s.repo : '';
    if (document.activeElement !== $('cp-python')) $('cp-python').value = s.pythonSource === 'settings' ? s.python : '';
    const from = { env: t('environment variable'), settings: t('saved settings'), unset: t('not set'), default: t('automatic'), 'repo-venv': t('CutPilot .venv') };
    $('cp-config').textContent = `${t('Folder')}: ${s.repo || '—'} (${from[s.repoSource]}) · Python: ${[s.python, ...s.pythonArgs].join(' ')} (${from[s.pythonSource]})${s.repoOk ? '' : ` · ${t('CutPilot folder not found')}`}`;
  } catch (e) { $('cp-config').textContent = e.message; }
}
async function saveSettings() {
  try { await ctx.api('/api/cutpilot/settings', 'POST', { repo: $('cp-repo').value.trim(), python: $('cp-python').value.trim() }); ctx.toast(t('CutPilot settings saved.')); loadStatus(); }
  catch (e) { ctx.toast(e.message); }
}
async function checkConnection() {
  $('cp-check').disabled = true; setStatus(t('Checking CutPilot…'));
  try { await ctx.api('/api/cutpilot/check', 'POST', {}); setStatus(t('✓ CutPilot is connected.')); loadStatus(); }
  catch (e) { setStatus(e.message); ctx.toast(e.message); } finally { $('cp-check').disabled = false; }
}

function fillSources() {
  const select = $('cp-source'); if (!select) return;
  const list = ctx.sources(), keep = select.value;
  select.replaceChildren(...list.map((s, i) => [s, i]).filter(([s]) => !s.still).map(([s, i]) => option(String(i), `${i + 1} · ${s.name} (${formatTime(s.duration, 0)})`)));
  if ([...select.options].some(o => o.value === keep)) select.value = keep;
  $('cp-run').disabled = S.busy || !select.options.length;
}

async function runAnalysis() {
  if (!ctx.state.project || S.busy) return;
  const sourceIndex = Number($('cp-source').value);
  if (!Number.isInteger(sourceIndex)) return ctx.toast(t('Choose a source video.'));
  S.job = null; S.preview = null; S.applied = null; S.include = null; renderAll();
  S.busy = true; $('cp-run').disabled = true; setStatus(t('CutPilot is analysing… (speech mode can take several minutes)'));
  try {
    const { job } = await ctx.api('/api/cutpilot/rank', 'POST', { projectId: ctx.state.project.id, sourceIndex, mode: $('cp-mode').value,
      maxClips: Number($('cp-count').value), minSeconds: Number($('cp-min').value), maxSeconds: Number($('cp-max').value) });
    S.job = job; pollJob();
  } catch (e) { S.busy = false; $('cp-run').disabled = false; setStatus(''); ctx.toast(e.message); }
}
function pollJob() {
  clearTimeout(S.timer);
  S.timer = setTimeout(async () => {
    try {
      const { job } = await ctx.api(`/api/cutpilot/jobs/${S.job.id}`);
      S.job = job;
      if (job.status === 'running') return pollJob();
      S.busy = false; $('cp-run').disabled = false;
      if (job.status === 'done') setStatus(t('CutPilot found {n} candidates.', { n: job.candidates.length }));
      else { setStatus(job.error?.message ?? t('CutPilot analysis failed.')); ctx.toast(job.error?.details?.stderr ? `${job.error.message}\n${job.error.details.stderr.split('\n').filter(Boolean).at(-1)}` : job.error?.message, [], 12000); }
      renderAll();
    } catch (e) { S.busy = false; $('cp-run').disabled = false; setStatus(e.message); }
  }, 1500);
}

// A Studio timeline cannot use the same footage twice; CutPilot windows may overlap (same rule as the server).
const overlaps = (a, b) => Math.min(a.sourceEnd, b.sourceEnd) - Math.max(a.sourceStart, b.sourceStart) > 0.001;
function defaultSelection(candidates) {
  const chosen = [];
  for (const c of candidates) if (!chosen.some(k => overlaps(k, c))) chosen.push(c);
  return new Set(chosen.map(c => c.rank));
}
function renderCandidates() {
  const root = $('cp-list'); if (!root) return;
  const job = S.job;
  if (!job || job.status !== 'done') { root.replaceChildren(); return; }
  S.include ??= defaultSelection(job.candidates);
  root.replaceChildren(...job.candidates.map(c => {
    const card = el('article', 'clip-card'), head = el('header');
    const box = Object.assign(el('input'), { type: 'checkbox', checked: S.include.has(c.rank), title: t('Use this candidate on the preview timeline') });
    box.onclick = e => e.stopPropagation();
    box.onchange = () => { if (box.checked) S.include.add(c.rank); else S.include.delete(c.rank); renderAll(); };
    const name = el('strong', '', ` #${c.rank} · ${tm(c.title)}`); name.prepend(box);
    head.append(name, Object.assign(el('span', 'score', String(Math.round(c.score * 10) / 10)), { title: t('AI score') }));
    card.append(head, el('small', 'muted', `${t('Source')} ${formatTime(c.sourceStart, 2)} → ${formatTime(c.sourceEnd, 2)} · ${t('Length')} ${c.duration.toFixed(1)} s · ${t('AI score')} ${c.score}`));
    const clash = job.candidates.find(o => o.rank !== c.rank && S.include.has(o.rank) && overlaps(o, c));
    if (clash) card.append(el('small', 'muted', t('Shares footage with #{r}; a timeline can use it only once.', { r: clash.rank })));
    card.title = t('Click to watch this part in the source monitor');
    card.onclick = () => ctx.peekSource(job.sourceIndex, c.sourceStart);
    return card;
  }));
}

function renderFlow() {
  const root = $('cp-flow'); if (!root) return;
  const job = S.job;
  if (!job || job.status !== 'done') { root.replaceChildren(); return; }
  const rows = [];
  const previewBtn = Object.assign(el('button', 'secondary', t('Preview in a new draft project')), { type: 'button', disabled: S.busy });
  previewBtn.onclick = preview;
  const actions = el('div', 'row-actions'); actions.append(previewBtn); rows.push(actions);
  if (S.preview) {
    const p = S.preview, tl = p.timeline ?? [];
    const total = tl.reduce((sum, r) => sum + (r.duration ?? 0), 0);
    rows.push(el('h5', '', t('Preview (dry run — nothing saved)')));
    if (p.skipped?.length) rows.push(el('p', 'muted small', t('Not on the timeline: {list}', { list: p.skipped.map(r => `#${r}`).join(', ') })));
    rows.push(el('p', 'muted small', t('{n} shots · {s} s · review score {score} · original project unchanged (rev {a} → {b})',
      { n: tl.length, s: total.toFixed(1), score: p.review?.score ?? '—', a: p.original.revisionBefore, b: p.original.revisionAfter })));
    if (p.diff?.summary) rows.push(el('p', 'muted small', `${t('Changes')}: ${tm(p.diff.summary)}`));
    const ol = el('ol', 'cutpilot-timeline');
    for (const r of tl) ol.append(el('li', '', `${formatTime(r.timelineIn, 1)}–${formatTime(r.timelineOut, 1)} · ${tm(r.label ?? '')} · ${t('source')} ${formatTime(r.sourceIn, 2)}–${formatTime(r.sourceOut, 2)}`));
    rows.push(ol);
    const act = el('div', 'row-actions');
    if (!S.applied) {
      const apply = Object.assign(el('button', 'primary', t('Apply to the draft project…')), { type: 'button', disabled: S.busy });
      apply.onclick = applyPreview; act.append(apply);
    }
    const open = Object.assign(el('button', 'ghost', t('Open draft project')), { type: 'button' });
    open.onclick = () => ctx.openProject(p.draftProjectId); act.append(open);
    rows.push(act);
  }
  if (S.applied) rows.push(el('p', 'muted small', t('Applied: {n} shots saved in the draft project (rev {r}). To render, open it and use Export — nothing renders automatically.', { n: S.applied.clipCount, r: S.applied.revision })));
  root.replaceChildren(...rows);
}

async function preview() {
  if (!S.job || S.busy) return;
  S.busy = true; S.applied = null; renderFlow(); setStatus(t('Making a draft project and a dry-run preview…'));
  try {
    S.preview = await ctx.api('/api/cutpilot/preview', 'POST', { jobId: S.job.id, include: [...S.include].sort((a, b) => a - b) });
    setStatus(t('Preview ready in a new draft project. Nothing is applied yet.'));
    ctx.refreshList?.();
  } catch (e) { setStatus(''); ctx.toast(e.message); }
  finally { S.busy = false; renderFlow(); }
}
async function applyPreview() {
  const p = S.preview; if (!p || S.busy) return;
  if (!confirm(t('Apply the {n} CutPilot clips to the draft project “{name}”? Your current project stays unchanged.', { n: p.timeline?.length ?? 0, name: t('CutPilot picks') }))) return;
  S.busy = true; renderFlow(); setStatus(t('Applying…'));
  try {
    S.applied = await ctx.api('/api/cutpilot/apply', 'POST', { jobId: S.job.id, draftProjectId: p.draftProjectId, revision: p.revision, confirm: true });
    setStatus(t('Applied and verified.'));
    ctx.toast(t('CutPilot clips applied to the draft project.'), [[t('Open draft project'), () => ctx.openProject(p.draftProjectId)]]);
    ctx.refreshList?.();
  } catch (e) { setStatus(''); ctx.toast(e.message); }
  finally { S.busy = false; renderFlow(); }
}

function renderAll() { renderCandidates(); renderFlow(); }
export function renderCutPilot() { if (!ctx) return; fillSources(); }
export function resetCutPilot() { clearTimeout(S.timer); Object.assign(S, { job: null, preview: null, applied: null, busy: false, include: null }); if (ctx) { fillSources(); renderAll(); setStatus(''); } }
export function initCutPilot(context) { ctx = context; build(); fillSources(); mountHybridAssets(context); }
