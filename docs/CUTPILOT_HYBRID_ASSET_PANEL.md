# CutPilot Hybrid Assets — Studio UI (P4)

The panel is mounted inside the Studio **Moments** sidebar on the isolated
`feat/cutpilot-hybrid-asset-panel-20261117` fork branch.

- Search: local / online / hybrid. Openverse is keyless (image/audio); Pexels
  and Pixabay use environment API keys if configured (image/video).
- Preview: remote provider preview thumbnails and small (<8 MiB) locally
  imported images; media preview is not video playback in this slice.
- Bookmark: one selected, server-stored result by `searchId` + index; only
  metadata is cached, remote bytes are never downloaded.
- Import local: operator pastes an absolute file path and explicitly confirms
  rights. CutPilot copies it to content-addressed local cache (max 512 MiB/file).
- Use: **only verified locally imported video/image** by opaque asset ID, after
  explicit rights confirmation. Studio creates and edits a **new isolated
  project** with a <=10s initial clip. Original project is unchanged.
- Source license status stays `unknown` until separately reviewed;
  a provider's commercial-use metadata is not proof of permission.

CutPilot backend branch: `feat/cutpilot-hybrid-assets-studio-ui-20261117`.
The backend extends `cutpilot.hybrid_assets` with `pin` on bounded stdin
and `resolve --asset-id` SHA256 integrity checking. Configure
`CUTPILOT_REPO` and `CUTPILOT_PYTHON` in the Studio runtime (the
CutPilot product launcher sets these automatically).

No standalone stock redistribution, live network media download, automated
license clearance, or edits to the original CutPilot editor. Studio core
editing/rendering remains upstream-owned.

Local regression commands (not yet executed on physical Windows):
- Python: `python -m pytest -q tests/test_hybrid_assets*.py`
- Node: `node --test integrations/cutpilot/*.test.mjs`
- Browser smoke: open Studio and inspect the Moments sidebar; test both
  online search and local import, then inspect the newly created project.

Release remains blocked on Windows real-media checks. GitHub Actions are not
required for this branch.
