#!/usr/bin/env node
// Read-only interoperability shim. Does not import either product runtime or call any API.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIMITS = Object.freeze({ clips: 200, sourceSeconds: 7200, editSeconds: 1200, minSource: 0.5 });

function basenameAny(p) { return path.win32.basename(p.replaceAll('/', '\\')); }
function absoluteAny(p) { return path.isAbsolute(p) || path.win32.isAbsolute(p); }
function finiteNumber(v) { return typeof v === 'number' && Number.isFinite(v); }
function requireValid(ok, message) { if (!ok) throw new Error(message); }

export function buildCutPilotBridgePlan(manifest, sourcePath, { projectId, revision } = {}) {
  requireValid(manifest && typeof manifest === 'object' && !Array.isArray(manifest), 'Manifest must be an object');
  requireValid(manifest.version === '0.8', 'Unsupported CutPilot manifest version (expected 0.8)');
  requireValid(typeof manifest.source === 'string' && manifest.source.length > 0, 'Manifest source is missing');
  requireValid(typeof sourcePath === 'string' && absoluteAny(sourcePath), 'Source media path must be absolute');
  requireValid(basenameAny(sourcePath).toLowerCase() === basenameAny(manifest.source).toLowerCase(), 'Source media basename does not match CutPilot manifest');
  requireValid(Array.isArray(manifest.clips) && manifest.clips.length > 0 && manifest.clips.length <= LIMITS.clips, 'Clip count outside supported range (1–200)');
  requireValid((projectId === undefined) === (revision === undefined), 'Provide projectId and revision together');
  if (projectId !== undefined) {
    requireValid(typeof projectId === 'string' && /^[0-9a-f-]{36}$/.test(projectId), 'Invalid AI Edit Studio projectId');
    requireValid(Number.isInteger(revision) && revision >= 1, 'AI Edit Studio revision must be a positive integer');
  }

  const ranked = manifest.clips.map((clip, ordinal) => {
    requireValid(clip && typeof clip === 'object', `Clip ${ordinal + 1}: missing metadata`);
    const { source_start: start, source_end: end, score } = clip;
    requireValid(finiteNumber(start) && finiteNumber(end) && start >= 0 && end <= LIMITS.sourceSeconds && end - start >= LIMITS.minSource,
      `Clip ${ordinal + 1}: invalid original-source times (min 0.5s; max 7200s)`);
    requireValid(finiteNumber(score) && score >= 0 && score <= 100, `Clip ${ordinal + 1}: invalid rank score`);
    const title = String(clip.title ?? `Clip ${ordinal + 1}`).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 60);
    return { ordinal, originalId: String(clip.id ?? ''), start, end, score, title };
  }).sort((a, b) => b.score - a.score || a.ordinal - b.ordinal);

  const duration = ranked.reduce((total, row) => total + row.end - row.start, 0);
  requireValid(duration <= LIMITS.editSeconds, 'Combined selections exceed AI Edit Studio 1200-second timeline; split into smaller batches');

  const clips = ranked.map((row, i) => ({
    id: `cp${String(i + 1).padStart(3, '0')}`,
    sourceIndex: 0,
    start: row.start,
    end: row.end,
    label: row.title,
  }));
  const plan = {
    contract: 'cutpilot-aes-bridge/v1',
    mode: 'READ_ONLY_PLAN',
    note: 'Run studio_create separately; take projectId/revision from its result, then regenerate with --project-id and --revision. Review studio_edit dryRun before any apply.',
    ranked: ranked.map((row, i) => ({ rank: i + 1, cutpilotId: row.originalId, score: row.score, sourceStart: row.start, sourceEnd: row.end })),
    create: { tool: 'studio_create', arguments: {
      name: `CutPilot picks - ${basenameAny(sourcePath)}`.slice(0, 100),
      inputs: [sourcePath], options: { label: '', endTitle: '' },
    } },
    edit: { tool: 'studio_edit', ...(projectId === undefined ? { requires: ['projectId', 'revision'] } : {}),
      arguments: { ...(projectId === undefined ? {} : { projectId, revision }),
        operations: [{ op: 'replace', clips }], dryRun: true,
        summary: 'Review CutPilot ranked selections', author: 'cutpilot-bridge',
      },
    },
  };
  return plan;
}

export function main(args) {
  const argv = new Map();
  for (let i = 0; i < args.length; i += 2) {
    requireValid(args[i]?.startsWith('--') && args[i + 1] !== undefined, 'Usage: node bridge.mjs --manifest <frontend_manifest.json> --source <absolute-source-video> [--project-id <uuid> --revision <int>]');
    const key = args[i].slice(2);
    requireValid(['manifest', 'source', 'project-id', 'revision'].includes(key) && !argv.has(key), `Unknown or duplicated option: ${key}`);
    argv.set(key, args[i + 1]);
  }
  const manifestPath = argv.get('manifest');
  requireValid(manifestPath && argv.get('source'), 'Both --manifest and --source are required');
  requireValid(fs.statSync(manifestPath).isFile(), 'Manifest is not a file');
  requireValid(fs.statSync(argv.get('source')).isFile(), 'Source media is not a file');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const options = {};
  if (argv.has('project-id')) options.projectId = argv.get('project-id');
  if (argv.has('revision')) options.revision = Number(argv.get('revision'));
  process.stdout.write(JSON.stringify(buildCutPilotBridgePlan(manifest, argv.get('source'), options), null, 2) + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`CUTPILOT_BRIDGE_REJECTED: ${error.message}`); process.exitCode = 1; }
}
