// Local-only Studio HTTP adapter. Search never downloads media; all edits create NEW projects.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { resolveCutPilotConfig, validateRepo, validatePython } from './studio-route.mjs';

const UUID = /^[0-9a-f-]{36}$/i;
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

export class AssetPanelError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
function guard(ok, code, message, status = 400) {
  if (!ok) throw new AssetPanelError(code, message, status);
}
function runPython(cfg, args, input) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cfg.python, [...cfg.pythonArgs, '-m', 'cutpilot.hybrid_assets', ...args], {
        cwd: cfg.repo, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      });
    } catch (error) { reject(new AssetPanelError('PYTHON_ERROR', error.message, 502)); return; }
    let out = '', err = '', done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true; clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new AssetPanelError('TIMEOUT', 'Asset provider timed out.', 504));
    }, 75000);
    child.stdout.on('data', b => {
      out += b.toString('utf8');
      if (out.length > 1024 * 1024) {
        child.kill();
        finish(new AssetPanelError('OUTPUT_LIMIT', 'Asset response too large.', 502));
      }
    });
    child.stderr.on('data', b => { err = (err + b.toString('utf8')).slice(-3000); });
    child.on('error', e => finish(new AssetPanelError('PYTHON_ERROR', e.message, 502)));
    child.on('close', code => {
      if (done) return;
      if (code !== 0) return finish(new AssetPanelError('ASSET_BACKEND',
        err.split('\n').filter(Boolean).at(-1)?.slice(0, 250) || 'Asset command failed.', 502));
      try { finish(null, JSON.parse(out)); }
      catch { finish(new AssetPanelError('INVALID_JSON', 'Asset backend returned invalid JSON.', 502)); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input === undefined ? undefined : JSON.stringify(input));
  });
}

