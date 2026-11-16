// CutPilot ↔ Studio editor integration: ranker call, manifest checks, dryRun preview, apply guards.
// No Python, media or GPU needed: the ranker process and Studio project functions are faked.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createCutPilotService, resolveCutPilotConfig, validateCutPilotManifest, handleCutPilotApi, CUTPILOT_MODES } from './studio-route.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const ORIGINAL = '11111111-1111-4111-8111-111111111111';
const SOURCE_FILE = path.resolve(os.tmpdir(), 'cutpilot-uat', 'source.mp4');
const DURATION = 192.260998;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function fakeStudio() {
  const projects = new Map();
  const calls = [];
  projects.set(ORIGINAL, { id: ORIGINAL, revision: 7, plan: { clips: [{ sourceIndex: 0, start: 1, end: 5 }] },
    sources: [{ file: SOURCE_FILE, name: 'source.mp4', duration: DURATION }, { file: 'C:/x/logo.png', name: 'logo.png', duration: 60, still: true }] });
  let n = 0;
  return {
    projects, calls,
    async getProject(id) { const p = projects.get(id); if (!p) { const e = new Error('Project not found.'); e.name = 'StudioError'; e.code = 'PROJECT_NOT_FOUND'; throw e; } return p; }, // live object, like Studio's project cache
    async createProject(req) {
      calls.push(['create', req]);
      const id = `22222222-2222-4222-8222-${String(++n).padStart(12, '0')}`;
      projects.set(id, { id, revision: 1, plan: null, sources: req.inputs.map(f => ({ file: f, name: path.basename(f), duration: DURATION })) });
      return { id, revision: 1, plan: null };
    },
    async editProject(id, req) {
      calls.push(['edit', id, req]);
      const p = projects.get(id);
      if (req.revision !== p.revision) { const e = new Error('Project changed elsewhere.'); e.name = 'StudioError'; e.code = 'REVISION_CONFLICT'; throw e; }
      const clips = req.operations[0].clips.map(c => ({ ...c }));
      const timeline = []; let at = 0;
      for (const c of clips) { timeline.push({ label: c.label, sourceIn: c.start, sourceOut: c.end, timelineIn: at, timelineOut: at + c.end - c.start, duration: c.end - c.start }); at += c.end - c.start; }
      const diff = { summary: `${clips.length} added`, added: clips };
      if (req.dryRun) return { dryRun: true, revision: p.revision, diff, review: { score: 80 }, timeline };
      p.plan = { clips }; p.revision += 1;
      return { project: { id, revision: p.revision }, diff, review: { score: 80 } };
    },
  };
}

function manifest(overrides = {}) {
  return { version: '0.8', source: 'source.mp4', clips: [
    { id: 'clip-01', title: 'Low', score: 63.85, source_start: 8.75, source_end: 33.75 },
    { id: 'clip-02', title: 'High', score: 69.87, source_start: 166.25, source_end: 191.25 },
    { id: 'clip-03', title: 'Edge', score: 65.9, source_start: 162.261, source_end: 192.26 },
  ], ...overrides };
}

/** A fake `spawn` that behaves like rank_only.py: writes the manifest to --output and exits 0. */
function fakeSpawn(spawned, { write = manifest(), code = 0, stdout = 'usage: rank_only.py CutPilot rank-only selection (no renders)' } = {}) {
  return (cmd, args, opts) => {
    spawned.push({ cmd, args, opts });
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
    setImmediate(() => {
      const out = args[args.indexOf('--output') + 1];
      if (args.includes('--help')) child.stdout.emit('data', stdout);
      else if (code === 0 && write) fs.writeFileSync(out, JSON.stringify(write));
      else child.stderr.emit('data', 'Traceback: boom');
      child.emit('close', code);
    });
    return child;
  };
}

