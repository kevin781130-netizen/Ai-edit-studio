// Existing Studio-native effect presets. No third-party binary asset downloads.
const node = (tag, cls, text) => {
  const result = document.createElement(tag);
  if (cls) result.className = cls;
  if (text !== undefined) result.textContent = text;
  return result;
};
const select = (choices) => {
  const el = node('select');
  for (const [value, label] of choices) {
    const option = node('option', '', label);
    option.value = value; el.append(option);
  }
  return el;
};
const types = [
  ['all', '全部預設'], ['transition', '轉場'], ['caption', '字幕動畫'],
  ['text-sticker', '文字貼紙'], ['look-template', '風格模板'],
];
let context;
let catalog = [];
let selection = '';
let busy = false;

function status(message) {
  const slot = document.getElementById('cp-packs-status');
  if (slot) slot.textContent = message;
}
function current() {
  const project = context?.state?.project;
  if (!project?.id || !Number.isInteger(project.revision)) {
    throw new Error('請先開啟一個已有剪輯片段的 Studio 專案');
  }
  if (context.state.dirty || context.state.pending) {
    throw new Error('請先儲存目前的剪輯修改，再預覽或套用預設');
  }
  return { projectId: project.id, revision: project.revision };
}
async function action(run) {
  if (busy) return;
  busy = true;
  try { await run(); }
  catch (error) { status(error.message); context?.toast?.(error.message); }
  finally { busy = false; }
}
function render() {
  const results = document.getElementById('cp-packs-results');
  if (!results) return;
  const type = document.getElementById('cp-packs-filter').value;
  const query = document.getElementById('cp-packs-query').value.toLowerCase().trim();
  const visible = catalog.filter(p =>
    (type === 'all' || p.kind === type) &&
    (p.name + ' ' + p.description).toLowerCase().includes(query)
  );
  results.replaceChildren();
  if (!visible.length) {
    results.append(node('p', 'muted small', '沒有相符預設'));
    return;
  }
  for (const preset of visible) {
    const card = node('article', 'cp-asset-card cp-native-pack');
    const body = node('div', 'cp-asset-body');
    body.append(node('strong', 'cp-asset-title', preset.name),
      node('small', 'muted', preset.description),
      node('small', 'muted', '內建 · ' + preset.license));
    const row = node('div', 'cp-asset-actions');
    const preview = node('button', 'secondary', '試看效果');
    preview.type = 'button';
    preview.onclick = () => action(async () => {
      const result = await context.api('/api/cutpilot/packs/preview', 'POST',
        { ...current(), packId: preset.id });
      selection = preset.id;
      const review = result.review?.score;
      status('唯讀預覽：' + (result.diff?.summary || preset.name) +
        (review == null ? '' : ' · QC ' + review) + ' · 原作品未變更');
    });
    const apply = node('button', 'secondary', '套用到副本');
    apply.type = 'button';
    apply.onclick = () => action(async () => {
      const result = await context.api('/api/cutpilot/packs/apply', 'POST',
        { ...current(), packId: preset.id });
      if (result.status !== 'APPLIED_TO_NEW_COPY') throw new Error('未確認副本套用結果');
      status('預設已套用到獨立副本；原專案維持不變');
      await context.openProject(result.projectId);
    });
    row.append(preview, apply); body.append(row);
    card.append(node('div', 'cp-asset-thumb', 'FX'), body);
    results.append(card);
  }
}
export function mountNativePacks(ctx) {
  if (document.getElementById('cp-native-packs')) return;
  const host = document.getElementById('cp-assets-panel');
  if (!host) return;
  context = ctx;
  const panel = node('section', 'cp-native-packs');
  panel.id = 'cp-native-packs';
  panel.append(node('h5', '', '內建特效包 · Native Packs'),
    node('p', 'help', '使用 Studio 既有 MIT 特效：轉場、字幕動畫、文字貼紙與風格預設。套用只改新副本。'));
  const query = node('input'); query.id = 'cp-packs-query';
  query.type = 'search'; query.placeholder = '搜尋內建效果'; query.maxLength = 100;
  query.oninput = render;
  const filter = select(types); filter.id = 'cp-packs-filter';
  filter.onchange = render;
  panel.append(query, filter);
  const message = node('p', 'muted small');
  message.id = 'cp-packs-status'; message.setAttribute('aria-live', 'polite');
  const results = node('div', 'cp-asset-results');
  results.id = 'cp-packs-results';
  panel.append(message, results);
  host.append(panel);
  status('讀取內建預設中…');
  ctx.api('/api/cutpilot/packs').then(result => {
    if (!Array.isArray(result.packs)) throw new Error('預設包格式不正確');
    catalog = result.packs;
    status('已載入 ' + catalog.length + ' 款內建預設，無須下載素材');
    render();
  }).catch(error => status('預設包暫時不可用：' + error.message));
}
