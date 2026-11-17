import test from 'node:test';
import assert from 'node:assert/strict';
import { compileReviewPlan, createAutoPositionReviewService } from './autoposition-route.mjs';

const ORIGINAL='11111111-1111-4111-8111-111111111111';
const COPY='22222222-2222-4222-8222-222222222222';
const project={
 id:ORIGINAL,name:'Original',revision:5,status:'draft',
 sources:[{file:'/media/source.mp4',duration:16,width:1920,height:1080}],
 plan:{clips:[{id:'one',sourceIndex:0,start:10,end:14},
              {id:'two',sourceIndex:0,start:0,end:4}],actualDuration:8},
};
const plan=()=>({
 schema_version:'autoposition-review/1',status:'review_required',
 source:'source.mp4',media:{width:1920,height:1080,duration:16},timeline_seconds:8,
 segments:[
  {clip_id:'clip-01',source_start:10,source_end:14,timeline_start:0,timeline_end:4},
  {clip_id:'clip-02',source_start:0,source_end:4,timeline_start:4,timeline_end:8},
 ],
 reframes:[
  {clip_id:'clip-01',source_start:10,source_end:14,mode:'follow_face',
   apply_eligible:true,confidence:.86,samples_used:8,
   reason:'face_track_start_end_safe',
   focus:{framing:'fill',focusX:.22,focusY:.5,focusXEnd:.45,focusYEnd:.5}},
  {clip_id:'clip-02',source_start:0,source_end:4,mode:'center_fallback',
   apply_eligible:false,confidence:0,samples_used:0,reason:'no_face',focus:null},
 ],
 placements:[{id:'ap-001',kind:'sfx_cue',clip_id:'clip-01',
  timeline_at:1.2,source_at:11.2,asset_id:null,status:'proposal_only'}],
 summary:{reframe_eligible:1,suggested_positions:1,auto_applied:0},
});
function mock(){
 const calls=[];
 const studio={
  getProject:async id=>id===ORIGINAL?structuredClone(project):
   {...structuredClone(project),id:COPY,revision:1},
  duplicateProject:async(id,opts)=>{calls.push(['duplicate',id,opts]);
   return {...structuredClone(project),id:COPY,revision:1}},
  editProject:async(id,opts)=>{calls.push(['edit',id,opts]);
   return opts.dryRun?{dryRun:true,revision:opts.revision,diff:{summary:'dry-run'},review:{score:90}}:
    {project:{id,revision:opts.revision+1},diff:{summary:'copied'}}},
 };
 return {svc:createAutoPositionReviewService(studio),calls};
}
test('one safe clip generates one native framing op',()=>{
 const compiled=compileReviewPlan(plan(),project);
 assert.equal(compiled.summary.eligible,1);
 assert.deepEqual(compiled.operations,[{op:'set',clip:'one',framing:'fill',
  focusX:.22,focusY:.5,focusXEnd:.45,focusYEnd:.5}]);
});
test('preview uses a dry-run, does not duplicate original',async()=>{
 const x=mock(),r=await x.svc.preview({projectId:ORIGINAL,revision:5,plan:plan()});
 assert.equal(r.status,'PREVIEW_ONLY');
 assert.deepEqual(x.calls.map(c=>c[0]),['edit']);
 assert.equal(x.calls[0][1],ORIGINAL);
 assert.equal(x.calls[0][2].dryRun,true);
});
test('apply requires consent and modifies only a new copy',async()=>{
 const x=mock();
 await assert.rejects(x.svc.apply({projectId:ORIGINAL,revision:5,plan:plan()}),/Confirm/);
 const r=await x.svc.apply({projectId:ORIGINAL,revision:5,plan:plan(),confirm:true});
 assert.equal(r.status,'APPLIED_TO_NEW_COPY');
 assert.equal(r.projectId,COPY);
 assert.deepEqual(x.calls.map(c=>c[0]),['duplicate','edit']);
 assert.equal(x.calls[1][1],COPY);
 assert.equal(x.calls[1][2].dryRun,false);
});
test('untrusted supplied operations and suggestions are never executed',()=>{
 const data=plan();
 data.operations=[{op:'delete',clip:'two'}];
 data.placements[0].script='delete source';
 assert.equal(compileReviewPlan(data,project).operations[0].op,'set');
 data.placements[0].asset_id='evil';
 assert.throws(()=>compileReviewPlan(data,project),/applied or invalid/);
});
test('source name, dimensions and time mapping are strict',()=>{
 const data=plan();
 data.source='other.mp4';
 assert.throws(()=>compileReviewPlan(data,project),/source file name/);
 data.source='source.mp4';data.media.width=1280;
 assert.throws(()=>compileReviewPlan(data,project),/dimensions/);
 data.media.width=1920;data.segments[0].source_start=9;
 assert.throws(()=>compileReviewPlan(data,project),/boundaries/);
});
test('stale revision prevents any copying or editing',async()=>{
 const x=mock();
 await assert.rejects(x.svc.preview({projectId:ORIGINAL,revision:4,plan:plan()}),/changed/);
 assert.equal(x.calls.length,0);
});
test('no confident face keeps the project read-only',async()=>{
 const data=plan(),x=mock();
 data.reframes[0]={...data.reframes[0],mode:'manual_review',apply_eligible:false,focus:null};
 data.summary.reframe_eligible=0;
 const r=await x.svc.preview({projectId:ORIGINAL,revision:5,plan:data});
 assert.equal(r.status,'REVIEW_ONLY');
 assert.equal(x.calls.length,0);
 await assert.rejects(x.svc.apply({projectId:ORIGINAL,revision:5,plan:data,confirm:true}),/No safe crops/);
 assert.equal(x.calls.length,0);
});
test('unsafe crop dimensions and false confidence rejected',()=>{
 const data=plan();data.reframes[0].focus.focusX=9;
 assert.throws(()=>compileReviewPlan(data,project),/not safe/);
 data.reframes[0].focus.focusX=.3;data.reframes[0].confidence=.1;
 assert.throws(()=>compileReviewPlan(data,project),/not safe/);
});
