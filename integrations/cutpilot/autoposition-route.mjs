// CutPilot P3 -> Studio review-and-copy adapter.
// Plan JSON is data, NOT a trusted instruction list. Reconstruct only Studio
// 'set' focus operations after matching the saved single-source timeline.
import path from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRACK_MODES = new Set(['follow_face','manual_review','center_fallback','no_crop_needed']);
const finite = (n, min, max) => typeof n === 'number' &&
  Number.isFinite(n) && n >= min && n <= max;
const within = (a, b, tolerance = 0.004) => Math.abs(a - b) <= tolerance;
export class AutoPositionError extends Error {
  constructor(code, message, status = 400) {
    super(message); this.code = code; this.status = status;
  }
}
function check(cond, code, message, status = 400) {
  if (!cond) throw new AutoPositionError(code, message, status);
}
export function compileReviewPlan(review, project) {
  check(review && typeof review === 'object' && !Array.isArray(review) &&
    review.schema_version === 'autoposition-review/1' && review.status === 'review_required',
    'INVALID_PLAN', 'Use a CutPilot P3 review JSON.');
  const segments = review.segments, crops = review.reframes, placements = review.placements;
  check(Array.isArray(segments) && segments.length >= 1 && segments.length <= 200 &&
    Array.isArray(crops) && crops.length === segments.length &&
    Array.isArray(placements) && placements.length <= 200,
    'INVALID_PLAN', 'Invalid P3 segment/crop/placement counts.');
  check(project?.sources?.length === 1 && Array.isArray(project?.plan?.clips) &&
    project.plan.clips.length === segments.length,
    'TIMELINE_MISMATCH', 'P3 requires an unchanged single-source CutPilot timeline.', 409);
  const source = project.sources[0];
  check(typeof review.source === 'string' && path.basename(source.file || '') === review.source,
    'SOURCE_MISMATCH', 'P3 source file name is different from this Studio project.', 409);
  check(review.media && Number.isInteger(review.media.width) &&
    Number.isInteger(review.media.height) &&
    review.media.width === source.width && review.media.height === source.height,
    'MEDIA_MISMATCH', 'P3 source video dimensions do not match Studio.', 409);
  check(finite(review.media.duration, .5, 7200) &&
    finite(source.duration, .5, 7200) &&
    within(review.media.duration, source.duration, .25),
    'MEDIA_DURATION', 'P3 source media duration differs from Studio.', 409);
  check(finite(review.timeline_seconds, .5, 1200) &&
    within(review.timeline_seconds, Number(project.plan.actualDuration), .01),
    'TIMELINE_MISMATCH', 'Saved Studio timeline duration differs from P3.', 409);
  const operations = [], notes = [], seen = new Set();
  let timelineCursor = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i], crop = crops[i], clip = project.plan.clips[i];
    check(seg && crop && typeof seg.clip_id === 'string' && seg.clip_id &&
      !seen.has(seg.clip_id) && crop.clip_id === seg.clip_id,
      'CLIP_ID', 'Duplicate or mismatched P3 clip IDs.');
    seen.add(seg.clip_id);
    check(clip.sourceIndex === 0 && finite(seg.source_start, 0, source.duration) &&
      finite(seg.source_end, 0, source.duration) &&
      seg.source_end - seg.source_start >= .5 &&
      finite(seg.timeline_start, 0, 1200) && finite(seg.timeline_end, 0, 1200) &&
      within(seg.timeline_start, timelineCursor) &&
      within(seg.timeline_end, timelineCursor + seg.source_end - seg.source_start, .008) &&
      within(clip.start, seg.source_start) && within(clip.end, seg.source_end),
      'CLIP_MISMATCH', 'P3 clip order or source-time boundaries differ from this edit.', 409);
    timelineCursor = seg.timeline_end;
    check(TRACK_MODES.has(crop.mode) && typeof crop.apply_eligible === 'boolean' &&
      within(crop.source_start, seg.source_start) &&
      within(crop.source_end, seg.source_end),
      'CROP_MISMATCH', 'P3 face crop evidence is not aligned to the clip.');
    if (crop.apply_eligible) {
      check(crop.mode === 'follow_face' && crop.focus &&
        crop.focus.framing === 'fill' &&
        finite(crop.focus.focusX, 0, 1) && finite(crop.focus.focusY, 0, 1) &&
        finite(crop.focus.focusXEnd, 0, 1) && finite(crop.focus.focusYEnd, 0, 1) &&
        finite(crop.confidence, .72, 1) &&
        Number.isInteger(crop.samples_used) && crop.samples_used >= 3 &&
        typeof clip.id === 'string',
        'UNSAFE_CROP', 'P3 crop is not safe to apply.');
      operations.push({
        op: 'set', clip: clip.id, framing: 'fill',
        focusX: crop.focus.focusX, focusY: crop.focus.focusY,
        focusXEnd: crop.focus.focusXEnd, focusYEnd: crop.focus.focusYEnd,
      });
    } else {
      check(crop.mode !== 'follow_face', 'UNSAFE_CROP', 'Face crop status is inconsistent.');
    }
    notes.push({ clipId: seg.clip_id, status: crop.mode, reason: String(crop.reason || '').slice(0, 90),
      confidence: finite(crop.confidence, 0, 1) ? crop.confidence : 0 });
  }
  check(within(timelineCursor, review.timeline_seconds, .01),
    'TIMELINE_MISMATCH', 'P3 segment durations disagree with its total.', 409);
  // Placement suggestions remain purely informational. Do not execute stock
  // asset IDs, language-model strings, or arbitrary provided operations.
  for (const placement of placements) {
    check(placement && placement.status === 'proposal_only' &&
      placement.asset_id === null && typeof placement.clip_id === 'string' &&
      seen.has(placement.clip_id) && finite(placement.timeline_at, 0, review.timeline_seconds) &&
      ['cut','caption_hint','sfx_cue','sticker_hint'].includes(placement.kind),
      'UNSAFE_PLACEMENT', 'P3 contains an applied or invalid placement suggestion.');
  }
  check(review.summary?.reframe_eligible === operations.length &&
    review.summary?.suggested_positions === placements.length &&
    review.summary?.auto_applied === 0,
    'SUMMARY_MISMATCH', 'P3 counts do not match reviewed operations.');
  return { operations, notes, summary: {
    clips: segments.length, eligible: operations.length,
    manualReview: notes.filter(x => x.status === 'manual_review').length,
    suggestedPositions: placements.length, autoApplied: 0,
  }};
}
export function createAutoPositionReviewService(studio) {
  check(studio && ['getProject','editProject','duplicateProject'].every(
    name => typeof studio[name] === 'function'), 'NO_STUDIO', 'Studio adapter unavailable.', 500);

  async function inspect(body = {}) {
    check(typeof body.projectId === 'string' && UUID.test(body.projectId),
      'INVALID_PROJECT', 'Open a saved Studio project.');
    check(Number.isInteger(body.revision) && body.revision > 0,
      'INVALID_REVISION', 'Refresh the saved project revision.');
    const original = await studio.getProject(body.projectId);
    check(original?.revision === body.revision, 'REVISION_CONFLICT',
      'Studio project changed; refresh before continuing.', 409);
    check(!['rendering','analyzing','previewing'].includes(original?.status),
      'PROJECT_BUSY', 'This project is busy.', 409);
    const compiled = compileReviewPlan(body.plan, original);
    return { original, compiled };
  }
  async function preview(body = {}) {
    const { original, compiled } = await inspect(body);
    if (!compiled.operations.length)
      return { status: 'REVIEW_ONLY', ...compiled.summary, notes: compiled.notes,
        message: 'No high-confidence face framing was available; source unchanged.' };
    const result = await studio.editProject(original.id, {
      revision: original.revision, operations: compiled.operations, dryRun: true,
      author: 'cutpilot-autoposition-p3',
    });
    check(result?.dryRun === true && result.revision === original.revision,
      'PREVIEW_FAILED', 'Studio did not return a read-only review.', 502);
    return { status: 'PREVIEW_ONLY', ...compiled.summary, notes: compiled.notes,
      diff: result.diff, review: result.review };
  }
  async function apply(body = {}) {
    check(body.confirm === true, 'CONFIRM_REQUIRED', 'Confirm apply to a NEW COPY only.', 403);
    const { original, compiled } = await inspect(body);
    check(compiled.operations.length > 0, 'NOTHING_TO_APPLY',
      'No safe crops to apply; leave recommendations in review mode.', 409);
    const copy = await studio.duplicateProject(original.id, {
      name: (String(original.name || 'CutPilot edit') + ' · P3 Reframe').slice(0, 100),
      author: 'cutpilot-autoposition-p3',
    });
    check(copy?.id && UUID.test(copy.id) && copy.id !== original.id && copy.revision === 1,
      'COPY_FAILED', 'Could not create an isolated project duplicate.', 502);
    check((await studio.getProject(original.id)).revision === original.revision,
      'REVISION_CONFLICT', 'Original project changed during duplication.', 409);
    // Revalidate the COPY to ensure the duplicate did not change source order
    // or edit boundaries, then build ops against its actual clip IDs.
    const copied = compileReviewPlan(body.plan, copy);
    check(copied.operations.length === compiled.operations.length,
      'COPY_MISMATCH', 'Duplicated timeline changed unexpectedly.', 502);
    const saved = await studio.editProject(copy.id, {
      revision: copy.revision, operations: copied.operations, dryRun: false,
      summary: 'Applied reviewed P3 safe reframes on isolated duplicate',
      author: 'cutpilot-autoposition-p3',
    });
    check(saved?.project?.id === copy.id && saved.project.revision > copy.revision,
      'APPLY_FAILED', 'Studio did not confirm the copy-only edit.', 502);
    return { status: 'APPLIED_TO_NEW_COPY', projectId: copy.id,
      sourceProjectId: original.id, revision: saved.project.revision,
      ...copied.summary, notes: copied.notes, diff: saved.diff };
  }
  return { preview, apply };
}
let singleton;
async function service() {
  if (!singleton) singleton = createAutoPositionReviewService(await import('../../src/studio.mjs'));
  return singleton;
}
export async function handleAutoPositionReviewApi({ method, pathname, request, response, json, readJsonBody, svc }) {
  try {
    const body = method === 'POST' ? await readJsonBody(request) : {};
    const backend = svc || await service();
    let result;
    if (method === 'POST' && pathname === '/api/cutpilot/autoposition/preview')
      result = await backend.preview(body);
    else if (method === 'POST' && pathname === '/api/cutpilot/autoposition/apply')
      result = await backend.apply(body);
    else throw new AutoPositionError('ROUTE_NOT_FOUND', 'Unknown AutoPosition endpoint.', 404);
    return json(response, pathname.endsWith('/apply') ? 201 : 200, { ok: true, ...result });
  } catch (err) {
    const known = err instanceof AutoPositionError || err?.name === 'StudioError';
    return json(response, err instanceof AutoPositionError ? err.status :
      err?.name === 'StudioError' ? 400 : 500, {
      ok: false, error: { code: err?.code || 'AUTOPOSITION_ERROR',
        message: known ? err.message : 'AutoPosition review failed.' },
    });
  }
}
