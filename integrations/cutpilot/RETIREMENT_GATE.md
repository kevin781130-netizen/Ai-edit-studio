# CutPilot product / AI Edit Studio engine — retirement gate (P2)

## Decision

**CutPilot remains the product/brand and owns ranker/activity/virality differentiation.**
**AI Edit Studio** (MIT, preserve LICENSE and upstream notices) owns timeline, edit, subtitles,
beat sync, and renders. The adapter lives in `integrations/cutpilot/` and does not modify
Studio's engine. Neither the original CutPilot editor nor its full backend is removed by P2.

The new **rank-only** CLI is on the separate CutPilot branch
`feat/ranker-only-retirement-20261116`, under `cutpilot/rank_only.py`.
It bypasses the old CutPilot editor and never invokes the legacy renderer. It produces
`frontend_manifest.json` **without** running the original export pipeline.

## Windows handoff (single operator command, 2 checkouts)

Prerequisites: Windows 11, Node 22+, FFmpeg/ffprobe; existing CutPilot Python 3.11
venv with required packages; AI Edit Studio checked out from
`feat/cutpilot-retirement-gate-p2-20261116` and already running on localhost `32146`;
CutPilot checked out from `feat/ranker-only-retirement-20261116`.

From the AI Edit Studio repository:

```powershell
& '.\integrations\cutpilot\Run-CutPilot-Retirement-UAT.ps1' `
  -Source 'D:\Videos\your-existing-uat-source.mp4' `
  -CutPilotRepo 'C:\path\to\CutPilot' `
  -Mode visual -ApplyAndRender
```

Omit `-ApplyAndRender` for a non-applying dry-run. The script creates a new output
folder under `%TEMP%` for its manifest and evidence and NEVER overwrites source
or edits existing Studio projects. Every run creates a fresh Studio project.

After `-ApplyAndRender`, the CLI independently verifies: dry-run acceptance;
edit revision increments exactly once; persisted source spans equal CutPilot picks;
vertical MP4 is registered at the expected revision; Studio QC reports `passed:true`.
Any failure returns nonzero and identifies the newly created project for inspection.
No destructive cleanup, automatic publishing, or old editor replacement occurs.

## What a PASS does **not** prove

Studio rendering and QC alone cannot certify that CutPilot R10 functionality is
replaced. The Windows operator MUST compare the **same media** against the existing
CutPilot R10 baseline and explicitly sign off:

- speech AND visual selection ranking (including scene-cut handling, activity and
  virality); no silent score changes
- frame-accurate source selection and the 0.5s start offset; save, re-edit and undo
- dynamic face / active-speaker 9:16 cropping (Studio declares `faceTracking:false`);
  screenshot/visual parity is required — currently NOT demonstrated
- Traditional Chinese karaoke captions, fonts, timing, no missing glyphs;
  B-roll; silence/filler cleanup; branding; audio loudness
- Studio preview/scrubbing, vertical MP4 decode/output; QC score and file integrity
- input media unchanged; failure/restart recovery; local-only API; valid rights

**Gate:** `READY_TO_RETIRE_LEGACY_EDITOR=NO` until every required parity row has real
Windows evidence and owner approval. Once proven, archive old editor code instead of
merging or deleting it and keep a rollback tag. There is no automatic retirement.

## Fast local regression tests

```bash
node --test integrations/cutpilot/*.test.mjs
```

This test suite uses simulated API contracts (including actual local HTTP mock in
P1), *not* a running AI Edit Studio engine and not Windows GPU rendering.