export function createAssetPanelService({ invoke, studio, clock = () => Date.now() }) {
  const searches = new Map();
  const run = (args, input) => invoke(args, input);

  async function search(body = {}) {
    const q = String(body.query ?? '').trim(), scope = String(body.scope ?? 'hybrid');
    const kind = String(body.mediaType ?? 'video'), limit = Number(body.limit ?? 12);
    guard(q.length >= 1 && q.length <= 100, 'QUERY', 'Query must contain 1–100 characters.');
    guard(['local', 'online', 'hybrid'].includes(scope), 'SCOPE', 'Invalid search scope.');
    guard(['video', 'image', 'audio', 'effect'].includes(kind), 'TYPE', 'Invalid media type.');
    guard(Number.isInteger(limit) && limit >= 1 && limit <= 20, 'LIMIT', 'Limit must be 1–20.');
    const result = await run(['search', q, '--scope', scope, '--type', kind, '--limit', String(limit)]);
    guard(Array.isArray(result.results) && result.results.length <= limit,
      'PROVIDER_RESPONSE', 'Invalid asset search result.', 502);
    const searchId = randomUUID();
    searches.set(searchId, { until: clock() + 600000, hits: result.results });
    while (searches.size > 20) searches.delete(searches.keys().next().value);
    return { ...result, searchId };
  }

  async function pin(body = {}) {
    const session = searches.get(String(body.searchId ?? ''));
    guard(session && session.until > clock(), 'EXPIRED', 'Search expired. Search again.', 409);
    const index = body.index;
    guard(Number.isInteger(index) && index >= 0 && index < session.hits.length,
      'SELECTION', 'Invalid asset selection.');
    const hit = session.hits[index];
    guard(hit.origin === 'online' && ['openverse', 'pexels', 'pixabay'].includes(hit.provider),
      'NOT_REMOTE', 'Only remote assets can be bookmarked.');
    const output = await run(['pin'], hit);
    guard(output.pinned?.asset_id, 'PIN_FAILED', 'Bookmark failed.', 502);
    session.hits[index] = output.pinned;
    return output;
  }

  async function importLocal(body = {}) {
    const file = String(body.path ?? '').trim();
    guard(file.length > 0 && file.length <= 2048 && path.isAbsolute(file) &&
      !/^(?:\\\\|\/\/)/.test(file), 'INVALID_PATH', 'Enter an absolute local file path.');
    guard(body.confirm === true, 'CONFIRM', 'Confirm that you may import this file.', 403);
    const output = await run(['import', file]);
    guard(output.imported?.asset_id, 'IMPORT_FAILED', 'Local file import failed.', 502);
    return output;
  }

  async function importPack(body = {}) {
    const archive = String(body.path ?? '').trim();
    const sourceId = String(body.sourceId ?? '');
    guard(['kenney-particle-cc0', 'kenney-ui-cc0'].includes(sourceId),
      'PACK_SOURCE', 'Choose one of the listed CC0 sources.');
    guard(archive.length >= 1 && archive.length <= 2048 &&
      path.isAbsolute(archive) && !/^(?:\\\\|\/\/)/.test(archive) &&
      archive.toLowerCase().endsWith('.zip'),
      'PACK_PATH', 'Choose an existing local ZIP by absolute path.');
    guard(body.confirm === true, 'PACK_CONSENT',
      'Confirm the source, ZIP license and permission to import.', 403);
    const output = await run(['pack-import', '--archive', archive, '--source-id',
      sourceId, '--confirmed']);
    guard(output?.pack?.source_id === sourceId && Number.isInteger(output.pack.imported),
      'PACK_RESPONSE', 'The pack backend did not verify its result.', 502);
    return output;
  }

  async function previewAudio(assetId) {
    guard(typeof assetId === 'string' && UUID.test(assetId), 'ASSET_ID', 'Invalid asset ID.');
    const result = await run(['audio-preview', '--asset-id', assetId]);
    const asset = result.asset;
    guard(asset?.asset_id === assetId && asset.provider === 'local' &&
      asset.media_type === 'audio' && typeof asset.local_path === 'string' &&
      asset.local_path.length > 0, 'NOT_LOCAL', 'Only cached local audio is previewable.', 403);
    const mime = {
      '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
    }[path.extname(asset.title || '').toLowerCase()];
    guard(mime, 'AUDIO_FORMAT', 'Audio preview format unsupported.');
    const metadata = await stat(asset.local_path);
    guard(metadata.isFile() && metadata.size > 0 && metadata.size <= 12 * 1024 * 1024,
      'AUDIO_SIZE', 'Audio preview exceeds 12 MiB.');
    return { path: asset.local_path, size: metadata.size, type: mime };
  }

  async function resolveLocal(id) {
    guard(typeof id === 'string' && UUID.test(id), 'ASSET_ID', 'Invalid asset ID.');
    const output = await run(['resolve', '--asset-id', id]);
    const hit = output.asset;
    guard(hit?.asset_id === id && hit.provider === 'local' &&
      ['image', 'video'].includes(hit.media_type) && typeof hit.local_path === 'string' &&
      hit.local_path.length > 0, 'NOT_LOCAL', 'Only imported local images/videos can be used.', 403);
    return hit;
  }

  async function useLocal(body = {}) {
    guard(body.confirmRights === true, 'RIGHTS', 'Confirm rights before using local media.', 403);
    const hit = await resolveLocal(String(body.assetId ?? ''));
    const project = await studio.createProject({
      name: ('CutPilot asset · ' + (hit.title || hit.provider_asset_id)).slice(0, 100),
      inputs: [hit.local_path], author: 'cutpilot-hybrid',
    });
    guard(UUID.test(String(project?.id || '')) && project?.sources?.length === 1,
      'DRAFT_FAILED', 'Studio failed to create a new draft.', 502);
    const duration = Number(project.sources[0].duration);
    guard(Number.isFinite(duration) && duration >= .5, 'DURATION', 'Invalid media duration.', 502);
    const result = await studio.editProject(project.id, {
      revision: project.revision, author: 'cutpilot-hybrid',
      summary: 'Place locally imported asset in new draft timeline',
      dryRun: false, operations: [{ op: 'replace',
        clips: [{ sourceIndex: 0, start: 0, end: Math.min(10, duration), label: hit.title }] }],
    });
    return { projectId: project.id, revision: result?.revision, status: 'NEW_PROJECT_ONLY' };
  }

  async function preview(id) {
    const hit = await resolveLocal(id);
    guard(hit.media_type === 'image', 'NOT_IMAGE', 'Only imported images can be previewed here.');
    const type = MIME[path.extname(hit.local_path).toLowerCase()];
    guard(type, 'NOT_IMAGE', 'Image preview format unsupported.');
    const s = await stat(hit.local_path);
    guard(s.isFile() && s.size > 0 && s.size <= 8 * 1024 * 1024,
      'IMAGE_LIMIT', 'Local image preview limited to 8 MiB.');
    return { path: hit.local_path, size: s.size, type };
  }

  return { search, pin, importLocal, importPack, previewAudio, resolveLocal, useLocal, preview };
}

