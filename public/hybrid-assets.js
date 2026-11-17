// CutPilot hybrid asset browser: search online/local, bookmark, import and open local files.
// No remote download, no change to the current editor project.
import { mountNativePacks } from './native-packs.js';
import { mountAutoPositionReview } from './autoposition-review.js';
const $ = id => document.getElementById(id);
const element = (tag, cls, value) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (value !== undefined) n.textContent = value;
  return n;
};
const state = { api: null, toast: null, openProject: null, results: [], searchId: null, busy: false };
const TYPES = [['video', '影片'], ['image', '圖片'], ['audio', '音效／音樂'], ['effect', '特效']];
const SCOPES = [['hybrid', '混合搜尋'], ['local', '本地'], ['online', '線上']];
const allowedUrl = url => typeof url === 'string' && /^https?:\/\//i.test(url);

function selector(id, choices) {
  const s = element('select'); s.id = id;
  for (const [value, label] of choices) {
    const o = element('option', '', label); o.value = value; s.append(o);
  }
  return s;
}
function announce(message) {
  const line = $('cp-assets-message');
  if (line) line.textContent = message;
}
function actions(...children) {
  const row = element('div', 'cp-asset-actions'); row.append(...children);
  return row;
}
function button(name, onclick) {
  const b = element('button', 'secondary', name); b.type = 'button';
  b.onclick = async () => {
    if (state.busy) return;
    state.busy = true;
    b.disabled = true;
    try { await onclick(); } catch (error) {
      announce(error.message);
      state.toast?.(error.message);
    } finally { state.busy = false; b.disabled = false; }
  };
  return b;
}
function sourceLink(url) {
  if (!allowedUrl(url)) return element('span', 'muted small', '來源連結未提供');
  const a = element('a', 'cp-asset-source', '查看素材來源');
  a.href = url; a.rel = 'noopener noreferrer'; a.referrerPolicy = 'no-referrer';
  a.target = '_blank'; return a;
}
function thumbnail(hit) {
  const box = element('div', 'cp-asset-thumb');
  let src = hit.preview_url;
  if (!allowedUrl(src) && hit.provider === 'local' &&
      hit.media_type === 'image' && hit.asset_id && hit.local_path) {
    src = '/api/cutpilot/assets/preview?assetId=' + encodeURIComponent(hit.asset_id);
  }
  if (src && (allowedUrl(src) || src.startsWith('/api/cutpilot/assets/'))) {
    const img = element('img');
    img.alt = hit.title || '素材預覽'; img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer'; img.src = src;
    img.onerror = () => { box.replaceChildren(element('span', '', '無法預覽')); };
    box.append(img);
  } else {
    box.append(element('span', 'muted', hit.media_type === 'video' ? 'VIDEO' :
      hit.media_type === 'audio' ? 'AUDIO' : '預覽未提供'));
  }
  return box;
}

function numberControl(label, value, min, max, step = .1) {
  const wrapper = element('label', 'cp-time-control', label);
  const input = element('input');
  input.type = 'number'; input.min = String(min); input.max = String(max);
  input.step = String(step); input.value = String(value);
  wrapper.append(input);
  return { wrapper, input };
}
async function placeInCopy(hit, kind, parameters) {
  const project = state.projectState?.project;
  if (!project?.id || !Number.isInteger(project.revision)) {
    throw new Error('先開啟並儲存一個已有時間軸的 Studio 專案');
  }
  if (state.projectState.dirty || state.projectState.pending) {
    throw new Error('先儲存目前未提交的時間軸修改');
  }
  const description = kind === 'sticker' ? 'PNG 疊加貼紙' : '單一音效（占用旁白音軌）';
  if (!window.confirm('確認有此素材的使用權？將把 ' + description +
    ' 放入新的專案副本，原專案不變。')) return;
  const response = await state.api('/api/cutpilot/assets/place', 'POST', {
    projectId: project.id, revision: project.revision, assetId: hit.asset_id,
    kind, confirmRights: true, ...parameters,
  });
  if (response.status !== 'APPLIED_TO_NEW_COPY') throw new Error('副本建立結果未確認');
  announce('已建立新副本並定位素材，原始專案未變更');
  await state.openProject(response.projectId);
}
function placementControls(hit) {
  if (hit.provider !== 'local' || !hit.local_path || !hit.asset_id) return null;
  const row = element('div', 'cp-timed-placement');
  const at = numberControl('時間（秒）', 0, 0, 1200);
  row.append(at.wrapper);
  if (hit.media_type === 'image' && /\.png$/i.test(hit.title || '')) {
    const duration = numberControl('持續秒數', 3, .5, 10);
    const size = numberControl('畫面比例', .3, .15, .7, .05);
    const pos = selector('', [
      ['top-right', '右上'], ['top-left', '左上'], ['bottom-right', '右下'],
      ['bottom-left', '左下'], ['center', '中央'],
    ]);
    pos.removeAttribute('id');
    row.append(duration.wrapper, size.wrapper, pos,
      button('貼紙疊加到副本', () => placeInCopy(hit, 'sticker', {
        at: Number(at.input.value), seconds: Number(duration.input.value),
        size: Number(size.input.value), position: pos.value,
      })));
    return row;
  }
  if (hit.media_type === 'audio') {
    const gain = numberControl('音量', .7, 0, 1.5);
    row.append(gain.wrapper, button('定位音效到副本', () =>
      placeInCopy(hit, 'sfx', { at: Number(at.input.value), gain: Number(gain.input.value) })));
    return row;
  }
  return null;
}

