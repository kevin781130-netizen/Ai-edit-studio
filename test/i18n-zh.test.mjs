// Traditional Chinese (zh-TW) and Simplified Chinese (zh-CN) interface: language choice, completeness
// against every English UI string (NL keys, t() calls, index.html, CutPilot panel), runtime messages,
// error codes, placeholders and script purity (no simplified characters in zh-TW and vice versa).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

async function i18nAs(saved) {
  globalThis.localStorage = { getItem: () => saved, setItem() {} };
  const mod = await import(`${pathToFileURL(path.join(PUB, 'i18n.js')).href}?lang=${saved}`);
  delete globalThis.localStorage;
  return mod;
}
const TW = (await import(pathToFileURL(path.join(PUB, 'i18n.zh-TW.js')).href)).default;
const CN = (await import(pathToFileURL(path.join(PUB, 'i18n.zh-CN.js')).href)).default;
const base = await i18nAs('en');
const { NL_EXTRA } = await import(pathToFileURL(path.join(PUB, 'i18n.nl-extra.js')).href);

// Characters that exist only in one script (derived once with OpenCC; shared characters removed).
const TRAD_ONLY = '並佇併來個們側偵備傳僅優儲內兩凍刪則創劃勁動務匯區卻參問啓啟單嗎嘗嘯圍圓圖執場夢夾奮實審寫寬將專尋對導層屬峯師帳幀幫幾廣強彈後徑從復態應戲戶採換搖撥擁擇擊擴擷擺攝敗數斷於時暢暫曉會條棄構樂標樣機檔檢權歷沒淨減測準溫滿潛濾瀏為無熒營爲狀現環產畫疊發監盤眾確碼種稱穩筆節範簡籤籲紀約紅紋紙級細終組結絕絡給統綁經綱網緊緒線緣編緩緻縮總繼續羣義聞聲職聽脈腦腳膠臉臨臺與興舊蘭處號螢衆衝裏補裝裡製複規視親覽觀計訊記訪設許註評詞試詩話該誌認語誤說調談請證識議讀變讓豎豔貝負責貼資質賴贅蹤躍軌軟軸較載輕輯輸轉轟這連進遊運過達遠適選還邊針鈴鉤銅銳銷鋪鋼錄錯鍵鍾鎖鏈鏡鐘鑰長門閃閉開間閱關陳隊隨雙雜離雲電靜響頁項順須預頑頓頭頻題額願類顯風飽餘馬驗驟體鬆鮮鳴麗麼點齊齒';
const SIMP_ONLY = '与专两个临为丽么义乐于产亲仅从们众优会传伫体侦侧储兰关兴内写冲冻净减击划则创删务动劲区单却历参双发变叠号吁吗听启响啸围图圆场声处备复头夹奋实审宽对寻导将尝层属师帐帧帮广应开弃弹强录径态总愿戏户执扩拥拨择换摄摆摇撷数断无旧时显晓暂机杂权条来构标样档梦检汇没测浏温满滤潜点状环现电画畅监盘码确离种称稳竖笔签简类紧红约级纪纲纸纹线组细终经绑结给络绝统继绪续缓编缘缩网职胶脉脑脚脸艳节范荧萤营补装观规视览计认让议讯记许设访证评识词试诗话该语误说请读调谈贝负责败质贴资赖赘跃踪轨转软轰轴轻载较辑输边达过运还这进远连适选针钟钢钥钩铃铜铺链销锁锐错键镜长门闪闭问间闻阅队陈随静页项顺须顽顿预频题额风饱马验骤鲜鸣齐齿';
const values = d => [...Object.values(d.dict), ...d.patterns.map(p => p[1]), ...Object.values(d.codes)];
const placeholders = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');