let single;
async function defaultService() {
  if (single) return single;
  const [settings, studio] = await Promise.all([
    import('../../src/settings.mjs'), import('../../src/studio.mjs'),
  ]);
  const cfg = resolveCutPilotConfig({ settings: settings.readUserSettings() });
  validateRepo(cfg.repo); validatePython(cfg.python);
  guard(existsSync(path.join(cfg.repo, 'cutpilot', 'hybrid_assets.py')),
    'NOT_INSTALLED', 'Hybrid assets are missing from CutPilot.', 503);
  single = createAssetPanelService({
    invoke: (args, input) => runPython(cfg, args, input),
    studio,
  });
  return single;
}

export async function handleAssetPanelApi({ method, pathname, request, response, json, readJsonBody, service }) {
  try {
    const s = service || await defaultService();
    const body = method === 'POST' ? await readJsonBody(request) : {};
    let output;
    if (method === 'POST' && pathname === '/api/cutpilot/assets/search') output = await s.search(body);
    else if (method === 'POST' && pathname === '/api/cutpilot/assets/pin') output = await s.pin(body);
    else if (method === 'POST' && pathname === '/api/cutpilot/assets/import') output = await s.importLocal(body);
    else if (method === 'POST' && pathname === '/api/cutpilot/assets/pack-import') output = await s.importPack(body);
    else if (method === 'POST' && pathname === '/api/cutpilot/assets/use') output = await s.useLocal(body);
    else if (method === 'GET' && pathname === '/api/cutpilot/assets/preview-audio') {
      const id = new URL(request.url, 'http://127.0.0.1').searchParams.get('assetId');
      const audio = await s.previewAudio(id);
      response.writeHead(200, { 'Content-Type': audio.type, 'Content-Length': audio.size,
        'Accept-Ranges': 'none', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' });
      createReadStream(audio.path).pipe(response);
      return;
    }
    else if (method === 'GET' && pathname === '/api/cutpilot/assets/preview') {
      const id = new URL(request.url, 'http://127.0.0.1').searchParams.get('assetId');
      const pic = await s.preview(id);
      response.writeHead(200, { 'Content-Type': pic.type, 'Content-Length': pic.size,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      createReadStream(pic.path).pipe(response);
      return;
    } else throw new AssetPanelError('ROUTE', 'Unknown asset endpoint.', 404);
    json(response, pathname.endsWith('/use') ? 201 : 200, { ok: true, ...output });
  } catch (error) {
    const known = error instanceof AssetPanelError || error?.name === 'StudioError';
    json(response, error instanceof AssetPanelError ? error.status : error?.name === 'StudioError' ? 400 : 500,
      { ok: false, error: { code: error?.code || 'INTERNAL_ERROR',
        message: known ? error.message : 'Hybrid asset request failed.' } });
  }
}