function setup(opts = {}) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-repo-'));
  fs.mkdirSync(path.join(repo, 'cutpilot')); fs.writeFileSync(path.join(repo, 'cutpilot', 'rank_only.py'), '# fake');
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-data-'));
  const studio = fakeStudio(), spawned = [], saved = {};
  const svc = createCutPilotService({ studio, dataRoot, env: { CUTPILOT_REPO: repo, CUTPILOT_PYTHON: opts.python ?? 'python' }, platform: 'win32',
    settings: { read: () => saved, write: patch => Object.assign(saved, patch) }, spawnImpl: fakeSpawn(spawned, opts) });
  return { svc, studio, spawned, repo, dataRoot, saved };
}
async function ranked(svc, body = {}) {
  const job = await svc.startRank({ projectId: ORIGINAL, sourceIndex: 0, mode: 'visual', maxClips: 5, minSeconds: 20, maxSeconds: 30, ...body });
  for (let i = 0; i < 100 && svc.job(job.id).status === 'running'; i++) await sleep(5);
  return svc.job(job.id);
}

test('config: env overrides settings; venv and py -3.11 fallbacks; no hard-coded user paths', () => {
  const settings = { cutpilot: { repo: 'D:/CutPilot', python: 'D:/py/python.exe' } };
  assert.deepEqual(resolveCutPilotConfig({ env: {}, settings, platform: 'win32', exists: () => false }),
    { repo: 'D:/CutPilot', repoSource: 'settings', python: 'D:/py/python.exe', pythonArgs: [], pythonSource: 'settings' });
  const env = resolveCutPilotConfig({ env: { CUTPILOT_REPO: 'E:/cp', CUTPILOT_PYTHON: 'E:/py.exe' }, settings, platform: 'win32' });
  assert.equal(env.repo, 'E:/cp'); assert.equal(env.repoSource, 'env'); assert.equal(env.pythonSource, 'env'); assert.deepEqual(env.pythonArgs, ['-3.11']);
  const venv = resolveCutPilotConfig({ env: {}, settings: { cutpilot: { repo: 'D:/CutPilot' } }, platform: 'win32', exists: f => f.endsWith('python.exe') });
  assert.equal(venv.pythonSource, 'repo-venv'); assert.ok(venv.python.endsWith(path.join('.venv', 'Scripts', 'python.exe')));
  const dflt = resolveCutPilotConfig({ env: {}, settings: {}, platform: 'win32', exists: () => false });
  assert.deepEqual([dflt.python, dflt.pythonArgs, dflt.repoSource], ['py', ['-3.11'], 'unset']);
  assert.equal(resolveCutPilotConfig({ env: {}, settings: {}, platform: 'linux', exists: () => false }).python, 'python3');
  for (const f of ['integrations/cutpilot/studio-route.mjs', 'public/cutpilot.js', 'server.mjs']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /Frankie|C:\\\\Users|CutPilot-Retirement-UAT/i, `${f} must not hard-code a user path`);
  }
});

test('ranker call: argument array, no shell, only the project source; browser cannot pick a path', async () => {
  const { svc, spawned } = setup();
  const job = await ranked(svc, { source: 'C:/Windows/evil.mp4', sourcePath: '/etc/passwd', output: 'C:/x.json' });
  assert.equal(job.status, 'done', JSON.stringify(job.error));
  const call = spawned[0];
  assert.equal(call.opts.shell, false); assert.ok(Array.isArray(call.args));
  assert.deepEqual(call.args.slice(0, 2), ['-m', 'cutpilot.rank_only']);
  assert.equal(call.args[call.args.indexOf('--source') + 1], SOURCE_FILE, 'source comes from the Studio project, not the request');
  assert.ok(!call.args.some(a => /evil|passwd|C:\/x\.json/.test(a)));
  assert.deepEqual(call.args.slice(call.args.indexOf('--mode')), ['--mode', 'visual', '--max-clips', '5', '--min-seconds', '20', '--max-seconds', '30']);
  assert.equal(job.sourceFile, undefined, 'server path is not sent back to the browser');
  await assert.rejects(svc.startRank({ projectId: ORIGINAL, sourceIndex: 9 }), { code: 'INVALID_REQUEST' });
  await assert.rejects(svc.startRank({ projectId: ORIGINAL, sourceIndex: 1 }), /video source/);
  await assert.rejects(svc.startRank({ projectId: ORIGINAL, sourceIndex: '0' }), { code: 'INVALID_REQUEST' });
  await assert.rejects(svc.startRank({ projectId: '../../etc', sourceIndex: 0 }), { code: 'INVALID_REQUEST' });
  await assert.rejects(svc.startRank({ projectId: ORIGINAL, sourceIndex: 0, mode: 'montage' }), /mode/);
  assert.deepEqual(CUTPILOT_MODES, ['visual', 'speech'], 'only modes rank_only.py --mode supports');
});

