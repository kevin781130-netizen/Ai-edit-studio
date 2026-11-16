#!/usr/bin/env node
// CutPilot branded, AI Edit Studio-backed UAT: every run creates ONE new project.
// Never touches existing projects, source media, CutPilot engine, or upstream code.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { previewInStudio, studioLocalOrigin } from './preview.mjs';
import { buildCutPilotBridgePlan } from './bridge.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const assert = (value, why) => { if (!value) throw new Error(why); };
const short = value => String(value ?? '').slice(0, 160);
const same = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= 0.02;

async function studio(origin, route, { method = 'GET', body, timeout = 15000, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(origin + route, {
    method, redirect: 'error', signal: AbortSignal.timeout(timeout),
    headers: { Accept: 'application/json', 'X-Studio-Client': 'cutpilot-uat',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => null);
  assert(response.ok && payload?.ok === true,
    `Studio ${method} ${route} failed: ${short(payload?.error?.code ?? response.status)}`);
  return payload;
}

function assertSavedPlan(project, id, revision, plannedClips) {
  assert(project?.id === id && project.revision === revision, 'Project id/revision changed unexpectedly');
  const saved = project.plan?.clips;
  assert(Array.isArray(saved) && saved.length === plannedClips.length,
    'Saved timeline does not contain the expected CutPilot selections');
  for (let i = 0; i < plannedClips.length; i++) {
    const actual = saved[i], expected = plannedClips[i];
    assert(actual.sourceIndex === 0 && same(actual.start, expected.start) && same(actual.end, expected.end),
      `Saved clip ${i + 1} differs from the requested source span`);
  }
}

/** One isolated project, dry-run, optional explicitly authorized apply and export. */
export async function runCutPilotUat({ manifest, sourcePath, origin = 'http://127.0.0.1:32146',
  apply = false, render = false, fetchImpl = fetch, maxWaitMs = 900000 } = {}) {
  assert(!render || apply, 'Rendering requires explicit apply authorization');
  const endpoint = studioLocalOrigin(origin);
  const review = await previewInStudio({ manifest, sourcePath, origin: endpoint, fetchImpl });
  assert(review.status === 'PREVIEW_ONLY' && UUID.test(review.projectId), 'Preview did not return an isolated project');
  const result = {
    contract: 'cutpilot-aes-retirement-uat/v1', status: 'PREVIEW_ONLY',
    projectId: review.projectId, dryRunRevision: review.revision,
    ranked: review.ranked, review: review.review, previewTimeline: review.timeline,
    stages: ['ranked_manifest', 'isolated_project', 'dry_run'],
  };
  if (!apply) return result;
  const plan = buildCutPilotBridgePlan(manifest, sourcePath, { projectId: review.projectId, revision: review.revision });
  const proposed = plan.edit.arguments.operations[0].clips;
  const projectRoute = `/api/studio/projects/${review.projectId}`;
  try {
    // Check once more before the ONLY edit-apply request; refuse changed revisions or plans.
    const before = (await studio(endpoint, projectRoute, { fetchImpl })).project;
    assert(before?.revision === review.revision && before.plan == null,
      'Project changed since preview; applying is forbidden');
    const { projectId: _, ...argumentsToApply } = plan.edit.arguments;
    const applied = await studio(endpoint, `${projectRoute}/edit`, {
      method: 'POST', body: { ...argumentsToApply, dryRun: false }, fetchImpl,
    });
    const expectedRevision = review.revision + 1;
    assertSavedPlan(applied.project, review.projectId, expectedRevision, proposed);
    const verified = (await studio(endpoint, projectRoute, { fetchImpl })).project;
    assertSavedPlan(verified, review.projectId, expectedRevision, proposed);
    result.status = 'EDIT_APPLIED_TO_NEW_PROJECT';
    result.appliedRevision = expectedRevision;
    result.stages.push('authorized_new_project_edit', 'persisted_source_span_verify');
    if (!render) return result;

    const started = await studio(endpoint, `${projectRoute}/export`, {
      method: 'POST', body: { revision: expectedRevision, formats: ['vertical'], queue: false }, fetchImpl,
    });
    assert(started.project?.id === review.projectId && started.project.revision === expectedRevision,
      'Render did not acknowledge the expected project and revision');
    let current = started.project;
    const stopAt = Date.now() + maxWaitMs;
    const busyStates = new Set(['rendering', 'previewing', 'queued', 'analyzing', 'waiting']);
    while (Date.now() < stopAt && busyStates.has(current.status)) {
      const waited = await studio(endpoint, `${projectRoute}/wait`, {
        method: 'POST', body: { until: 'idle', timeoutSeconds: 30 }, timeout: 40000, fetchImpl,
      });
      current = waited.project;
      assert(current?.id === review.projectId && current.revision === expectedRevision,
        'Render wait observed an unexpected project revision');
    }
    assert(!busyStates.has(current.status), 'Render timed out; inspect isolated project manually');
    assert(!['failed', 'interrupted', 'cancelled', 'canceled'].includes(current.status),
      `Render failed: ${short(current.message)}`);
    const exports = current.exports?.filter(item => item.format === 'vertical' && item.revision === expectedRevision) ?? [];
    assert(exports.length === 1 && UUID.test(String(exports[0].id ?? '')),
      'Expected exactly one finished vertical export');
    const qc = await studio(endpoint, `${projectRoute}/qc`, {
      method: 'POST', body: { exportId: exports[0].id }, timeout: 120000, fetchImpl,
    });
    assert(qc.qc?.exportId === exports[0].id && qc.qc.passed === true,
      `Video QC failed or did not confirm pass: ${short(qc.qc?.issues?.[0]?.message)}`);
    const final = (await studio(endpoint, projectRoute, { fetchImpl })).project;
    assertSavedPlan(final, review.projectId, expectedRevision, proposed);
    assert(final.exports?.some(item => item.id === exports[0].id), 'Rendered export was not persisted');
    result.status = 'STUDIO_VERTICAL_QC_PASS';
    result.export = { id: exports[0].id, output: exports[0].output, format: 'vertical', revision: expectedRevision };
    result.qc = { passed: true, score: qc.qc.score, duration: qc.qc.duration };
    result.stages.push('vertical_export', 'studio_qc_pass');
    result.retirement = 'NOT_APPROVED: Windows same-footage A/B, face crop, subtitles, B-roll, GUI save/redo still required';
    return result;
  } catch (error) {
    error.message += `; isolated Studio project: ${review.projectId}`;
    throw error;
  }
}

export async function main(argv) {
  const values = new Map(), flags = new Set();
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    assert(key.startsWith('--') && !values.has(key) && !flags.has(key), 'Unknown or duplicate argument');
    if (['--create-preview-project', '--apply-new-project', '--render-vertical'].includes(key)) {
      flags.add(key); continue;
    }
    assert(['--manifest', '--source', '--port'].includes(key) && argv[i + 1] && !argv[i + 1].startsWith('--'), `Invalid option ${key}`);
    values.set(key, argv[++i]);
  }
  assert(flags.has('--create-preview-project'), 'Explicit --create-preview-project authorization required');
  assert(typeof values.get('--manifest') === 'string' && fs.statSync(values.get('--manifest')).isFile(), 'Manifest not found');
  assert(typeof values.get('--source') === 'string' && fs.statSync(values.get('--source')).isFile(), 'Original source video not found');
  const port = values.get('--port') ?? '32146';
  assert(/^\d{1,5}$/.test(port) && Number(port) >= 1 && Number(port) <= 65535, 'Invalid localhost port');
  const manifest = JSON.parse(fs.readFileSync(values.get('--manifest'), 'utf8'));
  const output = await runCutPilotUat({ manifest, sourcePath: values.get('--source'),
    origin: `http://127.0.0.1:${port}`, apply: flags.has('--apply-new-project'), render: flags.has('--render-vertical') });
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch(error => {
    console.error(`CUTPILOT_RETIREMENT_GATE_BLOCKED: ${error.message}`); process.exitCode = 1;
  });
}
