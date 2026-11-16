// CutPilot AI clip selection inside the AI Edit Studio editor (local server side).
//
// Self-contained integration module: server.mjs forwards /api/cutpilot/* here and nothing else in the
// Studio engine changes. CutPilot ranks (rank_only.py, run as a child process with an argument array,
// never a shell); Studio stays the editor/render engine. The browser only sends a projectId and a
// sourceIndex, never a server file path. Flow: rank → preview (NEW draft project + dryRun) → apply
// (explicit confirm + revision guard + verify) → render only through Studio's own Export, on request.
import { spawn as nodeSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildCutPilotBridgePlan } from './bridge.mjs';

export const CUTPILOT_ADAPTER_VERSION = '1.0.0';
export const CUTPILOT_MODES = Object.freeze(['visual', 'speech']); // what rank_only.py --mode accepts
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TIME_TOLERANCE = 0.001; // same tolerance as cutpilot/rank_only.py
const RANK_TIMEOUT_MS = 30 * 60_000;
const CHECK_TIMEOUT_MS = 60_000;
const MAX_JOBS = 20;
const PYTHON_NAME = /^(?:python(?:3(?:\.\d+)?)?|py)(?:\.exe)?$/i;

export class CutPilotError extends Error {
  constructor(code, message, status = 400, details = {}) { super(message); this.code = code; this.status = status; this.details = details; }
}
const fail = (code, message, status = 400, details) => { throw new CutPilotError(code, message, status, details); };
const check = (ok, code, message, status = 400) => { if (!ok) fail(code, message, status); };
const finite = v => typeof v === 'number' && Number.isFinite(v);
const sameName = (a, b) => path.win32.basename(String(a).replaceAll('/', '\\')).toLowerCase()
  === path.win32.basename(String(b).replaceAll('/', '\\')).toLowerCase();

/** Where CutPilot lives. Environment variables win over the saved settings; nothing is hard-coded. */
export function resolveCutPilotConfig({ env = process.env, settings = {}, platform = process.platform, exists = fs.existsSync } = {}) {
  const saved = settings?.cutpilot && typeof settings.cutpilot === 'object' ? settings.cutpilot : {};
  const repo = String(env.CUTPILOT_REPO || saved.repo || '').trim();
  const repoSource = env.CUTPILOT_REPO ? 'env' : saved.repo ? 'settings' : 'unset';
  let python = String(env.CUTPILOT_PYTHON || saved.python || '').trim();
  let pythonSource = env.CUTPILOT_PYTHON ? 'env' : saved.python ? 'settings' : 'default';
  if (!python && repo) {
    const venv = platform === 'win32' ? path.join(repo, '.venv', 'Scripts', 'python.exe') : path.join(repo, '.venv', 'bin', 'python');
    if (exists(venv)) { python = venv; pythonSource = 'repo-venv'; }
  }
  const pythonArgs = [];
  if (!python) python = platform === 'win32' ? 'py' : 'python3';
  if (/^py(?:\.exe)?$/i.test(path.basename(python)) && platform === 'win32') pythonArgs.push('-3.11');
  return { repo, repoSource, python, pythonArgs, pythonSource };
}

export function validateRepo(repo, { exists = fs.existsSync } = {}) {
  check(typeof repo === 'string' && repo && path.isAbsolute(repo), 'CUTPILOT_NOT_CONFIGURED', 'Set the CutPilot folder (CUTPILOT_REPO or CutPilot settings).');
  check(!/^(?:\\\\|\/\/)/.test(repo), 'CUTPILOT_NOT_CONFIGURED', 'Network paths are not allowed for the CutPilot folder.');
  check(exists(path.join(repo, 'cutpilot', 'rank_only.py')), 'CUTPILOT_NOT_FOUND', 'This folder does not contain CutPilot (cutpilot/rank_only.py is missing).');
  return repo;
}

