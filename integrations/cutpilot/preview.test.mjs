import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main, previewInStudio, studioLocalOrigin } from './preview.mjs';

const ID = 'b1d8b4fe-e18b-4f72-9d01-595ff11c9064';
const manifest = { version: '0.8', source: 'source.mp4', clips: [
  { id: 'a', title: 'strong', score: 95, source_start: 14, source_end: 20 },
  { id: 'b', title: 'weak', score: 55, source_start: 2, source_end: 9 },
] };
const sourcePath = '/virtual/source.mp4';
const health = { ok: true, service: 'AI Edit Studio', version: '0.12.0', schemaVersion: 2 };
const tools = { ok: true, tools: ['studio_create', 'studio_edit', 'studio_get'].map(name => ({ name })) };
const created = { ok: true, project: { id: ID, revision: 1, plan: null } };
const preview = { ok: true, dryRun: true, revision: 1, review: { score: 90 }, timeline: { clips: [1, 2] }, diff: { summary: 'replace' } };
const unchanged = { ok: true, project: { id: ID, revision: 1, plan: null } };

function fakeHttp({ responseOverrides = {}, calls = [] } = {}) {
  const responses = {
    'GET /api/health': health,
    'GET /api/agent/tools': tools,
    'POST /api/studio/projects': created,
    [`POST /api/studio/projects/${ID}/edit`]: preview,
    [`GET /api/studio/projects/${ID}`]: unchanged,
    ...responseOverrides,
  };
  return async (url, init) => {
    const u = new URL(url);
    assert.equal(u.hostname, '127.0.0.1');
    assert.equal(init.redirect, 'error');
    const k = `${init.method} ${u.pathname}`;
    calls.push({ key: k, body: init.body ? JSON.parse(init.body) : undefined });
    const payload = responses[k];
    assert.notEqual(payload, undefined, `Unexpected API request: ${k}`);
    return { ok: true, status: 200, json: async () => payload };
  };
}

test('full localhost preview: one new project, dryRun-only edit, revision and plan unchanged', async () => {
  const calls = [];
  const result = await previewInStudio({ manifest, sourcePath, fetchImpl: fakeHttp({ calls }) });
  assert.equal(result.status, 'PREVIEW_ONLY');
  assert.equal(result.projectId, ID);
  assert.equal(result.review.score, 90);
  assert.deepEqual(calls.map(c => c.key), [
    'GET /api/health', 'GET /api/agent/tools', 'POST /api/studio/projects',
    `POST /api/studio/projects/${ID}/edit`, `GET /api/studio/projects/${ID}`,
  ]);
  assert.equal(calls[2].body.inputs[0], sourcePath);
  assert.equal(calls[3].body.dryRun, true);
  assert.equal(calls[3].body.revision, 1);
  assert.equal(calls[3].body.operations[0].op, 'replace');
  assert.deepEqual(calls[3].body.operations[0].clips.map(c => c.start), [14, 2]);
  assert.ok(!calls.some(c => c.key.includes('export')));
});

test('bad manifest and unsafe URL fail before making any requests', async () => {
  const calls = [];
  const fetchImpl = fakeHttp({ calls });
  for (const origin of ['https://127.0.0.1:32146', 'http://localhost:32146', 'http://192.168.1.1:32146', 'http://127.0.0.1:32146/other', 'http://127.0.0.1:32146@evil.com']) {
    assert.throws(() => studioLocalOrigin(origin));
  }
  await assert.rejects(previewInStudio({ manifest: { ...manifest, source: 'other.mp4' }, sourcePath, fetchImpl }), /does not match/);
  assert.equal(calls.length, 0);
});

test('incompatible Studio and missing tools fail before creating a project', async () => {
  for (const responses of [
    { 'GET /api/health': { ...health, schemaVersion: 1 } },
    { 'GET /api/agent/tools': { ok: true, tools: [{ name: 'studio_create' }] } },
  ]) {
    const calls = [];
    await assert.rejects(previewInStudio({ manifest, sourcePath, fetchImpl: fakeHttp({ calls, responseOverrides: responses }) }), /incompatible|missing required/);
    assert.equal(calls.filter(x => x.key === 'POST /api/studio/projects').length, 0);
  }
});

test('rejects absent dryRun acknowledgement; never retries as an applying edit', async () => {
  const calls = [];
  await assert.rejects(previewInStudio({ manifest, sourcePath, fetchImpl: fakeHttp({ calls, responseOverrides: {
    [`POST /api/studio/projects/${ID}/edit`]: { ...preview, dryRun: false },
  } }) }), /did not confirm.*isolated draft project/);
  const edits = calls.filter(c => c.key.includes('/edit'));
  assert.equal(edits.length, 1);
  assert.equal(edits[0].body.dryRun, true);
});

test('detects unexpected revision change after preview', async () => {
  await assert.rejects(previewInStudio({ manifest, sourcePath, fetchImpl: fakeHttp({ responseOverrides: {
    [`GET /api/studio/projects/${ID}`]: { ok: true, project: { id: ID, revision: 2, plan: {} } },
  } }) }), /revision\/plan changed/);
});

test('CLI refuses creation without explicit flag', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cutpilot-preview-'));
  try {
    const input = path.join(dir, 'source.mp4');
    const mf = path.join(dir, 'frontend_manifest.json');
    fs.writeFileSync(input, 'fixture');
    fs.writeFileSync(mf, JSON.stringify(manifest));
    const script = fileURLToPath(new URL('./preview.mjs', import.meta.url));
    const p = spawnSync(process.execPath, [script, '--manifest', mf, '--source', input], { encoding: 'utf8' });
    assert.equal(p.status, 1);
    assert.match(p.stderr, /Explicit --create-preview-project required/);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['frontend_manifest.json', 'source.mp4']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('actual loopback HTTP transport reaches API endpoints and never commits an edit', async () => {
  const { createServer } = await import('node:http');
  const seen = [];
  const server = createServer(async (req, res) => {
    const route = `${req.method} ${req.url}`;
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
    seen.push({ route, body });
    const data = {
      'GET /api/health': health, 'GET /api/agent/tools': tools,
      'POST /api/studio/projects': created,
      [`POST /api/studio/projects/${ID}/edit`]: preview,
      [`GET /api/studio/projects/${ID}`]: unchanged,
    }[route];
    res.writeHead(data ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data ?? { ok: false, error: { code: 'NOT_FOUND' } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const outcome = await previewInStudio({ manifest, sourcePath, origin: `http://127.0.0.1:${port}` });
    assert.equal(outcome.status, 'PREVIEW_ONLY');
    assert.equal(seen.length, 5);
    assert.equal(seen.filter(x => x.route.endsWith('/edit'))[0].body.dryRun, true);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