function uiKeys() {
  const keys = new Set([...Object.keys(base.NL), ...Object.keys(NL_EXTRA)]);
  for (const f of fs.readdirSync(PUB).filter(f => f.endsWith('.js') && !f.startsWith('i18n'))) {
    const src = fs.readFileSync(path.join(PUB, f), 'utf8');
    for (const m of src.matchAll(/\bt\(\s*'((?:\\.|[^'\\])*)'/g)) keys.add(m[1].replace(/\\'/g, "'").replace(/\\n/g, '\n'));
    for (const m of src.matchAll(/\bt\(\s*"((?:\\.|[^"\\])*)"/g)) keys.add(JSON.parse(`"${m[1]}"`));
  }
  return keys;
}

test('language choice: four languages, saved choice wins, browser zh-TW/zh-HK → 繁體, zh-CN/zh → 简体', () => {
  const { detectLanguage, LANGUAGES } = base;
  assert.deepEqual(LANGUAGES, ['en', 'nl', 'zh-TW', 'zh-CN']);
  assert.equal(detectLanguage('zh-CN', ['zh-TW']), 'zh-CN', 'a saved choice survives a reload');
  assert.equal(detectLanguage(null, ['zh-TW']), 'zh-TW');
  assert.equal(detectLanguage(null, ['zh-HK']), 'zh-TW');
  assert.equal(detectLanguage(null, ['zh-Hant-TW']), 'zh-TW');
  assert.equal(detectLanguage(null, ['zh-CN']), 'zh-CN');
  assert.equal(detectLanguage(null, ['zh']), 'zh-CN');
  assert.equal(detectLanguage(null, ['nl-BE']), 'nl');
  assert.equal(detectLanguage('xx', ['fr-FR', 'en-US']), 'en');
  assert.equal(detectLanguage(null, []), 'en');
  const html = read('public/index.html');
  assert.match(html, /<select id="lang"[^>]*data-no-i18n[^>]*>.*value="en">English<.*value="nl">Nederlands<.*value="zh-TW">繁體中文（台灣）<.*value="zh-CN">简体中文（中国）</);
  assert.match(read('public/studio.js'), /localStorage\.setItem\('studio-lang', \$\('lang'\)\.value\)/, 'choice is remembered');
  assert.match(read('public/studio.js'), /\$\('lang'\)\.value = LANG;/);
});

test('zh-TW and zh-CN translate every English interface string (no silent English fallback)', () => {
  const keys = uiKeys();
  assert.ok(keys.size > 950, `expected the full UI, got ${keys.size} keys`);
  for (const [name, d] of [['zh-TW', TW], ['zh-CN', CN]]) {
    const missing = [...keys].filter(k => !Object.hasOwn(d.dict, k));
    assert.deepEqual(missing, [], `${name} misses ${missing.length} strings`);
    const empty = Object.entries(d.dict).filter(([, v]) => typeof v !== 'string' || !v.trim()).map(([k]) => k);
    assert.deepEqual(empty, [], `${name} has empty values`);
    const brokenVars = Object.entries(d.dict).filter(([k, v]) => placeholders(k) !== placeholders(v)).map(([k]) => k);
    assert.deepEqual(brokenVars, [], `${name} placeholders differ`);
  }
  assert.deepEqual(Object.keys(TW.dict).sort(), Object.keys(CN.dict).sort(), 'both dictionaries have the same keys');
  // Upstream's renamed placeholder (#156) is covered before and after a merge.
  for (const k of ['e.g. PRE-ALPHA FOOTAGE', 'e.g. WORK IN PROGRESS']) assert.ok(TW.dict[k] && CN.dict[k]);
});