export function validatePython(python) {
  check(typeof python === 'string' && python.length > 0 && python.length < 1024 && !python.includes('\0'), 'CUTPILOT_PYTHON_INVALID', 'Invalid Python executable.');
  check(PYTHON_NAME.test(path.basename(python)), 'CUTPILOT_PYTHON_INVALID', 'The Python executable must be python, python3, python.exe or py.exe.');
  if (python.includes('/') || python.includes('\\')) {
    check(path.isAbsolute(python) && fs.existsSync(python) && fs.statSync(python).isFile(), 'CUTPILOT_PYTHON_INVALID', 'Python executable not found.');
  }
  return python;
}

/** Manifest checks on top of the bridge: version, source file, times inside the real source, scores. */
export function validateCutPilotManifest(manifest, { sourceName, sourceDuration, maxClips = 200 } = {}) {
  check(manifest && typeof manifest === 'object' && !Array.isArray(manifest), 'CUTPILOT_MANIFEST_INVALID', 'CutPilot returned no manifest.');
  check(manifest.version === '0.8', 'CUTPILOT_MANIFEST_VERSION', 'Unsupported CutPilot manifest version (expected 0.8).');
  check(typeof manifest.source === 'string' && sameName(manifest.source, sourceName), 'CUTPILOT_MANIFEST_SOURCE', 'The CutPilot manifest is for a different source file.');
  check(Array.isArray(manifest.clips) && manifest.clips.length >= 1 && manifest.clips.length <= maxClips, 'CUTPILOT_MANIFEST_INVALID', 'CutPilot returned an unexpected number of clips.');
  check(finite(sourceDuration) && sourceDuration > 0, 'CUTPILOT_MANIFEST_INVALID', 'Unknown source duration.');
  manifest.clips.forEach((clip, i) => {
    const { source_start: start, source_end: end, score } = clip ?? {};
    check(finite(start) && finite(end) && start >= 0 && end > start && end - start >= 0.5 && end <= sourceDuration + TIME_TOLERANCE,
      'CUTPILOT_MANIFEST_RANGE', `CutPilot clip ${i + 1} lies outside the source video.`);
    check(finite(score) && score >= 0 && score <= 100, 'CUTPILOT_MANIFEST_SCORE', `CutPilot clip ${i + 1} has an invalid score.`);
  });
  return manifest;
}

function tail(text, limit = 4000) { return String(text ?? '').slice(-limit); }

function runProcess(spawnImpl, command, args, { cwd, timeoutMs }) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawnImpl(command, args, { cwd, shell: false, windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) { resolve({ code: null, error, stdout: '', stderr: '' }); return; }
    let stdout = '', stderr = '', done = false;
    const finish = result => { if (!done) { done = true; clearTimeout(timer); resolve({ stdout: tail(stdout), stderr: tail(stderr), ...result }); } };
    const timer = setTimeout(() => { try { child.kill(); } catch { /* already gone */ } finish({ code: null, timedOut: true }); }, timeoutMs);
    child.stdout?.on('data', d => { stdout = tail(stdout + d, 20000); });
    child.stderr?.on('data', d => { stderr = tail(stderr + d, 20000); });
    child.on('error', error => finish({ code: null, error }));
    child.on('close', code => finish({ code }));
  });
}

const sameSpan = (a, b) => Math.abs(a - b) <= 0.02;
const OVERLAP_EPS = 0.001; // Studio's own rule: two clips may not share footage of the same source
const overlaps = (a, b) => Math.min(a.sourceEnd, b.sourceEnd) - Math.max(a.sourceStart, b.sourceStart) > OVERLAP_EPS;

/**
 * Which ranked candidates go on the preview timeline. CutPilot's windows may overlap, a Studio timeline may not.
 * Without `include`, take candidates in CutPilot rank order and skip any that overlaps a higher-ranked one
 * (ranking and scores are not changed). With `include` (rank numbers chosen by the user), refuse overlaps.
 */