test('candidates keep CutPilot scores, ranking and original source time codes', async () => {
  const { svc } = setup();
  const job = await ranked(svc);
  assert.deepEqual(job.candidates.map(c => [c.rank, c.score, c.title, c.sourceStart, c.sourceEnd]), [
    [1, 69.87, 'High', 166.25, 191.25], [2, 65.9, 'Edge', 162.261, 192.26], [3, 63.85, 'Low', 8.75, 33.75]]);
  assert.equal(job.candidates[0].duration, 25);
  assert.ok(job.candidates.every(c => c.sourceEnd <= DURATION));
});

test('manifest validation: version, source, range, score are enforced (fail closed)', async () => {
  const ok = { sourceName: 'source.mp4', sourceDuration: DURATION };
  assert.doesNotThrow(() => validateCutPilotManifest(manifest(), ok));
  assert.doesNotThrow(() => validateCutPilotManifest(manifest({ clips: [{ score: 50, source_start: 162.261, source_end: 192.261 }] }), ok), 'within the 1 ms tolerance');
  const bad = [
    [manifest({ version: '0.7' }), 'CUTPILOT_MANIFEST_VERSION'],
    [manifest({ source: 'other.mp4' }), 'CUTPILOT_MANIFEST_SOURCE'],
    [manifest({ clips: [{ score: 50, source_start: 162.262, source_end: 192.262 }] }), 'CUTPILOT_MANIFEST_RANGE'],
    [manifest({ clips: [{ score: 50, source_start: -1, source_end: 10 }] }), 'CUTPILOT_MANIFEST_RANGE'],
    [manifest({ clips: [{ score: 101, source_start: 1, source_end: 10 }] }), 'CUTPILOT_MANIFEST_SCORE'],
    [manifest({ clips: [] }), 'CUTPILOT_MANIFEST_INVALID'],
  ];
  for (const [m, code] of bad) assert.throws(() => validateCutPilotManifest(m, ok), { code });
  const { svc } = setup({ write: manifest({ clips: [{ id: 'x', title: 'Past end', score: 50, source_start: 170, source_end: 200 }] }) });
  const job = await ranked(svc);
  assert.equal(job.status, 'failed'); assert.equal(job.error.code, 'CUTPILOT_MANIFEST_RANGE');
  const crash = setup({ code: 1 });
  const failed = await ranked(crash.svc);
  assert.equal(failed.error.code, 'CUTPILOT_FAILED'); assert.match(failed.error.details.stderr, /boom/);
});

