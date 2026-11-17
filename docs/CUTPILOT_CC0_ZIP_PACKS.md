# CutPilot CC0 Media ZIP Packs — first external binary media integration

This stage adds an **offline, opt-in import of already downloaded ZIP
files**, not a bundle of downloaded copyrighted stock assets. It does not
reimplement the Studio render engine.

## Sources verified on the official publisher site (2026-11-17)

- Kenney Particle Pack: https://kenney.nl/assets/particle-pack — official CC0;
  includes particles / PNG effect sprites.
- Kenney UI Pack: https://kenney.nl/assets/ui-pack — official CC0;
  includes UI images useful as decorative tags/callouts.
- Optional Mixkit discovery: https://mixkit.co/free-sound-effects/ —
  usable in commercial end-products, but the **Mixkit license prohibits
  redistribution in another tool, template or stock library**. Never bundle
  or auto-import Mixkit stock in this repository.

The ZIP must be downloaded from the official Kenney site by the operator,
have a valid CC0 license text INSIDE, and be manually confirmed before
import. ZIP membership/license text is not a cryptographic authenticity
check. The imported records keep `license_status: unknown` and
`origin_verified: false` for auditing.

## Studio workflow

- Open Moments > Hybrid Assets > CC0 素材包匯入.
- Use the Kenney official link, download a ZIP manually, paste its full
  local absolute path.
- Choose the correct Kenney source and confirm license/source.
- Only PNG/JPG/WebP/GIF, WAV/MP3/OGG/FLAC, WebM/MP4 found inside are
  copied to the content-addressed local cache.
- Local Search displays imported files. Images get a thumbnail; local
  audio (up to 12 MiB) can be auditioned via a read-only same-origin
  audio endpoint. Imported supported images/video can be opened in an
  **isolated new project** as in the previous stage.
- Audio **is not yet a timed SFX track**. WebM alpha compositing and GIF
  animation are **not validated**; neither is safe to promise in rendered
  outputs. ZIP is an archive of source binaries, not a complete executable
  timeline template. External reusable timeline templates remain pending.

## Constraints

- Max 128 MiB compressed archive, max 300 MiB declared decompressed bytes,
  32 MiB per entry, 700 media entries; rejected ZIP traversal/symlinks.
- Streams to temp, copies to SHA256 cache, deduplicates. No network
  download, no third-party media file is placed in GitHub.
- Records are persisted locally only; no cloud upload.
- No GitHub Actions, no Main merge, no old engine deletion.

## Local tests (NOT_RUN here)

CutPilot:

    python -m pytest -q tests/test_pack_import.py tests/test_hybrid_assets_studio.py

Studio:

    node --test integrations/cutpilot/assets-route.test.mjs

Real Kenney ZIP, Mac/Windows Studio preview and MP4 render remain unverified.