export function chooseTimelineCandidates(candidates, include) {
  if (include === undefined || include === null) {
    const chosen = [];
    for (const c of candidates) if (!chosen.some(k => overlaps(k, c))) chosen.push(c);
    return chosen;
  }
  check(Array.isArray(include) && include.length >= 1 && include.length <= candidates.length && include.every(Number.isInteger)
    && new Set(include).size === include.length, 'INVALID_REQUEST', 'Choose at least one CutPilot candidate.');
  const chosen = candidates.filter(c => include.includes(c.rank));
  check(chosen.length === include.length, 'INVALID_REQUEST', 'Unknown CutPilot candidate.');
  for (let i = 0; i < chosen.length; i++) for (let j = i + 1; j < chosen.length; j++) {
    if (overlaps(chosen[i], chosen[j])) fail('CUTPILOT_OVERLAP', `CutPilot candidates #${chosen[i].rank} and #${chosen[j].rank} share footage; a timeline cannot use it twice. Untick one of them.`, 400);
  }
  return chosen;
}
const manifestFor = (manifest, chosen) => ({ ...manifest, clips: manifest.clips.filter(c => chosen.some(k => k.cutpilotId === String(c.id ?? '')
  && k.sourceStart === c.source_start && k.sourceEnd === c.source_end)) });

/**
 * The CutPilot service. Studio functions are injected so tests run without media or Python.
 * studio: { getProject, createProject, editProject }; settings: { read(), write(patch) }.
 */
