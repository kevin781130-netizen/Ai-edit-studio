// CutPilot P3: local JSON file import -> Studio read-only preview -> apply on COPY.
// Does not send media bytes to any server; JSON is reviewed, never executed.
const $ = id => document.getElementById(id);
const elt = (tag, cls, text) => {
  const x = document.createElement(tag);
  if (cls) x.className = cls;
  if (text !== undefined) x.textContent = text;
  return x;
};
let context;
let reviewPlan = null;
let previewed = null;
let working = false;
function status(msg) {
  const node = $('cp-p3-status');
  if (node) node.textContent = msg;
}
function current() {
  const state = context?.state;
  const project = state?.project;
  if (!project?.id || !Number.isInteger(project.revision))
    throw new Error('請先開啟已儲存的 Studio 專案');
  if (state.dirty || state.pending)
    throw new Error('請先儲存目前尚未套用的時間軸修改');
  return { projectId: project.id, revision: project.revision };
}
async function guarded(fn) {
  if (working) return;
  working = true;
  for (const id of ['cp-p3-preview', 'cp-p3-apply']) {
    const button = $(id); if (button) button.disabled = true;
  }
  try { await fn(); }
  catch (error) { status(error.message); context.toast?.(error.message); }
  finally {
    working = false;
    if ($('cp-p3-preview')) $('cp-p3-preview').disabled = !reviewPlan;
    if ($('cp-p3-apply')) $('cp-p3-apply').disabled = !previewed;
  }
}
function renderNotes(result) {
  const target = $('cp-p3-notes');
  target.replaceChildren();
  const row = elt('p', 'muted small', '片段 ' + result.clips +
    ' · 安全構圖 ' + result.eligible +
    ' · 需人工審核 ' + result.manualReview +
    ' · 其他定位建議 ' + result.suggestedPositions);
  target.append(row);
  for (const note of (result.notes || []).slice(0, 12)) {
    target.append(elt('p', 'muted small',
      note.clipId + '：' + note.status + '（' + note.reason + '）'));
  }
}
async function readPlan(file) {
  previewed = null; reviewPlan = null;
  $('cp-p3-apply').disabled = true;
  $('cp-p3-preview').disabled = true;
  $('cp-p3-notes').replaceChildren();
  if (!file) { status('尚未選擇 P3 JSON'); return; }
  if (file.size > 1024 * 1024) { status('JSON 最大支援 1 MiB'); return; }
  try {
    const parsed = JSON.parse(await file.text());
    if (parsed?.schema_version !== 'autoposition-review/1' ||
        parsed?.status !== 'review_required')
      throw new Error('不是 AutoPosition P3 審核檔');
    reviewPlan = parsed;
    status('已讀取 P3 計畫；請先按「唯讀預覽」確認時間軸吻合');
    $('cp-p3-preview').disabled = false;
  } catch (error) { status('讀取失敗：' + error.message); }
}
async function preview() {
  if (!reviewPlan) throw new Error('請先選擇 P3 JSON');
  const target = current();
  const result = await context.api('/api/cutpilot/autoposition/preview', 'POST',
    { ...target, plan: reviewPlan });
  previewed = result.status === 'PREVIEW_ONLY' ? target : null;
  renderNotes(result);
  status(result.status === 'PREVIEW_ONLY' ?
    'Studio 唯讀預覽完成；原專案未修改。確認後可套用到副本。' :
    '只有定位建議，沒有足夠安全的人臉構圖可套用；原專案未修改。');
}
async function apply() {
  if (!reviewPlan || !previewed) throw new Error('必須先成功完成唯讀預覽');
  const target = current();
  if (target.projectId !== previewed.projectId || target.revision !== previewed.revision)
    throw new Error('專案已變更，請重新預覽');
  if (!window.confirm('確定將已驗證的人臉構圖套用到「新專案副本」？原始專案不會修改。'))
    return;
  const result = await context.api('/api/cutpilot/autoposition/apply', 'POST',
    { ...target, plan: reviewPlan, confirm: true });
  if (result.status !== 'APPLIED_TO_NEW_COPY') throw new Error('未確認副本成功建立');
  status('已完成：' + result.eligible + ' 個鏡頭的安全構圖套用到新副本');
  previewed = null; $('cp-p3-apply').disabled = true;
  await context.openProject(result.projectId);
}
export function mountAutoPositionReview(ctx) {
  if ($('cp-p3-panel') || !$('cp-assets-panel')) return;
  context = ctx;
  const panel = elt('section', 'cp-p3-panel');
  panel.id = 'cp-p3-panel';
  panel.append(elt('h5', '', 'AutoPosition · 智慧構圖審核'),
    elt('p', 'help', '載入 CutPilot P3 計畫 JSON。先核對原影片與剪點，再預覽；只會把安全構圖套用到新的專案副本。字幕／貼紙／音效定位仍是建議，不會自動加入。'));
  const input = elt('input');
  input.type = 'file'; input.accept = '.json,application/json';
  input.id = 'cp-p3-file';
  input.onchange = () => readPlan(input.files?.[0]);
  const row = elt('div', 'cp-asset-actions');
  const previewButton = elt('button', 'secondary', '唯讀預覽');
  previewButton.id = 'cp-p3-preview'; previewButton.disabled = true;
  previewButton.type = 'button';
  previewButton.onclick = () => guarded(preview);
  const applyButton = elt('button', 'secondary', '套用到新副本');
  applyButton.id = 'cp-p3-apply'; applyButton.disabled = true;
  applyButton.type = 'button';
  applyButton.onclick = () => guarded(apply);
  row.append(previewButton, applyButton);
  const message = elt('p', 'muted small', '尚未載入 P3 審核 JSON');
  message.id = 'cp-p3-status'; message.setAttribute('aria-live', 'polite');
  const notes = elt('div', 'cp-p3-notes'); notes.id = 'cp-p3-notes';
  panel.append(input, row, message, notes);
  $('cp-assets-panel').append(panel);
}
