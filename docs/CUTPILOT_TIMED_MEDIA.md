# CutPilot P8 — timed PNG sticker and single local SFX

Branch: feat/cutpilot-timed-stickers-sfx-20261117

## Scope

Moments > Hybrid Assets > local search results now offer:
- **PNG image**: choose starting time (seconds), duration (0.5–10 s),
  screen position, size (0.15–0.70), then add a native Studio picture-in-picture
  overlay to a newly duplicated project.
- **Local audio**: choose start time and gain, then add one audio cue using the
  existing **narration / narrationStart** audio track to a newly duplicated
  project. If the source already has narration/voice-over, placement is
  **BLOCKED**. This is intentionally NOT a multitrack SFX editor.

Both operations work by asset ID from the local CutPilot SHA256 cache, not by
arbitrary user-provided file paths. The image-only append function is called
from the isolated CutPilot adapter and performs Studio's checkedFile +
probeStill validation; it is not a generic HTTP file path endpoint.

## Isolation

- Reject unsaved browser edits, busy projects, stale revisions, bad times,
  source overflow, mismatched media and unconfirmed rights.
- `duplicateProject` preserves source clip ordering, existing captions,
  analysis, transcripts and project history; edit/save occurs ONLY in the
  new copy. For image sticker, one verified image source is appended to the
  copy and its PIP overlay added through `editProject`.
- Failed work may leave an unused **new** draft for the user to remove; it
  must not alter the source edit.
- PNG alpha is handled by the Studio render path, but **actual alpha output
  has not been tested** on Windows or Mac in this stage.
- Audio placement uses Studio's existing input path and narration delay,
  not synthetic SFX presets or a new renderer.

## Validation in this turn

- GitHub code, bridge route, and pinned gitlinks verified.
- JavaScript syntax checked for the modified browser/adapter modules.
- Adapter mock execution verified: sticker duplicate+append+edit,
  audio duplicate+edit, voice-over protection, out-of-range protection.
- Full Node tests, full Python tests, browser UAT, actual MP4 render
  remain **NOT_RUN**.

Local test commands (no Actions required):

    node --test integrations/cutpilot/timed-media-route.test.mjs
    node --test integrations/cutpilot/assets-route.test.mjs

On CutPilot Python side:

    python -m pytest -q tests/test_asset_audio_timeline.py

## Release limits

No Main merge, no new dependencies or external downloads, no automatic stock
redistribution. This is first usable **one-shot** timed asset placement; future
multi-SFX track with independent files must have its own robust core contract.
