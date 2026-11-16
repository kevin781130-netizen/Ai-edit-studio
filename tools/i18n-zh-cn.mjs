#!/usr/bin/env node
// Maintainer tool (not used at runtime): regenerate public/i18n.zh-CN.js from public/i18n.zh-TW.js.
// Converts Taiwan Traditional Chinese to mainland Simplified Chinese with OpenCC (tw2sp, phrase level),
// then applies the video-editing terminology below. Needs Python with `pip install opencc` (only here).
//   node tools/i18n-zh-cn.mjs            (python from OPENCC_PYTHON, else `py -3.11` on Windows / python3)
// After an upstream update: add the new English keys to i18n.zh-TW.js first, run this, review the diff.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TW = path.join(ROOT, 'public', 'i18n.zh-TW.js');
const CN = path.join(ROOT, 'public', 'i18n.zh-CN.js');

// Mainland editing terms after OpenCC (order matters: longer phrases first).
export const CN_TERMS = [
  ['AI 代理', 'AI 智能体'], ['代理档', '代理文件'], ['影格速率', '帧率'], ['影格', '帧'], ['时间轴', '时间线'],
  ['播放指针', '播放头'], ['子母画面', '画中画'], ['逐字稿', '文字稿'], ['缺省', '默认'], ['预设', '默认'],
  ['侦测', '检测'], ['品质', '质量'], ['连线', '连接'], ['本机', '本地'], ['相依套件', '依赖包'], ['执行档', '可执行文件'],
  ['金钥', '密钥'], ['逾时', '超时'], ['动态贴文', '信息流帖子'], ['贴文', '帖子'], ['萤光笔', '荧光笔'], ['按两下', '双击'],
  ['分页', '标签页'], ['撷取', '采集'], ['短影音', '短视频'], ['前导预告', '预告片'], ['Podcast', '播客'], ['复原', '撤销'],
  ['讯息', '消息'], ['拷贝', '复制'], ['标示', '标记'], ['套用', '应用'], ['选取', '选中'], ['用户端', '客户端'], ['纪录', '记录'], ['产生', '生成'], ['社群', '社交'], ['直式', '竖屏'], ['变更', '更改'], ['字库', '字体文件'], ['点数', '额度'], ['忙碌中', '繁忙'], ['资料夹', '文件夹'], ['资料', '数据'], ['储存', '保存'], ['支援', '支持'], ['档案', '文件'],
  ['萤幕', '屏幕'], ['网路', '网络'], ['程式', '程序'], ['影片', '视频'], ['音讯', '音频'], ['伺服器', '服务器'],
];
export function applyTerms(text) { return CN_TERMS.reduce((s, [a, b]) => s.split(a).join(b), text); }

function python() {
  if (process.env.OPENCC_PYTHON) return [process.env.OPENCC_PYTHON, []];
  return process.platform === 'win32' ? ['py', ['-3.11']] : ['python3', []];
}

async function convertFile(src, out, from) {
  const tw = (await import(pathToFileURL(src).href)).default;
  const codesIn = tw.codes ?? {};
  const strings = [...Object.values(tw.dict), ...tw.patterns.map(([, s]) => s), ...Object.values(codesIn)];
  const [cmd, pre] = python();
  const code = 'import sys,json,opencc\nc=opencc.OpenCC("tw2sp")\nd=json.load(sys.stdin)\nsys.stdout.write(json.dumps([c.convert(x) for x in d],ensure_ascii=False))';
  const run = spawnSync(cmd, [...pre, '-c', code], { input: JSON.stringify(strings), encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(`OpenCC conversion failed (pip install opencc): ${run.stderr || run.error?.message}`);
  const converted = JSON.parse(run.stdout).map(applyTerms);
  let i = 0;
  const dict = Object.fromEntries(Object.keys(tw.dict).map(k => [k, converted[i++]]));
  const patterns = tw.patterns.map(([re]) => [re, converted[i++]]);
  const codes = Object.fromEntries(Object.keys(codesIn).map(k => [k, converted[i++]]));
  const q = s => JSON.stringify(s);
  const body = [
    `// 简体中文（中国）字典 — 由 tools/i18n-zh-cn.mjs 从 ${from} 生成（OpenCC tw2sp + 剪辑术语），已人工校对。`,
    `// 请勿直接修改：先改 ${from}，再运行 \`node tools/i18n-zh-cn.mjs\`。`,
    'const dict = {',
    ...Object.entries(dict).map(([k, v]) => ` ${q(k)}: ${q(v)},`),
    '};',
    '',
    'const patterns = [',
    ...patterns.map(([re, s]) => ` [${re.toString()}, ${q(s)}],`),
    '];',
    '',
    ...(tw.codes ? ['const codes = {', ...Object.entries(codes).map(([k, v]) => ` ${k}: ${q(v)},`), '};', '',
      "export default { lang: 'zh-CN', dict, patterns, codes };"] : ["export default { lang: 'zh-CN', dict, patterns };"]),
    '',
  ].join('\n');
  fs.writeFileSync(out, body, 'utf8');
  console.log(`${path.basename(out)} written: ${Object.keys(dict).length} strings, ${patterns.length} patterns, ${Object.keys(codes).length} codes`);
}

async function main() {
  await convertFile(TW, CN, 'i18n.zh-TW.js');
  await convertFile(path.join(ROOT, 'public', 'page-i18n.zh-TW.js'), path.join(ROOT, 'public', 'page-i18n.zh-CN.js'), 'page-i18n.zh-TW.js');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e.message); process.exitCode = 1; });
}