test('preview: NEW draft project + dryRun only; the original project is not touched', async () => {
  const { svc, studio } = setup();
  const job = await ranked(svc);
  const before = structuredClone(studio.projects.get(ORIGINAL));
  const p = await svc.preview({ jobId: job.id });
  assert.equal(p.status, 'PREVIEW_ONLY'); assert.notEqual(p.draftProjectId, ORIGINAL);
  const [[kind, create], [, editedId, edit]] = studio.calls;
  assert.equal(kind, 'create'); assert.deepEqual(create.inputs, [SOURCE_FILE]);
  assert.equal(editedId, p.draftProjectId); assert.equal(edit.dryRun, true);
  // CutPilot's windows #1 and #2 overlap; a Studio timeline cannot hold both, so #2 is skipped (ranking unchanged).
  assert.deepEqual(edit.operations[0].clips.map(c => [c.start, c.end, c.sourceIndex]), [[166.25, 191.25, 0], [8.75, 33.75, 0]]);
  assert.deepEqual([p.included, p.skipped], [[1, 3], [2]]);
  assert.equal(studio.projects.get(p.draftProjectId).plan, null, 'dry run saved nothing');
  assert.deepEqual(studio.projects.get(ORIGINAL), before, 'original project unchanged');
  assert.deepEqual([p.original.revisionBefore, p.original.revisionAfter], [7, 7]);
  assert.ok(!studio.calls.some(([, id]) => id === ORIGINAL));
  assert.equal(p.timeline.length, 2);
  // The user may pick other candidates; overlapping picks are refused before anything is created.
  const created = studio.calls.filter(([k]) => k === 'create').length;
  await assert.rejects(svc.preview({ jobId: job.id, include: [1, 2] }), { code: 'CUTPILOT_OVERLAP' });
  await assert.rejects(svc.preview({ jobId: job.id, include: [9] }), { code: 'INVALID_REQUEST' });
  await assert.rejects(svc.preview({ jobId: job.id, include: [] }), { code: 'INVALID_REQUEST' });
  assert.equal(studio.calls.filter(([k]) => k === 'create').length, created);
  const only2 = await svc.preview({ jobId: job.id, include: [2, 3] });
  assert.deepEqual([only2.included, only2.skipped], [[2, 3], [1]]);
});

test('apply: refuses without explicit confirmation, for other projects, and on stale revisions', async () => {
  const { svc, studio } = setup();
  const job = await ranked(svc);
  const p = await svc.preview({ jobId: job.id });
  const edits = () => studio.calls.filter(([k, , r]) => k === 'edit' && r.dryRun === false).length;
  await assert.rejects(svc.apply({ jobId: job.id, draftProjectId: p.draftProjectId, revision: p.revision }), { code: 'CUTPILOT_CONFIRM_REQUIRED', status: 403 });
  await assert.rejects(svc.apply({ jobId: job.id, draftProjectId: p.draftProjectId, revision: p.revision, confirm: 'yes' }), { code: 'CUTPILOT_CONFIRM_REQUIRED' });
  await assert.rejects(svc.apply({ jobId: job.id, draftProjectId: ORIGINAL, revision: 7, confirm: true }), { code: 'CUTPILOT_NOT_PREVIEWED' });
  await assert.rejects(svc.apply({ jobId: job.id, draftProjectId: p.draftProjectId, revision: p.revision + 1, confirm: true }), { code: 'REVISION_CONFLICT' });
  studio.projects.get(p.draftProjectId).revision = 2; // changed elsewhere after the preview
  await assert.rejects(svc.apply({ jobId: job.id, draftProjectId: p.draftProjectId, revision: p.revision, confirm: true }), { code: 'REVISION_CONFLICT' });
  assert.equal(edits(), 0, 'nothing applied silently');
  assert.equal(studio.projects.get(ORIGINAL).revision, 7);
});

test('apply: saves to the draft, verifies the saved timeline, never renders, applies only once', async () => {
  const { svc, studio } = setup();
  const job = await ranked(svc);
  const p = await svc.preview({ jobId: job.id });
  const r = await svc.apply({ jobId: job.id, draftProjectId: p.draftProjectId, revision: p.revision, confirm: true });
  assert.equal(r.status, 'EDIT_APPLIED_TO_NEW_PROJECT'); assert.equal(r.revision, 2); assert.equal(r.clipCount, 2);
  assert.deepEqual(studio.projects.get(p.draftProjectId).plan.clips.map(c => [c.start, c.end]), [[166.25, 191.25], [8.75, 33.75]]);
  assert.equal(studio.projects.get(ORIGINAL).revision, 7, 'original project unaffected');
  assert.ok(!studio.calls.some(([k]) => /export|render/i.test(k)), 'no render without a separate Export');
  await assert.rejects(svc.apply({ jobId: job.id, draftProjectId: p.draftProjectId, revision: 2, confirm: true }), { code: 'CUTPILOT_ALREADY_APPLIED' });
  // A Studio that saves something else is caught by the post-save verification.
  const bad = setup();
  const j2 = await ranked(bad.svc); const p2 = await bad.svc.preview({ jobId: j2.id });
  const real = bad.studio.editProject; bad.studio.editProject = async (id, req) => { const out = await real(id, req); if (!req.dryRun) bad.studio.projects.get(id).plan.clips[0].end -= 3; return out; };
  await assert.rejects(bad.svc.apply({ jobId: j2.id, draftProjectId: p2.draftProjectId, revision: p2.revision, confirm: true }), { code: 'CUTPILOT_VERIFY_FAILED' });
});

