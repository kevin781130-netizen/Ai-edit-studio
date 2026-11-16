# Upstream update policy (fork maintenance)

| Item | Value |
| --- | --- |
| Canonical upstream | https://github.com/laaielichter/Ai-edit-studio (GitHub API: fork parent/source) |
| Fork (origin) | https://github.com/kevin781130-netizen/Ai-edit-studio |
| Upstream branch | `main` |
| Upstream base (merge-base) | `cb108299a8873ca7a876982529f853fef3dd1050` |
| Upstream main at last fetch | `dda2446e69757e33b6897a76f7f204e3a3c71980` (2026-11-16; 4 commits ahead, #156 not merged yet) |
| Local integration base | `96d2744ffb2d2bb3de8b5fa1de3cea132412df89` + uncommitted work (not committed by the agent) |
| CutPilot adapter | 1.0.0 (`integrations/cutpilot/studio-route.mjs`) |
| Chinese UI | zh-TW / zh-CN 1.0 (`public/i18n.zh-TW.js`, generated `public/i18n.zh-CN.js`) |
| Last sync | not merged into this branch yet. Trial merge 2026-11-17 in a throwaway clone (branch `sync/upstream-20261117`): no conflicts, `npm test` 292/292; `git revert -m 1` restored the pre-sync tree exactly (288/288) |

Remote setup: `git remote add upstream https://github.com/laaielichter/Ai-edit-studio.git` and
`git remote set-url --push upstream DISABLED-no-push-to-upstream` (fetch only). `origin` is unchanged.

## Where fork changes live (keep core edits minimal)
- Own files: `integrations/cutpilot/*`, `public/cutpilot.js`, `public/i18n.zh-TW.js`, `public/i18n.zh-CN.js`,
  `public/i18n.nl-extra.js`, `public/i18n-cjk.css`, `public/page-i18n.js` + `page-i18n.zh-TW.js` / `page-i18n.zh-CN.js`
  (launch.html / legacy.html), `tools/i18n-zh-cn.mjs`, `test/i18n-zh.test.mjs`.
- Small hooks in upstream files (expected conflict points): `server.mjs` (1 route line), `public/studio.js`
  (import/init/reset + `tm()` at toast/status/api/review/history), `public/i18n.js` (language detection, `tm`,
  dictionary selection), `public/index.html` (language `<select>`), `public/launch.html` and `public/legacy.html` (one `<script>` tag each).

## Sync procedure (never on main, never reset/force)
1. `git fetch upstream` ; `git log --oneline HEAD..upstream/main` (new upstream work) ;
   `git diff HEAD...upstream/main --stat` (what changed) ; `git diff upstream/main...HEAD --stat` (our changes).
2. `git switch -c sync/upstream-YYYYMMDD` from the last accepted fork commit.
3. `git merge --no-ff upstream/main`; resolve conflicts in the hook files above, keeping both sides.
4. New UI strings (English in the editor, Dutch in launch/legacy): `node --test test/i18n-zh.test.mjs` lists missing keys → add to `i18n.zh-TW.js`,
   run `node tools/i18n-zh-cn.mjs` (needs `pip install opencc`, maintainer only), review the zh-CN diff.
5. Check API / project schema / MCP tool changes: `git diff HEAD...upstream/main -- src/agent-tools.mjs src/studio.mjs src/editing.mjs`.
6. Gate (all must pass, else do not release; list the failures as the fix list): `npm test`
   (includes CutPilot adapter, bridge, Find clips wiring, i18n completeness), live CutPilot rank→preview→apply on
   real media, manual Timeline / Preview / Export / MCP / HTTP / CLI check, open an existing project.
7. Rollback: the previous accepted commit/branch is untouched; delete the sync branch or `git revert -m 1 <merge>`.
   User projects and media live in the data folder and are never touched by a code sync.

Forbidden: `git reset --hard upstream/main`, `git push --force`, merging upstream unreviewed, copying upstream code
without git history.

## Known compatibility notes
- Upstream #156 changes one `NL` line and one placeholder in `index.html`; both old and new keys exist in zh dictionaries.
- Studio refuses overlapping footage in one timeline; the adapter skips overlapping CutPilot candidates (ranking unchanged).