export function createCutPilotService({ studio, settings, dataRoot, env = process.env, platform = process.platform, spawnImpl = nodeSpawn } = {}) {
  const jobs = new Map();
  let running = null;

  const config = () => resolveCutPilotConfig({ env, settings: settings.read(), platform });
  const command = cfg => ({ cmd: cfg.python, prefix: cfg.pythonArgs });

  function publicJob(job) {
    const { sourceFile: _hidden, manifestPath: _m, plan: _p, ...rest } = job;
    return rest;
  }
  function remember(job) {
    jobs.set(job.id, job);
    while (jobs.size > MAX_JOBS) jobs.delete(jobs.keys().next().value);
  }
  function getJob(id) {
    check(typeof id === 'string' && UUID.test(id), 'CUTPILOT_JOB_NOT_FOUND', 'CutPilot analysis not found.', 404);
    const job = jobs.get(id);
    check(job, 'CUTPILOT_JOB_NOT_FOUND', 'CutPilot analysis not found.', 404);
    return job;
  }

  async function status() {
    const cfg = config();
    let repoOk = false, repoError = null;
    try { validateRepo(cfg.repo); repoOk = true; } catch (e) { repoError = e.code; }
    return { adapterVersion: CUTPILOT_ADAPTER_VERSION, modes: CUTPILOT_MODES, repo: cfg.repo, repoSource: cfg.repoSource,
      python: cfg.python, pythonArgs: cfg.pythonArgs, pythonSource: cfg.pythonSource, repoOk, repoError,
      envOverride: { repo: Boolean(env.CUTPILOT_REPO), python: Boolean(env.CUTPILOT_PYTHON) },
      running: running ? running.id : null };
  }

  async function saveSettings(body = {}) {
    const repo = String(body.repo ?? '').trim(), python = String(body.python ?? '').trim();
    if (repo) validateRepo(repo);
    if (python) validatePython(python);
    await settings.write({ cutpilot: { ...(repo ? { repo } : {}), ...(python ? { python } : {}) } });
    return status();
  }

  async function connectionCheck() {
    const cfg = config();
    validateRepo(cfg.repo); validatePython(cfg.python);
    const { cmd, prefix } = command(cfg);
    const result = await runProcess(spawnImpl, cmd, [...prefix, '-m', 'cutpilot.rank_only', '--help'], { cwd: cfg.repo, timeoutMs: CHECK_TIMEOUT_MS });
    const ok = result.code === 0 && /rank-only/i.test(result.stdout);
    if (!ok) fail('CUTPILOT_UNREACHABLE', 'CutPilot could not be started with this Python. Check the Python path and CutPilot dependencies.', 502,
      { stderr: tail(result.stderr || result.error?.message, 1500), timedOut: Boolean(result.timedOut) });
    return { ok: true, ...(await status()) };
  }

  async function startRank(body = {}) {
    check(!running, 'CUTPILOT_BUSY', 'A CutPilot analysis is already running.', 409);
    const projectId = String(body.projectId ?? '');
    check(UUID.test(projectId), 'INVALID_REQUEST', 'Invalid projectId.');
    const sourceIndex = body.sourceIndex;
    check(Number.isInteger(sourceIndex) && sourceIndex >= 0, 'INVALID_REQUEST', 'Invalid sourceIndex.');
    const mode = String(body.mode ?? 'visual');
    check(CUTPILOT_MODES.includes(mode), 'INVALID_REQUEST', 'Unsupported CutPilot mode.');
    const maxClips = Number(body.maxClips ?? 5), minSeconds = Number(body.minSeconds ?? 20), maxSeconds = Number(body.maxSeconds ?? 55);
    check(Number.isInteger(maxClips) && maxClips >= 1 && maxClips <= 20, 'INVALID_REQUEST', 'Number of candidates must be 1 to 20.');
    check(finite(minSeconds) && finite(maxSeconds) && minSeconds >= 0.5 && minSeconds < maxSeconds && maxSeconds <= 1200,
      'INVALID_REQUEST', 'Shortest must be at least 0.5 s and below longest (max. 1200 s).');

    const project = await studio.getProject(projectId);
    const source = project.sources?.[sourceIndex];
    check(source, 'INVALID_REQUEST', 'This project has no source with that number.');
    check(!source.still, 'INVALID_REQUEST', 'CutPilot needs a video source, not an image.');
    check(finite(source.duration) && source.duration >= minSeconds, 'INVALID_REQUEST', 'The source is shorter than the shortest clip.');
    const cfg = config();
    validateRepo(cfg.repo); validatePython(cfg.python);

    const id = randomUUID();
    const folder = path.join(dataRoot, 'cutpilot', id);
    await fs.promises.mkdir(folder, { recursive: true });
    const manifestPath = path.join(folder, 'frontend_manifest.json');
    const job = { id, status: 'running', projectId, projectRevision: project.revision, sourceIndex, sourceName: source.name ?? path.basename(source.file),
      sourceDuration: source.duration, sourceFile: source.file, manifestPath, mode, maxClips, minSeconds, maxSeconds,
      startedAt: new Date().toISOString(), finishedAt: null, candidates: [], error: null, preview: null, applied: null };
    remember(job); running = job;
    const { cmd, prefix } = command(cfg);
    const args = [...prefix, '-m', 'cutpilot.rank_only', '--source', source.file, '--output', manifestPath, '--mode', mode,
      '--max-clips', String(maxClips), '--min-seconds', String(minSeconds), '--max-seconds', String(maxSeconds)];
    void runProcess(spawnImpl, cmd, args, { cwd: cfg.repo, timeoutMs: RANK_TIMEOUT_MS }).then(async result => {
      try {
        if (result.timedOut) fail('CUTPILOT_TIMEOUT', 'CutPilot analysis took too long and was stopped.', 504);
        if (result.code !== 0) fail('CUTPILOT_FAILED', 'CutPilot analysis failed.', 502, { stderr: tail(result.stderr || result.error?.message, 1500) });
        const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
        validateCutPilotManifest(manifest, { sourceName: job.sourceName, sourceDuration: job.sourceDuration, maxClips });
        const plan = buildCutPilotBridgePlan(manifest, source.file);
        const labels = plan.edit.arguments.operations[0].clips;
        job.plan = plan; job.manifest = manifest;
        job.candidates = plan.ranked.map((row, i) => ({ rank: row.rank, cutpilotId: row.cutpilotId, score: row.score,
          sourceStart: row.sourceStart, sourceEnd: row.sourceEnd, duration: Number((row.sourceEnd - row.sourceStart).toFixed(3)), title: labels[i].label }));
        job.status = 'done';
      } catch (error) {
        job.status = 'failed';
        job.error = { code: error.code ?? 'CUTPILOT_FAILED', message: error instanceof CutPilotError || error instanceof SyntaxError ? error.message : 'CutPilot analysis failed.',
          details: error.details ?? {} };
      } finally { job.finishedAt = new Date().toISOString(); if (running === job) running = null; }
    });
    return publicJob(job);
  }

  async function preview(body = {}) {
    const job = getJob(String(body.jobId ?? ''));
    check(job.status === 'done' && job.plan, 'CUTPILOT_NOT_READY', 'The CutPilot analysis has not finished.', 409);
    const chosen = chooseTimelineCandidates(job.candidates, body.include);
    const chosenManifest = manifestFor(job.manifest, chosen);
    check(chosenManifest.clips.length === chosen.length, 'CUTPILOT_PREVIEW_FAILED', 'Could not match the chosen candidates to the CutPilot manifest.', 500);
    const originalBefore = (await studio.getProject(job.projectId)).revision;
    const created = await studio.createProject({ ...job.plan.create.arguments, author: 'cutpilot' });
    const id = created?.id, revision = created?.revision;
    check(UUID.test(String(id ?? '')) && Number.isInteger(revision) && created.plan == null, 'CUTPILOT_PREVIEW_FAILED', 'Studio did not create an empty draft project.', 500);
    const edit = buildCutPilotBridgePlan(chosenManifest, job.sourceFile, { projectId: id, revision }).edit.arguments;
    const { projectId: _drop, ...args } = edit;
    const dry = await studio.editProject(id, { ...args, dryRun: true, author: 'cutpilot' });
    check(dry?.dryRun === true && dry.revision === revision, 'CUTPILOT_PREVIEW_FAILED', 'Studio did not confirm a dry-run preview.', 500);
    const persisted = await studio.getProject(id);
    check(persisted.revision === revision && persisted.plan == null, 'CUTPILOT_PREVIEW_FAILED', 'Safety check failed: the draft changed during the preview.', 500);
    const originalAfter = (await studio.getProject(job.projectId)).revision;
    job.preview = { draftProjectId: id, revision, manifest: chosenManifest, ranks: chosen.map(c => c.rank), at: new Date().toISOString() };
    job.applied = null;
    return { jobId: job.id, status: 'PREVIEW_ONLY', draftProjectId: id, revision, candidates: job.candidates,
      included: chosen.map(c => c.rank), skipped: job.candidates.filter(c => !chosen.includes(c)).map(c => c.rank),
      timeline: dry.timeline, diff: dry.diff, review: dry.review, warnings: dry.warnings ?? [],
      original: { projectId: job.projectId, revisionBefore: originalBefore, revisionAfter: originalAfter } };
  }

  async function apply(body = {}) {
    const job = getJob(String(body.jobId ?? ''));
    check(body.confirm === true, 'CUTPILOT_CONFIRM_REQUIRED', 'Applying needs your explicit confirmation.', 403);
    check(job.preview && body.draftProjectId === job.preview.draftProjectId, 'CUTPILOT_NOT_PREVIEWED',
      'Only the draft project made by this CutPilot preview can be applied.', 403);
    check(!job.applied, 'CUTPILOT_ALREADY_APPLIED', 'This CutPilot selection was already applied.', 409);
    const id = job.preview.draftProjectId;
    check(body.revision === job.preview.revision, 'REVISION_CONFLICT', 'The draft project changed since the preview. Preview again.', 409);
    const before = await studio.getProject(id);
    const beforeRevision = before.revision; // Studio returns its live cached project object: copy the number
    check(before.revision === job.preview.revision && before.plan == null, 'REVISION_CONFLICT', 'The draft project changed since the preview. Preview again.', 409);
    const edit = buildCutPilotBridgePlan(job.preview.manifest, job.sourceFile, { projectId: id, revision: beforeRevision }).edit.arguments;
    const { projectId: _drop, ...args } = edit;
    const planned = args.operations[0].clips;
    const result = await studio.editProject(id, { ...args, dryRun: false, summary: 'CutPilot AI selection applied', author: 'cutpilot' });
    const saved = await studio.getProject(id);
    const clips = saved.plan?.clips ?? [];
    const okSaved = saved.revision === beforeRevision + 1 && clips.length === planned.length
      && planned.every((p, i) => clips[i].sourceIndex === 0 && sameSpan(clips[i].start, p.start) && sameSpan(clips[i].end, p.end));
    check(okSaved, 'CUTPILOT_VERIFY_FAILED', 'The saved timeline does not match the CutPilot selection.', 500);
    job.applied = { draftProjectId: id, revision: saved.revision, at: new Date().toISOString() };
    return { jobId: job.id, status: 'EDIT_APPLIED_TO_NEW_PROJECT', draftProjectId: id, revision: saved.revision,
      clipCount: clips.length, diff: result?.diff, review: result?.review,
      note: 'Rendering only starts when you export this project yourself.' };
  }

  return { status, saveSettings, connectionCheck, startRank, preview, apply,
    job: id => publicJob(getJob(id)), _jobs: jobs };
}