test('settings + connection check: validated, saved to settings.json, runs --help without a shell', async () => {
  const { svc, saved, spawned, repo } = setup();
  await assert.rejects(svc.saveSettings({ repo: os.tmpdir() }), { code: 'CUTPILOT_NOT_FOUND' });
  await assert.rejects(svc.saveSettings({ repo, python: 'C:/Windows/System32/cmd.exe' }), { code: 'CUTPILOT_PYTHON_INVALID' });
  await svc.saveSettings({ repo });
  assert.deepEqual(saved, { cutpilot: { repo } });
  const ok = await svc.connectionCheck();
  assert.equal(ok.ok, true); assert.deepEqual(spawned[0].args, ['-m', 'cutpilot.rank_only', '--help']); assert.equal(spawned[0].opts.shell, false);
  const down = setup({ stdout: 'nope', code: 1 });
  await assert.rejects(down.svc.connectionCheck(), { code: 'CUTPILOT_UNREACHABLE' });
});

test('HTTP adapter: status codes and JSON shape', async () => {
  const { svc } = setup();
  const call = async (method, pathname, body = {}) => {
    let out;
    await handleCutPilotApi({ method, pathname, request: {}, svc, readJsonBody: async () => body,
      response: {}, json: (_res, status, value) => { out = { status, value }; } });
    return out;
  };
  assert.equal((await call('GET', '/api/cutpilot/status')).value.repoOk, true);
  const started = await call('POST', '/api/cutpilot/rank', { projectId: ORIGINAL, sourceIndex: 0 });
  assert.equal(started.status, 202);
  for (let i = 0; i < 100 && (await call('GET', `/api/cutpilot/jobs/${started.value.job.id}`)).value.job.status === 'running'; i++) await sleep(5);
  const noConfirm = await call('POST', '/api/cutpilot/apply', { jobId: started.value.job.id });
  assert.equal(noConfirm.status, 403); assert.equal(noConfirm.value.ok, false);
  assert.equal((await call('GET', '/api/cutpilot/nope')).status, 404);
  assert.equal((await call('POST', '/api/cutpilot/rank', { projectId: '33333333-3333-4333-8333-333333333333', sourceIndex: 0 })).status, 404);
});

test('native Find clips and the rest of the editor stay wired up', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  for (const id of ['clips-find', 'clips-make', 'clips-list', 'moments', 'auto-edit-open', 'preview', 'export']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(fs.readFileSync(path.join(ROOT, 'public', 'director07.js'), 'utf8'), /\$\('clips-find'\)\.onclick = findClips;/);
  const server = fs.readFileSync(path.join(ROOT, 'server.mjs'), 'utf8');
  assert.match(server, /find-clips/); assert.match(server, /\/api\/agent\/tools/);
  const studio = fs.readFileSync(path.join(ROOT, 'public', 'studio.js'), 'utf8');
  assert.match(studio, /initDirector07\(/); assert.match(studio, /initCutPilot\(/);
  const panel = fs.readFileSync(path.join(ROOT, 'public', 'cutpilot.js'), 'utf8');
  assert.doesNotMatch(panel, /find-clips/, 'CutPilot panel is separate from native Find clips');
  assert.doesNotMatch(panel, /\/export\b/, 'CutPilot panel never starts a render itself');
});
