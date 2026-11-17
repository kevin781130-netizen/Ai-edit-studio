// HTTP adapter for first-party MIT native preset packs.
// All mutating operations apply to a NEW Studio duplicate, never source project.
import { randomUUID } from 'node:crypto';
import { buildNativePackOperations, listNativePacks } from './native-pack-catalog.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class PackError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
function requireOk(ok, code, message, status = 400) {
  if (!ok) throw new PackError(code, message, status);
}
export function createNativePackService(studio) {
  requireOk(studio && ['getProject', 'editProject', 'duplicateProject'].every(k => typeof studio[k] === 'function'),
    'NO_STUDIO', 'Studio adapter missing.', 500);

  function list(body = {}) {
    const kind = body.kind ?? 'all', query = body.query ?? '';
    return { packs: listNativePacks({ kind, query }), source: 'studio-native-mit-v1', noExternalAssets: true };
  }

  async function current(body) {
    const id = body.projectId, revision = body.revision;
    requireOk(typeof id === 'string' && UUID.test(id), 'PROJECT_ID', 'Invalid project ID.');
    requireOk(Number.isInteger(revision) && revision > 0, 'REVISION', 'A saved project revision is required.');
    const project = await studio.getProject(id);
    requireOk(project?.revision === revision, 'REVISION_CONFLICT',
      'Project revision changed. Refresh before preview/apply.', 409);
    return project;
  }

  async function preview(body = {}) {
    const project = await current(body);
    const ops = buildNativePackOperations(body.packId, project);
    const result = await studio.editProject(project.id, {
      revision: project.revision, operations: ops, dryRun: true, author: 'cutpilot-native-pack',
    });
    requireOk(result?.dryRun === true && result?.revision === project.revision,
      'PREVIEW_FAILED', 'Studio did not return a safe dry-run preview.', 502);
    return { status: 'PREVIEW_ONLY', packId: body.packId,
      projectId: project.id, revision: project.revision,
      diff: result.diff, review: result.review, timeline: result.timeline };
  }

  async function apply(body = {}) {
    const source = await current(body);
    // Validate entire pack before duplicate to avoid orphan copies for invalid requests.
    buildNativePackOperations(body.packId, source);
    const copy = await studio.duplicateProject(source.id, {
      name: (String(source.name || 'CutPilot project') + ' · Pack').slice(0, 100),
      author: 'cutpilot-native-pack',
    });
    requireOk(copy && UUID.test(String(copy.id || '')) && copy.id !== source.id &&
      copy.revision === 1, 'COPY_FAILED', 'Studio did not create an isolated draft copy.', 502);
    const after = await studio.getProject(source.id);
    requireOk(after.revision === source.revision, 'REVISION_CONFLICT',
      'Source changed during duplication; original project remains untouched.', 409);
    const ops = buildNativePackOperations(body.packId, copy);
    const result = await studio.editProject(copy.id, {
      revision: copy.revision, operations: ops, dryRun: false,
      author: 'cutpilot-native-pack', summary: 'Applied native effect pack to isolated copy',
    });
    requireOk(result?.project?.id === copy.id && result?.project?.revision === 2,
      'APPLY_FAILED', 'Studio could not verify the new copy edit.', 502);
    return { status: 'APPLIED_TO_NEW_COPY', projectId: copy.id, packId: body.packId,
      revision: result.project.revision, diff: result.diff, review: result.review,
      sourceProjectId: source.id, sourceRevision: source.revision };
  }
  return { list, preview, apply };
}

let active;
async function service() {
  if (!active) active = createNativePackService(await import('../../src/studio.mjs'));
  return active;
}

export async function handleNativePackApi({ method, pathname, request, response, json, readJsonBody, svc }) {
  try {
    const backend = svc || await service();
    const body = method === 'POST' ? await readJsonBody(request) : {};
    let result;
    if (method === 'GET' && pathname === '/api/cutpilot/packs') result = backend.list();
    else if (method === 'POST' && pathname === '/api/cutpilot/packs/list') result = backend.list(body);
    else if (method === 'POST' && pathname === '/api/cutpilot/packs/preview') result = await backend.preview(body);
    else if (method === 'POST' && pathname === '/api/cutpilot/packs/apply') result = await backend.apply(body);
    else throw new PackError('NOT_FOUND', 'Unknown native pack route.', 404);
    return json(response, 200, { ok: true, ...result });
  } catch (error) {
    const safe = error instanceof PackError || error instanceof TypeError || error?.name === 'StudioError';
    const status = error instanceof PackError ? error.status : error instanceof TypeError ? 400 :
      error?.name === 'StudioError' ? 400 : 500;
    return json(response, status, { ok: false, error: { code: error.code || 'PACK_ERROR',
      message: safe ? error.message : 'Native preset operation failed.' } });
  }
}
