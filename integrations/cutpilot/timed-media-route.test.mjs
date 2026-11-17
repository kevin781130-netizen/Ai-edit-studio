import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimedAssetService } from './timed-media-route.mjs';

const ORIGINAL = '11111111-1111-4111-8111-111111111111';
const COPY = '22222222-2222-4222-8222-222222222222';
const PNG = '33333333-3333-4333-8333-333333333333';
const AUDIO = '44444444-4444-4444-8444-444444444444';
function setup(opts = {}) {
  const calls = [];
  const source = { id: ORIGINAL, name: 'Original', revision: 7, status: 'draft',
    options: opts.narration ? { narration: '/voice.wav' } : {},
    sources: [{ file: '/old.mp4' }],
    plan: { clips: [{ id: 'abc1', sourceIndex: 0, start: 0, end: 12 }], actualDuration: 12 } };
  const original = structuredClone(source);
  const studio = {
    getProject: async id => id === ORIGINAL ? structuredClone(original) :
      { ...structuredClone(source), id: COPY, revision: 2 },
    duplicateProject: async id => {
      calls.push(['duplicate', id]);
      return { ...structuredClone(source), id: COPY, revision: 1 };
    },
    appendCutPilotMediaSource: async (id, args) => {
      calls.push(['append', id, args]);
      return { sourceIndex: 1, project: { ...source, id: COPY, revision: 2,
        sources: [...source.sources, { file: args.file, duration: 5 }] } };
    },
    editProject: async (id, args) => {
      calls.push(['edit', id, args]);
      return { project: { id: COPY, revision: args.revision + 1 } };
    },
  };
  const assets = {
    resolveLocal: async id => ({ asset_id: id, provider: 'local', media_type: 'image',
      local_path: '/cache/sticker.png' }),
    resolveAudio: async id => ({ asset_id: id, provider: 'local', media_type: 'audio',
      local_path: '/cache/whoosh.wav' }),
  };
  return { svc: createTimedAssetService({ studio, assets }), calls };
}
test('PNG creates copy, attaches source and adds timed PIP to COPY only', async () => {
  const x = setup();
  const r = await x.svc.apply({ projectId: ORIGINAL, revision: 7, assetId: PNG,
    confirmRights: true, kind: 'sticker', at: 3, seconds: 6, size: .3, position: 'top-right' });
  assert.equal(r.status, 'APPLIED_TO_NEW_COPY');
  assert.equal(r.projectId, COPY);
  assert.deepEqual(x.calls.map(c => c[0]), ['duplicate', 'append', 'edit']);
  const op = x.calls[2][2].operations[0];
  assert.equal(op.op, 'add_overlay');
  assert.equal(op.at, 3);
  assert.equal(op.end, 5);
  assert.equal(op.sourceIndex, 1);
  assert.equal(x.calls[2][1], COPY);
});
test('audio sets start time and gain in copy, without replacing narration', async () => {
  const x = setup();
  const r = await x.svc.apply({ projectId: ORIGINAL, revision: 7, assetId: AUDIO,
    confirmRights: true, kind: 'sfx', at: 7, gain: .8 });
  assert.equal(r.kind, 'sfx');
  assert.deepEqual(x.calls.map(c => c[0]), ['duplicate', 'edit']);
  const opts = x.calls[1][2].operations[0].options;
  assert.equal(opts.narrationStart, 7);
  assert.equal(opts.narrationGain, .8);
});
test('existing narration blocks any edit or copy', async () => {
  const x = setup({ narration: true });
  await assert.rejects(x.svc.apply({ projectId: ORIGINAL, revision: 7, assetId: AUDIO,
    confirmRights: true, kind: 'sfx', at: 1, gain: .5 }), /existing voice-over/);
  assert.equal(x.calls.length, 0);
});
test('invalid revision and no rights fail before mutations', async () => {
  const x = setup();
  const args = { projectId: ORIGINAL, revision: 7, assetId: PNG, kind: 'sticker',
    at: 1, seconds: 3, size: .3, position: 'center' };
  await assert.rejects(x.svc.apply(args), /Confirm/);
  await assert.rejects(x.svc.apply({ ...args, confirmRights: true, revision: 5 }), /revision changed/i);
  await assert.rejects(x.svc.apply({ ...args, confirmRights: true, at: 12 }), /outside/);
  assert.equal(x.calls.length, 0);
});
