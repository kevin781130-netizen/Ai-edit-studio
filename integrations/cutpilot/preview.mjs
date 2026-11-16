#!/usr/bin/env node
// Optional, explicitly authorized localhost-only preview. Never applies or renders.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCutPilotBridgePlan } from './bridge.mjs';

const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function check(ok, reason) { if (!ok) throw new Error(reason); }

export function studioLocalOrigin(input = 'http://127.0.0.1:32146') {
  let url;
  try { url = new URL(input); } catch { throw new Error('Invalid Studio origin'); }
  check(url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port &&
    url.username === '' && url.password === '' && url.pathname === '/' && !url.search && !url.hash,
  'Studio must be an explicit http://127.0.0.1:<port> origin (no credentials, path or redirects)');
  return url.origin;
}

async function callStudio(origin, route, { method = 'GET', body, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(origin + route, {
    method,
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
    headers: { Accept: 'application/json', 'X-Studio-Client': 'cutpilot-preview',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let payload;
  try { payload = await response.json(); } catch { throw new Error(`Studio ${route} returned non-JSON response`); }
  check(response.ok && payload?.ok === true, `Studio ${route} failed: ${String(payload?.error?.code ?? response.status)}`);
  return payload;
}

// Deliberately create only an isolated new draft project; edit is forced to dryRun.
export async function previewInStudio({ manifest, sourcePath, origin = 'http://127.0.0.1:32146', fetchImpl = fetch }) {
  const plan = buildCutPilotBridgePlan(manifest, sourcePath);
  const localOrigin = studioLocalOrigin(origin);
  const request = (route, options) => callStudio(localOrigin, route, { ...options, fetchImpl });

  const health = await request('/api/health');
  check(health.service === 'AI Edit Studio' && health.schemaVersion >= 2 &&
    /^0\.(?:[4-9]|[1-9]\d)\./.test(String(health.version ?? '')),
  'Studio is missing or incompatible (expected AI Edit Studio 0.4+ with schemaVersion >= 2)');
  const capabilities = await request('/api/agent/tools');
  check(Array.isArray(capabilities.tools) && ['studio_create', 'studio_edit', 'studio_get']
    .every(name => capabilities.tools.some(tool => tool?.name === name)),
  'Studio is missing required project and dry-run edit tools');

  let createdProjectId = null;
  try {
    const created = await request('/api/studio/projects', { method: 'POST', body: plan.create.arguments });
    const id = created.project?.id, revision = created.project?.revision;
    if (typeof id === 'string') createdProjectId = id;
    check(PROJECT_ID.test(String(id ?? '')) && Number.isInteger(revision) && revision >= 1 &&
      created.project.plan == null, 'Unexpected Studio project response or nonempty initial plan');

    const edit = buildCutPilotBridgePlan(manifest, sourcePath, { projectId: id, revision }).edit;
    check(edit.arguments.dryRun === true && edit.arguments.operations.length === 1 &&
      edit.arguments.operations[0].op === 'replace', 'Bridge produced an unsafe edit plan');
    const { projectId: _unused, ...safeEdit } = edit.arguments;
    const preview = await request(`/api/studio/projects/${id}/edit`, {
      method: 'POST', body: { ...safeEdit, dryRun: true },
    });
    check(preview.dryRun === true && preview.revision === revision &&
      preview.timeline && typeof preview.timeline === 'object',
    'Studio did not confirm a dry-run edit preview');

    const persisted = await request(`/api/studio/projects/${id}`);
    check(persisted.project?.id === id && persisted.project.revision === revision &&
      persisted.project.plan == null,
    'Safety check failed: preview project revision/plan changed');

    return {
      contract: 'cutpilot-aes-preview/v1', status: 'PREVIEW_ONLY', projectId: id,
      revision, source: plan.create.arguments.inputs[0], ranked: plan.ranked,
      review: preview.review, timeline: preview.timeline, diff: preview.diff,
      note: 'No edit applied or media rendered. Inspect in AI Edit Studio; apply requires a separate explicit operator action.',
    };
  } catch (error) {
    if (createdProjectId) error.message += `; isolated draft project may exist: ${createdProjectId}`;
    throw error;
  }
}

export async function main(argv, { fetchImpl = fetch } = {}) {
  const args = new Map();
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    check(key.startsWith('--'), 'Unexpected positional argument');
    check(!args.has(key), `Duplicate argument: ${key}`);
    if (key === '--create-preview-project') { args.set(key, true); continue; }
    check(['--manifest', '--source', '--port'].includes(key) && argv[i + 1] &&
      !argv[i + 1].startsWith('--'), `Unknown or missing option: ${key}`);
    args.set(key, argv[++i]);
  }
  check(args.has('--create-preview-project'),
    'Explicit --create-preview-project required; this creates one NEW isolated Studio project');
  const manifestFile = args.get('--manifest'), sourcePath = args.get('--source');
  check(typeof manifestFile === 'string' && fs.statSync(manifestFile).isFile(), 'Manifest is missing');
  check(typeof sourcePath === 'string' && fs.statSync(sourcePath).isFile(), 'Original source video is missing');
  const port = args.get('--port') ?? '32146';
  check(/^\d{1,5}$/.test(port) && Number(port) >= 1 && Number(port) <= 65535, 'Invalid Studio port');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const result = await previewInStudio({ manifest, sourcePath, origin: `http://127.0.0.1:${port}`, fetchImpl });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch(error => {
    console.error(`CUTPILOT_PREVIEW_REJECTED: ${error.message}`);
    process.exitCode = 1;
  });
}
