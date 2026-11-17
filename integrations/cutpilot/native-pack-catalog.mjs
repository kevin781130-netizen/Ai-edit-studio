// CutPilot native packs v1: metadata and existing Studio edit operations only.
// No third-party media, music, fonts, scraped templates, or downloaded binary assets.
import { TRANSITIONS } from '../../public/edit-ops.js';

const transitions = [
  ['tr-fade', '柔和溶解', 'fade', .45],
  ['tr-black', '電影黑場', 'fadeblack', .5],
  ['tr-white', '白閃轉場', 'fadewhite', .3],
  ['tr-wipe', '水平擦除', 'wipeleft', .35],
  ['tr-slide', '動態滑入', 'slideleft', .4],
  ['tr-circle', '圓形揭露', 'circleopen', .5],
  ['tr-pixel', '像素化', 'pixelize', .4],
  ['tr-radial', '旋轉揭露', 'radial', .5],
];
const captions = [
  ['cap-karaoke', '卡拉 OK 跟字', 'karaoke', 'bold', 'low'],
  ['cap-pop', '彈跳字幕', 'pop', 'bold', 'middle'],
  ['cap-highlight', '重點字標記', 'highlight', 'box', 'low'],
  ['cap-words', '逐字呈現', 'words', 'minimal', 'middle'],
];
const stickers = [
  ['text-star', '★ 重點星標', '★ 精彩片段', 'callout', 'left-high'],
  ['text-follow', '▶ 訂閱提醒', '▶ 追蹤更多', 'callout', 'left-low'],
  ['text-check', '✓ 重點摘要', '✓ 今日重點', 'note', 'left-low'],
  ['text-flash', '⚡ 亮點標記', '⚡ 必看亮點', 'big', 'center'],
];
const styles = [
  ['style-reels', '短影音高對比', { look: 'vivid', lookStrength: .6, captionStyle: 'bold', captionAnimation: 'pop', captionPosition: 'middle', exportVertical: true }],
  ['style-cinema', '電影質感', { look: 'cinema', lookStrength: .65, captionStyle: 'minimal', captionAnimation: 'none', captionPosition: 'low' }],
  ['style-devlog', '自然紀錄', { look: 'neutral', lookStrength: 0, captionStyle: 'box', captionAnimation: 'highlight', captionPosition: 'low' }],
];
export const NATIVE_PACKS = Object.freeze([
  ...transitions.map(([id, name, transition, seconds]) => ({
    id, kind: 'transition', name, description: '既有 FFmpeg 轉場，不更換素材', license: 'Studio MIT', transition, seconds,
  })),
  ...captions.map(([id, name, animation, style, position]) => ({
    id, kind: 'caption', name, description: '現有字幕樣式，不自動生成內容', license: 'Studio MIT', animation, style, position,
  })),
  ...stickers.map(([id, name, text, style, position]) => ({
    id, kind: 'text-sticker', name, description: '原生文字標記，非第三方圖片貼紙', license: 'Original text / Studio MIT', text, style, position,
  })),
  ...styles.map(([id, name, options]) => ({
    id, kind: 'look-template', name, description: '原生剪輯外觀預設', license: 'Studio MIT', options,
  })),
]);
const lookup = new Map(NATIVE_PACKS.map(x => [x.id, x]));

export function listNativePacks({ kind = 'all', query = '' } = {}) {
  if (!['all', 'transition', 'caption', 'text-sticker', 'look-template'].includes(kind)) {
    throw new TypeError('Unsupported preset category.');
  }
  if (typeof query !== 'string' || query.length > 100) throw new TypeError('Query too long.');
  const q = query.toLowerCase().trim();
  return NATIVE_PACKS.filter(x =>
    (kind === 'all' || x.kind === kind) &&
    (x.name + ' ' + x.description + ' ' + x.id).toLowerCase().includes(q)
  ).map(({ id, kind: k, name, description, license }) => ({ id, kind: k, name, description, license }));
}
export function buildNativePackOperations(id, project) {
  const pack = lookup.get(id);
  if (!pack) throw new TypeError('Unknown native pack.');
  const clips = project?.plan?.clips;
  if (!Array.isArray(clips) || clips.length < 1) throw new TypeError('Save at least one clip before applying packs.');
  if (pack.kind === 'transition') {
    if (clips.length < 2) throw new TypeError('Transitions need at least two clips.');
    if (!Object.hasOwn(TRANSITIONS, pack.transition)) throw new TypeError('Studio transition no longer supported.');
    return clips.slice(1).map(c => ({ op: 'set', clip: c.id, transition: pack.transition, transitionSeconds: pack.seconds }));
  }
  if (pack.kind === 'caption') {
    return [{ op: 'set_options', options: { captionAnimation: pack.animation,
      captionStyle: pack.style, captionPosition: pack.position } }];
  }
  if (pack.kind === 'text-sticker') {
    const seconds = Number(project.plan.actualDuration);
    if (!Number.isFinite(seconds) || seconds < .5) throw new TypeError('Invalid saved timeline.');
    return [{ op: 'add_text', text: pack.text, style: pack.style, position: pack.position, start: 0, end: Math.min(seconds, 3) }];
  }
  if (pack.kind === 'look-template') return [{ op: 'set_options', options: { ...pack.options } }];
  throw new TypeError('Unsupported preset kind.');
}
