# CutPilot Native Effect Packs (P5)

This first native effect pack uses **Studio's own MIT editing operations**
rather than redistributing proprietary CapCut/剪映 assets.

## Presets and what they really do

- 8 built-in transition presets mapped to existing FFmpeg xfade transitions;
  requires at least two saved clips.
- 4 caption animation presets; they change subtitle style only and do not
  hallucinate subtitles or transcribe speech.
- 4 ORIGINAL native text sticker presets rendered using the existing text
  overlay engine. These are not bitmap/PNG animated stickers.
- 3 native look templates using existing Studio color/caption settings.

Total 19 zero-download metadata presets. No external assets or license
dependencies. The existing Hybrid Assets online/local catalog is unchanged.

## Editor workflow

Open a **saved** Studio edit > Moments > Hybrid Assets > Native Packs.
Search/filter preset, click "試看效果" for a dry-run diff, or
"套用到副本" to duplicate the current project and apply the selected
preset to the **copy**. No original project mutation. Unsaved changes
must be saved before a preset is applied.

## Gates

- Node unit/contract tests:
  node --test integrations/cutpilot/native-pack-catalog.test.mjs
  node --test integrations/cutpilot/native-packs-route.test.mjs
- Source catalog validated against existing Studio edit operations.
- Real GUI / MP4 / Windows R10 parity: NOT_RUN.
- No Actions, no Main merge, no upstream auto-upgrade.

Later stages can add properly licensed PNG/vector stickers, SFX, and
reusable template ZIP manifests. Each third-party pack still needs its
own source/version/license/provenance checks before commercial distribution.
