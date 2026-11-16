import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runCutPilotUat } from './retirement-uat.mjs';

const ID = 'b1d8b4fe-e18b-4f72-9d01-595ff11c9064';
const EXPORT = 'c789807c-2972-4e61-94a5-d8cc11bb72a8';
const manifest = { version: '0.8', source: 'original.mp4', clips: [
  { id: 'c01', title: 'A', source_start: 10, source_end: 16, score: 80 },
  { id: 'c02', title: 'B', source_start: 20, source_end: 28, score: 70 },
] };
const src = '/virtual/original.mp4';
const create = { ok: true, project: { id: ID, revision: 1, plan: null } };
const clips = [
  { sourceIndex: 0, start: 10, end: 16, id: 'cp001' },
  { sourceIndex: 0, start: 20, end: 28, id: 'cp002' },
];
const saved = { id: ID, revision: 2, status: 'ready', plan: { clips }, exports: [] };
const exportItem = { id: EXPORT, output: '/tmp/video.mp4', revision: 2, format: 'vertical' };
function mock(overrides = {}) {
  const calls = [], requests = {
    'GET /api/health': { ok: true, service: 'AI Edit Studio', schemaVersion: 2, version: '0.12.0' },
    'GET /api/agent/tools': { ok: true, tools: ['studio_create','studio_edit','studio_get'].map(name=>({ name })) },
    'POST /api/studio/projects': create,
    [`POST /api/studio/projects/${ID}/edit`]: null,
    [`GET /api/studio/projects/${ID}`]: null,
    [`POST /api/studio/projects/${ID}/export`]: { ok: true, project: { id: ID, revision: 2, status: 'rendering' } },
    [`POST /api/studio/projects/${ID}/wait`]: { ok: true, timedOut: false, project: { ...saved, exports: [exportItem] } },
    [`POST /api/studio/projects/${ID}/qc`]: { ok: true, qc: { exportId: EXPORT, passed: true, score: 95 } },
    ...overrides,
  };
  let editCalls = 0, gets = 0;
  const fetchImpl = async (url, opts) => {
    assert.equal(new URL(url).hostname, '127.0.0.1');
    assert.equal(opts.redirect, 'error');
    const key = `${opts.method} ${new URL(url).pathname}`;
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ key, body });
    let result = requests[key];
    if (result === null && key.endsWith('/edit')) {
      editCalls++;
      result = editCalls === 1 ? { ok: true, dryRun: true, revision: 1, timeline: { clips: [1,2] }, review: {score:88} } : { ok: true, project: saved };
    } else if (result === null && key.endsWith(ID)) {
      gets++;
      result = gets <= 2 ? { ok: true, project: { id: ID, revision: 1, plan: null } } : { ok: true, project: { ...saved, exports: [exportItem] } };
    }
    assert.ok(result, `Unexpected request ${key}`);
    return { ok: true, status: 200, json: async () => result };
  };
  return { calls, fetchImpl };
}

test('dry-run only creates fresh isolated draft without applying', async () => {
  const { calls, fetchImpl } = mock();
  const x = await runCutPilotUat({ manifest, sourcePath: src, fetchImpl });
  assert.equal(x.status, 'PREVIEW_ONLY');
  assert.equal(calls.filter(x=>x.key.endsWith('/edit')).length,1);
  assert.equal(calls.find(x=>x.key.endsWith('/edit')).body.dryRun,true);
});

test('explicit apply updates only new project, source spans verified', async () => {
  const { calls, fetchImpl } = mock();
  const x = await runCutPilotUat({ manifest, sourcePath: src, apply: true, fetchImpl });
  assert.equal(x.status, 'EDIT_APPLIED_TO_NEW_PROJECT');
  assert.equal(x.appliedRevision, 2);
  assert.equal(calls.filter(x=>x.key.endsWith('/edit')).length,2);
  assert.equal(calls.filter(x=>x.key.endsWith('/edit'))[1].body.dryRun,false);
  assert.equal(calls.some(x=>x.key.endsWith('/export')),false);
});

test('explicit export then QC checks vertical output revision', async () => {
  const { calls, fetchImpl } = mock();
  const x = await runCutPilotUat({ manifest, sourcePath: src, apply: true, render: true, fetchImpl });
  assert.equal(x.status, 'STUDIO_VERTICAL_QC_PASS');
  assert.equal(x.qc.passed,true);
  assert.equal(x.export.id,EXPORT);
  assert.ok(x.retirement.includes('NOT_APPROVED'));
  assert.deepEqual(calls.find(x=>x.key.endsWith('/export')).body.formats,['vertical']);
  assert.equal(calls.find(x=>x.key.endsWith('/qc')).body.exportId,EXPORT);
});

test('render without apply authorization is rejected without API calls', async () => {
  const { calls, fetchImpl } = mock();
  await assert.rejects(runCutPilotUat({manifest,sourcePath:src,render:true,fetchImpl}),/explicit apply/);
  assert.equal(calls.length,0);
});

test('stale draft refuses apply even after a successful preview', async () => {
  const { calls, fetchImpl } = mock();
  const custom = async (url, opts) => {
    const res = await fetchImpl(url,opts);
    if(url.endsWith(`/${ID}`) && calls.filter(x=>x.key.endsWith(ID)).length===2){
      return {ok:true,status:200,json:async()=>({ok:true,project:{id:ID,revision:3,plan:null}})};
    }
    return res;
  };
  await assert.rejects(runCutPilotUat({manifest,sourcePath:src,apply:true,fetchImpl:custom}),/changed since preview/);
  assert.equal(calls.filter(x=>x.key.endsWith('/edit')).length,1);
});

test('tampered applied result does not start export', async () => {
  const { calls, fetchImpl } = mock();
  const custom = async (url, opts) => {
    const res = await fetchImpl(url,opts);
    if(url.endsWith('/edit') && calls.filter(x=>x.key.endsWith('/edit')).length===2){
      return {ok:true,status:200,json:async()=>({ok:true,project:{...saved,plan:{clips:[{sourceIndex:0,start:1,end:2}]}}})};
    }
    return res;
  };
  await assert.rejects(runCutPilotUat({manifest,sourcePath:src,apply:true,render:true,fetchImpl:custom}),/Saved timeline/);
  assert.equal(calls.filter(x=>x.key.endsWith('/export')).length,0);
});

test('fail-closed on QC failure, never claims retirement', async () => {
  const { fetchImpl } = mock({[`POST /api/studio/projects/${ID}/qc`]: {ok:true,qc:{exportId:EXPORT,passed:false,issues:[{message:'black frames'}]}}});
  await assert.rejects(runCutPilotUat({manifest,sourcePath:src,apply:true,render:true,fetchImpl}),/Video QC failed/);
});

test('CLI refuses implicit preview project creation', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cp-uat-'));
  try{
    const srcFile=path.join(dir,'original.mp4'),mf=path.join(dir,'manifest.json');
    fs.writeFileSync(srcFile,'not-video');fs.writeFileSync(mf,JSON.stringify(manifest));
    const script=fileURLToPath(new URL('./retirement-uat.mjs',import.meta.url));
    const r=spawnSync(process.execPath,[script,'--manifest',mf,'--source',srcFile],{encoding:'utf8'});
    assert.equal(r.status,1);assert.match(r.stderr,/Explicit --create-preview-project/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
