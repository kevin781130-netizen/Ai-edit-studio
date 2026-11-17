# CutPilot P3 AutoPosition review integration in AI Edit Studio

Pinned CutPilot P3 branch: feat/cutpilot-autoposition-reframe-p3-20261117.

## UI
Open a saved single-source CutPilot timeline in Studio, then go to
Moments > Hybrid Assets > AutoPosition. Choose the local P3 `review.json`
file, press **唯讀預覽** (Studio dryRun), inspect the crop notes and
diff, and explicitly confirm **套用到新副本**.

Only sufficiently confident face-centered framing uses Studio-native
`set` operations (`focusX`/`focusXEnd`, `framing=fill`).
The original edit cannot be applied in place from this route. The route
rejects stale revision, source mismatch, clip order/time mismatch,
dimension mismatch, contradictory confidence, unassigned asset execution
and invalid JSON. The browser file stays local until the P3 JSON data is
submitted to the local Studio server. No media bytes are transmitted.

When MediaPipe cannot confidently follow a subject, the UI stays
**REVIEW_ONLY** and refuses to edit. Scene-cut-internal and complex tracks
are marked for manual review, as Studio currently supports only a start
and end focus for each clip.

## Exact limits

- P3 does not yet place SFX, sticker images or subtitles automatically.
  They are **hints** without bound asset IDs and stay read-only.
- Requires Studio to have the same original single video file, unchanged
  ranked clip order, start/end source times, media dimensions and duration,
  and a saved revision.
- Full real-media GUI and MP4 alpha/pan verification: **NOT_RUN**.
- No GitHub Actions, no changes to Main, original project untouched.

Local Node regression:
    node --test integrations/cutpilot/autoposition-route.test.mjs

CutPilot regression:
    python -m pytest -q tests/test_autoposition*.py

Use `git submodule update --init -- engines/ai-edit-studio` from
CutPilot's final integration branch when you next perform real UAT.