function renderResults() {
  const holder = $('cp-assets-results'); if (!holder) return;
  holder.replaceChildren();
  if (!state.results.length) {
    holder.append(element('p', 'muted small', '沒有相符素材。試試其他關鍵字或切換搜尋範圍。'));
    return;
  }
  state.results.forEach((hit, index) => {
    const card = element('article', 'cp-asset-card');
    const body = element('div', 'cp-asset-body');
    body.append(element('strong', 'cp-asset-title', hit.title || hit.provider_asset_id || 'Untitled'));
    const type = hit.media_type || 'unknown';
    const description = (hit.origin === 'online' ? '線上' : '本地索引') +
      ' · ' + (hit.provider || 'unknown') + ' · ' + type;
    body.append(element('small', 'muted', description));
    if (hit.author) body.append(element('small', 'muted', '作者：' + hit.author));
    body.append(element('small', 'cp-asset-rights',
      '授權：' + (hit.license_status === 'allowed' ? '已有許可記錄' : '待人工確認') +
      (hit.license_name ? ' · ' + hit.license_name : '')));
    const controls = actions(sourceLink(hit.source_url));
    if (hit.origin === 'online') {
      controls.append(button('收藏索引', async () => {
        const output = await state.api('/api/cutpilot/assets/pin', 'POST',
          { searchId: state.searchId, index });
        state.results[index] = output.pinned;
        announce('已收藏來源與授權資料，未下載素材');
        renderResults();
      }));
    }
    if (hit.provider === 'local' && hit.local_path && ['image', 'video'].includes(type)) {
      controls.append(button('在新專案使用', async () => {
        if (!window.confirm('確認你擁有此素材的使用權？將建立新專案，不改動目前作品。')) return;
        const result = await state.api('/api/cutpilot/assets/use', 'POST',
          { assetId: hit.asset_id, confirmRights: true });
        announce('已建立新剪輯專案；原作品未變更');
        await state.openProject(result.projectId);
      }));
    } else if (hit.origin !== 'online' && !hit.local_path) {
      body.append(element('small', 'muted', '僅收藏來源；需先合法取得檔案再匯入'));
    }
    if (hit.provider === 'local' && type === 'audio' && hit.asset_id && hit.local_path) {
      const player = element('audio');
      player.controls = true; player.preload = 'none';
      player.src = '/api/cutpilot/assets/preview-audio?assetId=' +
        encodeURIComponent(hit.asset_id);
      player.setAttribute('aria-label', '試聽 ' + (hit.title || '音效'));
      body.append(player);
    }
    body.append(controls);
    const placement = placementControls(hit);
    if (placement) body.append(placement);
    card.append(thumbnail(hit), body);
    holder.append(card);
  });
}
async function search() {
  const query = $('cp-assets-query').value.trim();
  if (!query) { announce('請輸入搜尋關鍵字'); return; }
  announce('搜尋中…');
  const data = await state.api('/api/cutpilot/assets/search', 'POST', {
    query, scope: $('cp-assets-scope').value, mediaType: $('cp-assets-type').value,
    limit: 12,
  });
  state.results = data.results || [];
  state.searchId = data.searchId;
  const summaries = Object.entries(data.sources || {}).map(([k, v]) => k + ': ' + v).join(' · ');
  announce('找到 ' + state.results.length + ' 筆 · ' + summaries);
  renderResults();
}
async function importLocal() {
  const file = $('cp-assets-path').value.trim();
  if (!file) { announce('請貼上本機檔案的完整路徑'); return; }
  if (!window.confirm('確認這是你有權使用的本地素材，並複製進 CutPilot 快取？')) return;
  const result = await state.api('/api/cutpilot/assets/import', 'POST',
    { path: file, confirm: true });
  state.results.unshift(result.imported);
  announce('已匯入本地 SHA256 去重快取；未上傳外部服務');
  renderResults();
}
async function importKenneyPack() {
  const sourceId = $('cp-pack-source').value;
  const zip = $('cp-pack-path').value.trim();
  if (!zip) { announce('請貼上已下載的 Kenney ZIP 完整本地路徑'); return; }
  const names = {
    'kenney-particle-cc0': 'Kenney Particle Pack (CC0)',
    'kenney-ui-cc0': 'Kenney UI Pack (CC0)',
  };
  if (!window.confirm('確認 ZIP 來自官方 ' + names[sourceId] +
      '，且你已核對內附 CC0 授權？將只匯入本機，不會上傳或下載。')) return;
  announce('離線解析 ZIP、檢查授權及 SHA256，請勿重複按鈕…');
  const result = await state.api('/api/cutpilot/assets/pack-import', 'POST', {
    path: zip, sourceId, confirm: true,
  });
  announce('素材包已匯入：新增 ' + result.pack.imported +
    '、重複 ' + result.pack.reused + '。來源真偽仍需人工核對。');
  $('cp-assets-query').value = sourceId === 'kenney-particle-cc0' ? '粒子' : '貼紙';
  $('cp-assets-scope').value = 'local';
  $('cp-assets-type').value = 'image';
  await search();
}

