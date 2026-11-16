# CutPilot ranker → AI Edit Studio (P0, read-only bridge)

This *optional integration* lives outside the Studio engine. It does not modify
CutPilot, AI Edit Studio, a project, or the original video. It converts the
existing CutPilot `frontend_manifest.json` v0.8 to a reviewed `studio_create`
and `studio_edit` **dry-run** plan. It does **not** run the ranker, render media,
contact a server, or apply edits. Review ranking in Studio before any apply.

```bash
node integrations/cutpilot/bridge.mjs \
  --manifest /path/to/cutpilot-job/frontend_manifest.json \
  --source /absolute/path/to/original-source.mp4 > plan.json
```

1. Open `plan.json` and use `create.arguments` with `studio_create` in your local
   Studio. This is the *only* stage that creates a new project, and must be
   explicitly invoked by the operator.
2. Read the resulting project ID and revision from `studio_create` (or
   `studio_get`). Regenerate the plan with `--project-id <uuid> --revision <n>`.
3. Pass `edit.arguments` to `studio_edit` with `dryRun:true`. Review clips and
   the preview. To commit the edit later, an operator must **separately** make
   an authorized Studio API call; this script never does so.

The bridge sorts candidates by descending CutPilot score (stable on ties) and
preserves original *source* in/out times. It refuses absent or mismatched
source filenames, unsupported manifest revisions, invalid scores/ranges, and
an edit longer than Studio's 1200-second limit. For longer edits, split the
CutPilot selections into multiple reviewed projects instead of truncating.

Note that the CutPilot frontend manifest contains a source **basename**, not an
absolute media path. Supply the actual original video path explicitly; do not
use the already-rendered CutPilot clip as if it were the source.

This P0 bridge intentionally omits CutPilot's animated reframing, b-roll,
subtitles, and advanced activity feature vectors; only candidate ordering,
rank scores (for review), titles, and source ranges are transferred. The
existing Studio render pipeline remains authoritative.

Test (no video/GPU dependencies):

```bash
node --test integrations/cutpilot/bridge.test.mjs
```