test('static index.html text, placeholders and tooltips are covered', () => {
  let html = read('public/index.html').replace(/<(script|style|pre|code|kbd|textarea)\b[\s\S]*?<\/\1>/gi, '').replace(/<select id="lang"[\s\S]*?<\/select>/, '');
  const decode = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const found = new Set();
  for (const m of html.matchAll(/>([^<]+)</g)) { const k = decode(m[1].trim().replace(/\s+/g, ' ')); if (/[A-Za-z]{3}/.test(k)) found.add(k); }
  for (const m of html.matchAll(/\s(?:placeholder|title|aria-label|alt)="([^"]*)"/g)) if (/[A-Za-z]{3}/.test(m[1])) found.add(decode(m[1]));
  // Technical tokens and keyboard notation stay as written in every language.
  const keep = /^(AI EDIT|STUDIO|TikTok|Reels|Shorts|YouTube|LinkedIn|Steam|Claude Code|HTTP \/ OpenAPI|EDL|FCPXML|OTIO|CSV|SRT|VTT|PNG\/JPG|TTF\/OTF|indiegame, gamedev|xi-…|Home( End)?|Shift .*|\+ \/ − \/ Shift\+Z|Ctrl .*|Alt .*|\d+p · \d+ fps|4K · 60 fps|Feed 4:5|J ← → L)$/;
  const missing = [...found].filter(k => !keep.test(k) && !Object.hasOwn(TW.dict, k) && !Object.hasOwn(TW.dict, k.replace(/ \.$/, '')));
  // Text split by <kbd> elements is translated per fragment (each fragment is a key); only report whole leftovers.
  const fragments = missing.filter(k => !/\b(Set|Tip:|cuts at the playhead)\b/.test(k));
  assert.deepEqual(fragments, [], 'index.html strings without a Chinese translation');
});

