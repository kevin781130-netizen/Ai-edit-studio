import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssetPanelService } from './assets-route.mjs';

const id = '4de4ec0b-54ba-41e4-8cac-d3460b98a1c5';
const pid = 'a5a5fa20-78ab-4a55-b7e8-5e722dfc8a80';
const online = { origin: 'online', provider: 'openverse', media_type: 'image',
  provider_asset_id: 'x1', title: 'Nature' };
const local = { origin: 'local', provider: 'local', asset_id: id, title: 'Owned asset',
  media_type: 'image', local_path: '/tmp/owned.png' };
function setup() {
  const calls = [], projects = [], edits = [];
  const svc = createAssetPanelService({
    invoke: async (args, payload) => {
      calls.push({ args, payload });
      if (args[0] === 'search') return { results: [online], count: 1 };
      if (args[0] === 'pin') return { pinned: { ...online, origin: 'local', asset_id: id } };
      if (args[0] === 'resolve') return { asset: local };
      if (args[0] === 'import') return { imported: local };
      throw Error('Unexpected Python command');
    },
    studio: {
      createProject: async args => { projects.push(args); return { id: pid, revision: 1, sources: [{ duration: 20 }] }; },
      editProject: async (id, args) => { edits.push({ id, args }); return { revision: 2 }; },
    },
  });
  return { svc, calls, projects, edits };
}
test('search retains server selection and does not make edits', async () => {
  const x = setup(), r = await x.svc.search({ query: 'snow', mediaType: 'image' });
  assert.equal(r.count, 1);
  assert.equal(x.projects.length, 0);
  await x.svc.pin({ searchId: r.searchId, index: 0, provider: 'evil' });
  assert.deepEqual(x.calls[1].payload, online);
  await assert.rejects(x.svc.pin({ searchId: r.searchId, index: 0 }), /Only remote/);
});
test('invalid search, pin and import fail closed', async () => {
  const x = setup();
  await assert.rejects(x.svc.search({ query: '' }), /Query/);
  await assert.rejects(x.svc.pin({ searchId: 'none', index: 0 }), /expired/);
  await assert.rejects(x.svc.importLocal({ path: 'movie.mp4', confirm: true }), /absolute/);
  await assert.rejects(x.svc.importLocal({ path: '/tmp/test.mp4' }), /Confirm/);
});
test('local import is explicit', async () => {
  const x = setup();
  const r = await x.svc.importLocal({ path: '/tmp/test.mp4', confirm: true });
  assert.equal(r.imported.asset_id, id);
  assert.deepEqual(x.calls[0].args, ['import', '/tmp/test.mp4']);
});
test('use only locally imported media in a NEW Studio draft', async () => {
  const x = setup();
  await assert.rejects(x.svc.useLocal({ assetId: id }), /rights/);
  const r = await x.svc.useLocal({ assetId: id, confirmRights: true });
  assert.equal(r.status, 'NEW_PROJECT_ONLY');
  assert.equal(x.projects.length, 1);
  assert.deepEqual(x.projects[0].inputs, ['/tmp/owned.png']);
  assert.equal(x.edits[0].id, pid);
  assert.equal(x.edits[0].args.operations[0].clips[0].end, 10);
});
test('untrusted or online IDs cannot resolve as local', async () => {
  const x = setup();
  await assert.rejects(x.svc.resolveLocal('bad'), /Invalid/);
  const bad = createAssetPanelService({
    invoke: async () => ({ asset: { ...local, provider: 'openverse' } }),
    studio: { createProject: () => { throw Error('must not create'); } },
  });
  await assert.rejects(bad.useLocal({ assetId: id, confirmRights: true }), /Only imported/);
});
