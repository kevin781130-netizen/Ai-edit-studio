# CutPilot brand / AI Edit Studio editing engine — P1 preview

**Architecture decision (2026-11-16):** Keep **CutPilot** as product name and maintain only its
unique candidate ranking and activity/virality algorithms. Use **AI Edit Studio** (MIT, preserve
its license and notices) as the separately maintained NLE, timeline, edit and rendering engine.
The adapter is not an upstream code fork: it speaks Studio's existing localhost API.
The legacy CutPilot editor stays available until Windows RTX 5090 A/B acceptance.

## P1 boundary (implemented)

- CutPilot `frontend_manifest.json` v0.8, produced by the existing pipeline, is the input.
- The operator supplies the **original** video file, not the rendered CutPilot clips.
- Confirm CutPilot's ranked in/out spans, score and title; produce one isolated new
  AI Edit Studio draft project, then call its native `studio_edit` **dryRun**.
- Verify after preview that the newly created project's revision and persisted plan
  are unchanged. No edits are applied, no video is exported, and existing Studio
  projects are never accessed or changed.
- A nonzero exit does not delete an empty draft project. If a server-side failure
  occurs after create, the error includes its project ID for operator inspection.
- No migration of CutPilot subtitles, cropping, B-roll, or existing project edits.

## Windows UAT handoff — not yet passed

Start AI Edit Studio normally on Windows (the server listens on `127.0.0.1:32146`).
From the **P1 integration branch** checkout, with Node.js 22+ installed:

```powershell
node integrations/cutpilot/preview.mjs --manifest "D:\CutPilot\job\frontend_manifest.json" --source "D:\Videos\source.mp4" --create-preview-project
```

Replace both paths with existing files. `--manifest` must point to CutPilot's output;
`--source` must be the same original file referenced by its basename in the manifest.
The script uses Studio's existing `/api/health`, `/api/agent/tools`, project creation,
`/edit` dry-run and project-read endpoints. It rejects non-loopback origins; `--port`
can be used if Studio is running locally on another port.

Expected stdout: `status: PREVIEW_ONLY`, `projectId`, ranking, preview timeline and
review. The project has **no committed edit**; Studio's GUI timeline stays empty
until an operator authorizes a later separate apply step.

Tests (Node only, no GPU or input media required):

```bash
node --test integrations/cutpilot/bridge.test.mjs integrations/cutpilot/preview.test.mjs
```

P1 is **not a functional CutPilot replacement**, **not a physical Windows test**, and
**not a real AI Edit Studio engine integration pass** until a Windows machine
runs the command against an actual Studio server and actual source media.
