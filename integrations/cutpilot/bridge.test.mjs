import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCutPilotBridgePlan } from './bridge.mjs';

const source = '/media/source.mp4';
const sample = { version: '0.8', source: 'source.mp4', clips: [
  { id: 'clip-02', title: 'Low', score: 50, source_start: 12, source_end: 17 },
  { id: 'clip-01', title: 'High', score: 90, source_start: 3, source_end: 11 },
  { id: 'clip-03', title: 'Tie', score: 50, source_start: 20, source_end: 26 },
] };

test('ranked cut spans become a valid non-applying studio_edit replacement', () => {
  const p = buildCutPilotBridgePlan(sample, source);
  assert.equal(p.mode, 'READ_ONLY_PLAN');
  assert.deepEqual(p.create.arguments.inputs, [source]);
  assert.deepEqual(p.ranked.map(x => x.cutpilotId), ['clip-01', 'clip-02', 'clip-03']);
  assert.deepEqual(p.edit.arguments.operations[0].clips.map(x => [x.id, x.start, x.end]), [
    ['cp001', 3, 11], ['cp002', 12, 17], ['cp003', 20, 26],
  ]);
  assert.equal(p.edit.arguments.dryRun, true);
  assert.deepEqual(p.edit.requires, ['projectId', 'revision']);
});

test('revision-guarded preview is produced only with project id and revision together', () => {
  const p = buildCutPilotBridgePlan(sample, source, { projectId: '00000000-0000-0000-0000-000000000001', revision: 3 });
  assert.equal(p.edit.arguments.revision, 3);
  assert.equal(p.edit.arguments.projectId, '00000000-0000-0000-0000-000000000001');
  assert.equal(p.edit.arguments.dryRun, true);
  assert.throws(() => buildCutPilotBridgePlan(sample, source, { revision: 3 }), /together/);
});

test('rejects wrong source, incorrect version, malformed timing and scores', () => {
  assert.throws(() => buildCutPilotBridgePlan(sample, '/media/not-the-source.mp4'), /does not match/);
  assert.throws(() => buildCutPilotBridgePlan({ ...sample, version: '0.9' }, source), /Unsupported/);
  assert.throws(() => buildCutPilotBridgePlan({ ...sample, clips: [{ ...sample.clips[0], source_end: 12.2 }] }, source), /times/);
  assert.throws(() => buildCutPilotBridgePlan({ ...sample, clips: [{ ...sample.clips[0], score: NaN }] }, source), /rank score/);
  assert.throws(() => buildCutPilotBridgePlan({ ...sample, clips: [{ ...sample.clips[0], source_end: 7300 }] }, source), /times/);
  assert.throws(() => buildCutPilotBridgePlan({ ...sample, clips: [ { ...sample.clips[0], source_end: 1200 }, { ...sample.clips[1], source_end: 1210 } ] }, source), /1200-second/);
});

test('cli only prints JSON and does not create or edit projects', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cutpilot-bridge-'));
  try {
    const input = path.join(dir, 'source.mp4');
    const manifest = path.join(dir, 'frontend_manifest.json');
    fs.writeFileSync(input, 'fixture');
    fs.writeFileSync(manifest, JSON.stringify(sample));
    const script = fileURLToPath(new URL('./bridge.mjs', import.meta.url));
    const run = spawnSync(process.execPath, [script, '--manifest', manifest, '--source', input], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stdout).mode, 'READ_ONLY_PLAN');
    assert.deepEqual(fs.readdirSync(dir).sort(), ['frontend_manifest.json', 'source.mp4']);
    const failed = spawnSync(process.execPath, [script, '--manifest', manifest, '--source', path.join(dir, 'missing.mp4')], { encoding: 'utf8' });
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /CUTPILOT_BRIDGE_REJECTED/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