// ------------------------------------------------------------------ HTTP adapter
let defaultService;
async function service() {
  if (defaultService) return defaultService;
  const [studio, paths, settingsMod, integrations] = await Promise.all([
    import('../../src/studio.mjs'), import('../../src/paths.mjs'), import('../../src/settings.mjs'), import('../../src/integrations.mjs')]);
  defaultService = createCutPilotService({
    studio: { getProject: studio.getProject, createProject: studio.createProject, editProject: studio.editProject },
    settings: { read: () => settingsMod.readUserSettings(), write: patch => integrations.writeUserSettings(patch) },
    dataRoot: paths.DATA_ROOT,
  });
  return defaultService;
}

/** Called by server.mjs for /api/cutpilot/*. `svc` lets tests inject a service. */
export async function handleCutPilotApi({ method, pathname, request, response, json, readJsonBody, svc }) {
  try {
    const s = svc ?? await service();
    const body = method === 'POST' ? await readJsonBody(request) : {};
    let result;
    if (method === 'GET' && pathname === '/api/cutpilot/status') result = await s.status();
    else if (method === 'POST' && pathname === '/api/cutpilot/settings') result = await s.saveSettings(body);
    else if (method === 'POST' && pathname === '/api/cutpilot/check') result = await s.connectionCheck();
    else if (method === 'POST' && pathname === '/api/cutpilot/rank') return json(response, 202, { ok: true, job: await s.startRank(body) });
    else if (method === 'GET' && pathname.startsWith('/api/cutpilot/jobs/')) result = { job: s.job(pathname.slice('/api/cutpilot/jobs/'.length)) };
    else if (method === 'POST' && pathname === '/api/cutpilot/preview') result = await s.preview(body);
    else if (method === 'POST' && pathname === '/api/cutpilot/apply') result = await s.apply(body);
    else fail('ROUTE_NOT_FOUND', 'This local API route does not exist.', 404);
    return json(response, 200, { ok: true, ...result });
  } catch (error) {
    const status = error instanceof CutPilotError ? error.status
      : error?.code === 'PROJECT_NOT_FOUND' ? 404 : error?.code === 'REVISION_CONFLICT' || error?.code === 'PROJECT_BUSY' ? 409
        : error?.name === 'StudioError' ? 400 : 500;
    const known = error instanceof CutPilotError || error?.name === 'StudioError';
    return json(response, status, { ok: false, error: { code: error?.code ?? 'INTERNAL_ERROR',
      message: known ? error.message : 'The local server encountered an unexpected error.', details: known ? (error.details ?? {}) : {} } });
  }
}