test('runtime messages (status, review, edit errors, QC, CutPilot) and every error code are localized', async () => {
  const codes = new Set();
  for (const dir of ['src', 'integrations/cutpilot']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir), { recursive: true }).filter(f => /\.mjs$/.test(f) && !/\.test\./.test(f))) {
      const src = fs.readFileSync(path.join(ROOT, dir, f), 'utf8');
      for (const m of src.matchAll(/(?:StudioError|fail|check\([^,]+,)\(?\s*'([A-Z][A-Z0-9_]{2,})'/g)) codes.add(m[1]);
      for (const m of src.matchAll(/new StudioError\('([A-Z][A-Z0-9_]+)'/g)) codes.add(m[1]);
      for (const m of src.matchAll(/\bcode: '([A-Z][A-Z0-9_]{2,})'/g)) codes.add(m[1]);
    }
  }
  assert.ok(codes.size > 120, `found ${codes.size} codes`);
  for (const d of [TW, CN]) assert.deepEqual([...codes].filter(c => !Object.hasOwn(d.codes, c)).sort(), [], `${d.lang} error codes`);

  const literal = new Set();
  const grab = (f, re) => { for (const m of read(f).matchAll(re)) literal.add(m[1]); };
  for (const f of fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.mjs'))) grab(`src/${f}`, /\.?message(?:: | = )'([^'$]{4,})'/g);
  grab('public/insights.js', /add\('[a-z]+', '[A-Z_]+', '([^']+)'/g);
  grab('public/insights.js', /label: '([^']+)'/g);
  grab('public/edit-ops.js', /EditError\('([^']+)'/g);
  grab('integrations/cutpilot/studio-route.mjs', /(?:fail|check)\([^']*'[A-Z_]+', '([^']+)'/g);
  const samples = [
    '2 added · 1 removed · settings: music', 'Rendering preview (1/2)', 'Render queued (2 in line).', 'Auto-edit ready: 12 shots, 58.2 s, review 84/100.',
    'Cuts are on average 120 ms off the beat.', 'Shot 3 lasts 0.25 s — viewers see this as a flash.', 'Loudness is -18.2 LUFS; target -14 LUFS.',
    'Peak -0.3 dBFS: risk of clipping after platform encoding (aim ≤ −1).', 'Silence 3.0–6.5 s.', 'Transcribing talk.mp4 (1/2)',
    'File not found: D:\\video.mp4', 'CutPilot clip 5 lies outside the source video.', 'Analysis: scenes · source.mp4',
    '🤖 claude → rev 12: 3 added', 'Weak opening (hook score 41/100): the first 3 seconds have less motion/sound than the rest.',
  ];
  for (const lang of ['zh-TW', 'zh-CN']) {
    const { tm, t, LANG, MISSING } = await i18nAs(lang);
    assert.equal(LANG, lang);
    const english = [...literal, ...samples].filter(s => { const out = tm(s); return !/[\u4e00-\u9fff]/.test(out); });
    assert.deepEqual(english, [], `${lang} leaves runtime messages in English`);
    assert.match(tm('Some message we never saw', 'PROJECT_NOT_FOUND'), /[\u4e00-\u9fff]/, 'unknown text falls back to its error code');
    assert.match(t('✦ CutPilot AI clip selection'), lang === 'zh-TW' ? /選片/ : /选片/);
    t('A string nobody translated'); assert.ok(MISSING.has('A string nobody translated'), 'missing keys are reported, not silent');
  }
});

test('script purity: zh-TW has no simplified-only characters and zh-CN no traditional-only ones', () => {
  const hit = (list, chars) => [...new Set(list.join(''))].filter(c => chars.includes(c)).join('');
  assert.equal(hit(values(TW), SIMP_ONLY), '', 'simplified characters in zh-TW');
  assert.equal(hit(values(CN), TRAD_ONLY), '', 'traditional characters in zh-CN');
  // Mainland and Taiwan editing vocabulary, not just a character swap.
  assert.equal(TW.dict.Timeline, '時間軸'); assert.equal(CN.dict.Timeline, '时间线');
  assert.equal(TW.dict.Export, '匯出'); assert.equal(CN.dict.Export, '导出');
  assert.equal(TW.dict['Projects'], '專案'); assert.equal(CN.dict['Projects'], '项目');
  assert.match(TW.dict['Copy'], /複製/); assert.equal(CN.dict['Copy'], '复制');
  for (const brand of ['CutPilot', 'LUT', 'MCP', 'B-roll']) assert.ok(values(TW).some(v => v.includes(brand)) && values(CN).some(v => v.includes(brand)), `${brand} kept`);
});

test('CutPilot panel strings exist in all four languages; Chinese system fonts, nothing downloaded', () => {
  const panel = read('public/cutpilot.js');
  const keys = [...panel.matchAll(/\bt\('((?:\\.|[^'\\])*)'/g)].map(m => m[1]);
  const modes = [...panel.matchAll(/\['(?:visual|speech)', '([^']+)'\]/g)].map(m => m[1]);
  assert.ok(keys.length > 30 && modes.length === 2);
  for (const k of [...keys, ...modes]) {
    assert.ok(Object.hasOwn(NL_EXTRA, k) || Object.hasOwn(base.NL, k), `NL: ${k}`);
    assert.ok(Object.hasOwn(TW.dict, k) && Object.hasOwn(CN.dict, k), `zh: ${k}`);
  }
  const css = read('public/i18n-cjk.css');
  for (const f of ['Microsoft JhengHei', 'Noto Sans TC', 'PingFang TC', 'Microsoft YaHei', 'Noto Sans SC', 'PingFang SC']) assert.ok(css.includes(f), f);
  assert.doesNotMatch(css, /@import|url\(/, 'no external font download');
  assert.match(read('public/i18n.js'), /i18n-cjk\.css/);
});

test('dynamic interface values (looks, caption styles, templates, platforms, transitions, layers) are translated', async () => {
  const imp = f => import(pathToFileURL(path.join(ROOT, f)).href);
  const vals = new Set();
  const add = v => { if (typeof v === 'string' && /[A-Za-z]{2}/.test(v)) vals.add(v); };
  for (const m of read('public/studio.js').matchAll(/(?:LOOK_NAMES|CAPTION_NAMES) = (\{[^\n]+\});/g)) for (const [a, b] of Object.values(Function(`return ${m[1]}`)())) { add(a); add(b); }
  const ops = await imp('public/edit-ops.js');
  for (const o of [ops.TRANSITIONS, ops.OVERLAY_MODES, ops.OVERLAY_POSITIONS]) for (const v of Object.values(o)) add(typeof v === 'string' ? v : v?.name ?? v?.label);
  for (const t of (await imp('src/templates.mjs')).TEMPLATES) { add(t.name); add(t.tagline); add(t.description); }
  for (const p of Object.values((await imp('src/autoedit.mjs')).PLATFORMS)) add(p.name);
  assert.ok(vals.size > 30, `found ${vals.size} dynamic values`);
  for (const d of [TW, CN]) assert.deepEqual([...vals].filter(v => !Object.hasOwn(d.dict, v)), [], `${d.lang} dynamic values`);
  const { tm } = await i18nAs('zh-TW');
  assert.equal(tm('Visual highlight 02:42'), '畫面亮點 02:42');
  assert.equal(tm('Move shot 2 to the front'), '將鏡頭 2 移到最前面');
});

test('launch.html and legacy.html (Dutch-only pages) are fully translated to zh-TW and zh-CN', async () => {
  const PTW = (await import(pathToFileURL(path.join(PUB, 'page-i18n.zh-TW.js')).href)).default;
  const PCN = (await import(pathToFileURL(path.join(PUB, 'page-i18n.zh-CN.js')).href)).default;
  const decode = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  const found = new Set();
  for (const f of ['public/launch.html', 'public/legacy.html']) {
    const html = read(f);
    assert.match(html, /<script src="page-i18n\.js" defer><\/script>/, `${f} loads the page translator`);
    // <code> splits a sentence into separate text nodes in the DOM; keep the split (each fragment is a key).
    const body = html.replace(/<(script|style|pre|kbd)\b[\s\S]*?<\/\1>/gi, '').replace(/<code>[\s\S]*?<\/code>/gi, '<i></i>').replace(/<!--[\s\S]*?-->/g, '');
    for (const m of body.matchAll(/>([^<]+)</g)) { const k = decode(m[1].trim().replace(/\s+/g, ' ')); if (/[A-Za-zë]{2}/.test(k)) found.add(k); }
    for (const m of body.matchAll(/\s(?:placeholder|title|aria-label|alt|content)="([^"]*)"/g)) if (/[a-z]{3} [a-z]/i.test(m[1])) found.add(decode(m[1]));
  }
  const app = read('public/app.js');
  for (const m of app.matchAll(/"([A-Z][a-zë][^"\n]*)"/g)) if (!/^(AbortError|Accept|Content-Type)$/.test(m[1])) found.add(m[1]);
  for (const m of app.matchAll(/:\s*"([A-Z][a-zë]+)",?$/gm)) found.add(m[1]);
  const keep = /^(AI EDIT|STUDIO|AI Edit Studio|GTS|FAQ|Live|Backend|MCP · HTTP · OpenAPI · CLI|♫ 128 BPM|\d+ fps|width=device-width.*|dark)$/;
  const translated = (d, k) => Object.hasOwn(d.dict, k) || d.patterns.some(([re]) => re.test(k));
  for (const d of [PTW, PCN]) {
    const missing = [...found].filter(k => !keep.test(k) && !translated(d, k));
    assert.deepEqual(missing, [], `${d.lang} page strings`);
  }
  assert.ok(found.size > 180, `found ${found.size} page strings`);
  const all = d => [...Object.values(d.dict), ...d.patterns.map(p => p[1])].join('');
  assert.equal([...new Set(all(PTW))].filter(c => SIMP_ONLY.includes(c)).join(''), '');
  assert.equal([...new Set(all(PCN))].filter(c => TRAD_ONLY.includes(c)).join(''), '');
});
