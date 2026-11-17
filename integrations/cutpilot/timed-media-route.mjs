// Timed CutPilot PNG PIP and single local audio cue, applied to a NEW copy only.
// Reuses Studio's native overlay and narrationStart render paths.
import path from 'node:path';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POS = new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center']);
export class TimedAssetError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
function guard(ok, code, message, status = 400) {
  if (!ok) throw new TimedAssetError(code, message, status);
}
const bounded = (value, min, max) => typeof value === 'number' &&
  Number.isFinite(value) && value >= min && value <= max;
export function createTimedAssetService({ studio, assets }) {
  guard(studio && ['getProject', 'duplicateProject', 'editProject', 'appendCutPilotMediaSource']
    .every(k => typeof studio[k] === 'function'), 'STUDIO_UNAVAILABLE', 'Studio adapter unavailable.', 500);
  guard(assets && typeof assets.resolveLocal === 'function' &&
    typeof assets.resolveAudio === 'function', 'ASSETS_UNAVAILABLE', 'Local cache is unavailable.', 500);
  async function apply(body = {}) {
    guard(body.confirmRights === true, 'RIGHTS_REQUIRED', 'Confirm usage rights first.', 403);
    guard(UUID.test(String(body.projectId || '')) && Number.isInteger(body.revision) &&
      body.revision > 0, 'INVALID_PROJECT', 'Select a saved Studio project.');
    guard(UUID.test(String(body.assetId || '')), 'INVALID_ASSET', 'Select an imported asset.');
    guard(['sticker', 'sfx'].includes(body.kind), 'INVALID_KIND', 'Choose PNG sticker or sound effect.');
    const source = await studio.getProject(body.projectId);
    guard(source.revision === body.revision, 'REVISION_CONFLICT', 'Source revision changed.', 409);
    guard(!['rendering', 'analyzing', 'previewing'].includes(source.status),
      'PROJECT_BUSY', 'Project is busy.', 409);
    const length = Number(source.plan?.actualDuration);
    guard(Array.isArray(source.plan?.clips) && source.plan.clips.length > 0 &&
      bounded(length, .5, 1200), 'NO_TIMELINE', 'Save at least one clip before placing assets.');
    guard(bounded(body.at, 0, length - .5), 'INVALID_TIME', 'Time is outside the edit.');
    let asset;
    if (body.kind === 'sticker') {
      guard(bounded(body.seconds, .5, 10), 'INVALID_DURATION', 'Sticker lasts 0.5–10 seconds.');
      guard(bounded(body.size, .15, .7), 'INVALID_SIZE', 'Sticker size must be 0.15–0.70.');
      guard(POS.has(body.position), 'INVALID_POSITION', 'Select a supported position.');
      guard(source.sources.length < 24, 'SOURCE_LIMIT', 'Studio has a 24-source limit.');
      asset = await assets.resolveLocal(body.assetId);
      guard(asset.provider === 'local' && asset.media_type === 'image' &&
        path.extname(asset.local_path || '').toLowerCase() === '.png',
        'NOT_PNG', 'Only verified local PNG stickers are supported.', 403);
      guard(!source.sources.some(s => path.resolve(s.file) === path.resolve(asset.local_path)),
        'ALREADY_SOURCE', 'Sticker file is already a project source.');
    } else {
      guard(!source.options?.narration, 'VOICEOVER_OCCUPIED',
        'An existing voice-over is present. This minimal audio slot cannot replace it.', 409);
      guard(bounded(body.gain, 0, 1.5), 'INVALID_GAIN', 'Audio gain must be 0–1.5.');
      asset = await assets.resolveAudio(body.assetId);
      guard(asset.provider === 'local' && asset.media_type === 'audio' &&
        ['.wav', '.mp3', '.ogg', '.flac', '.m4a'].includes(path.extname(asset.local_path || '').toLowerCase()),
        'NOT_AUDIO', 'Only verified local audio can be placed.', 403);
    }
    const copy = await studio.duplicateProject(source.id, {
      name: (String(source.name || 'Studio edit') + ' · CutPilot asset').slice(0, 100),
      author: 'cutpilot-timed-asset',
    });
    guard(copy && UUID.test(String(copy.id)) && copy.id !== source.id && copy.revision === 1,
      'COPY_FAILED', 'Could not create a new project copy.', 502);
    guard((await studio.getProject(source.id)).revision === source.revision, 'REVISION_CONFLICT',
      'Source changed during duplication; no changes were applied to it.', 409);
    let revision = copy.revision, operations;
    if (body.kind === 'sticker') {
      const attached = await studio.appendCutPilotMediaSource(copy.id, {
        revision, file: asset.local_path,
      });
      guard(attached?.project?.id === copy.id &&
        attached.sourceIndex === copy.sources.length &&
        Number.isInteger(attached.project.revision), 'ATTACH_FAILED',
        'Could not append the sticker to the project copy.', 502);
      revision = attached.project.revision;
      const still = Number(attached.project.sources[attached.sourceIndex]?.duration);
      const duration = Math.min(body.seconds, length - body.at, still);
      guard(bounded(duration, .5, 10), 'INVALID_DURATION', 'Sticker duration is too short.');
      operations = [{ op: 'add_overlay', sourceIndex: attached.sourceIndex, start: 0,
        end: duration, at: body.at, mode: 'pip', position: body.position,
        size: body.size, gain: 0, fade: .15 }];
    } else {
      // Existing narrationStart applies FFmpeg adelay; one cue only.
      operations = [{ op: 'set_options', options: {
        narration: asset.local_path, narrationStart: body.at,
        narrationTrimStart: 0, narrationGain: body.gain,
      } }];
    }
    const saved = await studio.editProject(copy.id, {
      revision, operations, dryRun: false, author: 'cutpilot-timed-asset',
      summary: body.kind === 'sticker' ? 'Placed timed PNG in new draft copy' :
        'Placed one timed local sound via narration track in new draft copy',
    });
    guard(saved?.project?.id === copy.id && saved.project.revision > revision,
      'EDIT_FAILED', 'Could not verify the updated project copy.', 502);
    return { status: 'APPLIED_TO_NEW_COPY', kind: body.kind, projectId: copy.id,
      assetId: body.assetId, sourceProjectId: source.id, revision: saved.project.revision,
      note: body.kind === 'sfx' ? 'One audio cue uses narration slot' :
        'PNG inserted through native Studio PIP overlay' };
  }
  return { apply };
}
let singleton;
async function defaultService() {
  if (!singleton) {
    const [studio, assetRoute] = await Promise.all([
      import('../../src/studio.mjs'), import('./assets-route.mjs'),
    ]);
    singleton = createTimedAssetService({
      studio, assets: await assetRoute.getDefaultAssetService(),
    });
  }
  return singleton;
}
export async function handleTimedAssetApi({ method, pathname, request, response, json, readJsonBody, service }) {
  try {
    if (method !== 'POST' || pathname !== '/api/cutpilot/assets/place')
      throw new TimedAssetError('ROUTE', 'Unknown asset placement route.', 404);
    const data = await (service || await defaultService()).apply(await readJsonBody(request));
    return json(response, 201, { ok: true, ...data });
  } catch (error) {
    const known = error instanceof TimedAssetError || error?.name === 'StudioError';
    return json(response, error instanceof TimedAssetError ? error.status :
      error?.name === 'StudioError' ? 400 : 500, { ok: false,
      error: { code: error.code || 'PLACE_FAILED', message: known ? error.message : 'Timed placement failed.' } });
  }
}
