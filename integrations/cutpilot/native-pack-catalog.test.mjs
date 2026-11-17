import test from 'node:test';
import assert from 'node:assert/strict';
import { NATIVE_PACKS, listNativePacks, buildNativePackOperations } from './native-pack-catalog.mjs';
import { applyOperations, coreClips } from '../../public/edit-ops.js';
import { normalizeOptions, validateClips } from '../../src/editing.mjs';

const clips = [{ id: 'abc1', sourceIndex: 0, start: 0, end: 4, speed: 1, gain: 1 },
  { id: 'abc2', sourceIndex: 1, start: 0, end: 4, speed: 1, gain: 1 }];
const project = { plan: { clips, actualDuration: 8 }, revision: 3,
  options: normalizeOptions({ duration: 8 }) };
const sources = [{ duration: 4 }, { duration: 4 }];

test('18 original metadata packs, no third-party media assets', () => {
  assert.equal(NATIVE_PACKS.length, 19);
  assert.equal(new Set(NATIVE_PACKS.map(x => x.id)).size, NATIVE_PACKS.length);
  assert.equal(listNativePacks({ kind: 'caption' }).length, 4);
  assert.equal(listNativePacks({ kind: 'transition', query: '像素' }).length, 1);
  assert.ok(NATIVE_PACKS.every(x => !('download_url' in x) && !('file' in x)));
});
test('each native preset compiles into supported Studio operations', () => {
  for (const pack of NATIVE_PACKS) {
    const ops = buildNativePackOperations(pack.id, project);
    const result = applyOperations({ clips: coreClips(project.plan.clips), options: project.options }, ops, { sources });
    const options = normalizeOptions(result.options);
    const plan = validateClips(result.clips, sources);
    assert.ok(options && plan.clipCount === 2, pack.id);
  }
  assert.equal(project.revision, 3);
});
test('no clip, unknown pack and one-clip transition reject safely', () => {
  assert.throws(() => buildNativePackOperations('missing', project), /Unknown/);
  assert.throws(() => buildNativePackOperations('cap-pop', { plan: null }), /at least one/);
  assert.throws(() => buildNativePackOperations('tr-fade', { plan: { clips: [clips[0]] } }), /two clips/);
});
test('text sticker is a native text overlay, not a downloaded image', () => {
  const ops = buildNativePackOperations('text-star', project);
  assert.equal(ops[0].op, 'add_text');
  assert.equal(ops[0].end, 3);
});