export function mountHybridAssets(context) {
  if ($('cp-assets-panel')) return;
  const host = $('moments')?.parentElement;
  if (!host) return;
  state.api = context.api;
  state.toast = context.toast;
  state.openProject = context.openProject;
  state.projectState = context.state;
  const panel = element('section', 'clip-finder cp-asset-panel');
  panel.id = 'cp-assets-panel';
  panel.append(element('h4', '', '素材庫 · Hybrid Assets'));
  panel.append(element('p', 'help', '線上搜尋＋本地快取。搜尋不會自動下載；商用權利需逐項確認。'));
  const query = element('input'); query.id = 'cp-assets-query';
  query.type = 'search'; query.placeholder = '例如：cinematic, rain, overlay';
  query.maxLength = 100;
  query.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); $('cp-assets-search').click(); }
  };
  panel.append(query, selector('cp-assets-scope', SCOPES), selector('cp-assets-type', TYPES));
  const go = button('搜尋素材', search); go.id = 'cp-assets-search';
  panel.append(actions(go));
  const local = element('input'); local.id = 'cp-assets-path';
  local.placeholder = '本地檔案絕對路徑（.mp4 / .png / .wav…）';
  panel.append(element('h5', '', '匯入自己的素材'), local,
    actions(button('匯入本地', importLocal)));
  const sources = selector('cp-pack-source', [
    ['kenney-particle-cc0', 'Kenney 粒子包 · CC0'],
    ['kenney-ui-cc0', 'Kenney UI 貼紙素材 · CC0'],
  ]);
  sources.id = 'cp-pack-source';
  const zip = element('input');
  zip.id = 'cp-pack-path';
  zip.placeholder = '已下載 ZIP 的絕對路徑（不會連網下載）';
  const official = element('div', 'cp-pack-official');
  const a = element('a', 'cp-asset-source', 'Kenney Particle Pack 官方下載');
  a.href = 'https://kenney.nl/assets/particle-pack'; a.target = '_blank';
  a.rel = 'noopener noreferrer';
  const b = element('a', 'cp-asset-source', 'Kenney UI Pack 官方下載');
  b.href = 'https://kenney.nl/assets/ui-pack'; b.target = '_blank';
  b.rel = 'noopener noreferrer';
  official.append(a, b);
  panel.append(element('h5', '', 'CC0 素材包匯入'), sources, zip, official,
    actions(button('匯入 Kenney ZIP（離線）', importKenneyPack)),
    element('p', 'help', '需要官方 ZIP 內含 CC0 授權文件。僅支援本機檔案；音效可試聽，尚不能直接放入 SFX 時間軸。'));
  const message = element('p', 'muted small'); message.id = 'cp-assets-message';
  message.setAttribute('aria-live', 'polite');
  const results = element('div', 'cp-asset-results'); results.id = 'cp-assets-results';
  panel.append(message, results);
  host.append(panel);
  mountNativePacks(context);
  mountAutoPositionReview(context);
}
