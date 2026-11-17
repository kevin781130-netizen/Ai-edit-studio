import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativePackService } from './native-packs-route.mjs';

const ID = '11111111-1111-4111-8111-111111111111';
const COPY = '22222222-2222-4222-8222-222222222222';
const project = {
  id: ID, name: 'Original', revision: 3,
  plan: { clips: [
    { id: 'clip1', sourceIndex: 0, start: 0, end: 5 },
    { id: 'clip2', sourceIndex: 1, start: 0, end: 5 },
  ], actualDuration: 10 },
  options: { captions: [] },
};
function fixture({ conflict = false } = {}) {
  const logs = [];
  const api = {
    getProject: async id => {
      logs.push(['get', id]);
      if (conflict && logs.filter(x => x[0] === 'get').length > 1) return { ...project, revision: 4 };
      return structuredClone(project);
    },
    duplicateProject: async (id, options) => {
      logs.push(['duplicate', id, options]);
      return { ...structuredClone(project), id: COPY, name: 'Original · Pack', revision: 1 };
    },
    editProject: async (id, input) => {
      logs.push(['edit', id, input]);
      if (input.dryRun) return { dryRun: true, revision: input.revision, diff: { summary: 'preview' }, timeline: [] };
      return { project: { id, revision: 2 }, diff: { summary: 'applied' } };
    },
  };
  return { service: createNativePackService(api), logs };
}

test('list exposes MIT native preset catalog without external assets', () => {
  const x = fixture(), r = x.service.list({ kind: 'caption' });
  assert.equal(r.packs.length, 4);
  assert.equal(r.noExternalAssets, true);
});
test('preview dry-runs original without mutation or duplicate', async () => {
  const x = fixture(), r = await x.service.preview({ projectId: ID, revision: 3, packId: 'cap-pop' });
  assert.equal(r.status, 'PREVIEW_ONLY');
  assert.equal(x.logs.filter(x => x[0] === 'duplicate').length, 0);
  assert.equal(x.logs.at(-1)[2].dryRun, true);
});
test('apply duplicates first and edits only the copy', async () => {
  const x = fixture(), r = await x.service.apply({ projectId: ID, revision: 3, packId: 'tr-fade' });
  assert.equal(r.status, 'APPLIED_TO_NEW_COPY');
  assert.equal(r.projectId, COPY);
  const edits = x.logs.filter(x => x[0] === 'edit');
  assert.equal(edits.length, 1);
  assert.equal(edits[0][1], COPY);
  assert.equal(edits[0][2].operations[0].clip, 'clip2');
});
test('stale revision prevents any duplicate or edit', async () => {
  const x = fixture();
  await assert.rejects(x.service.apply({ projectId: ID, revision: 1, packId: 'tr-fade' }), /revision changed/i);
  assert.equal(x.logs.filter(x => x[0] !== 'get').length, 0);
});
test('invalid preset prevents creating an orphan copy', async () => {
  const x = fixture();
  await assert.rejects(x.service.apply({ projectId: ID, revision: 3, packId: 'unknown' }), /Unknown/);
  assert.equal(x.logs.filter(x => x[0] === 'duplicate').length, 0);
});
test('source edited during copy blocks mutating the copy', async () => {
  const x = fixture({ conflict: true });
  await assert.rejects(x.service.apply({ projectId: ID, revision: 3, packId: 'cap-pop' }), /changed during/);
  assert.equal(x.logs.filter(x => x[0] === 'edit').length, 0);
});
