// Chinese for the standalone pages (launch.html product page, legacy.html recording console). Those pages are
// written in Dutch and have no i18n of their own; this script translates their static and dynamically inserted
// text (MutationObserver) without changing the pages' code. Same language choice as the editor ('studio-lang').
(() => {
  const LANGS = ['en', 'nl', 'zh-TW', 'zh-CN'];
  let lang = null;
  try { lang = localStorage.getItem('studio-lang'); } catch { /* storage may be blocked */ }
  if (!LANGS.includes(lang)) {
    lang = 'nl';
    for (const raw of [...(navigator.languages ?? []), navigator.language]) {
      const tag = String(raw || '').toLowerCase();
      if (/^zh-(?:tw|hk|mo)|^zh-hant/.test(tag)) { lang = 'zh-TW'; break; }
      if (tag.startsWith('zh')) { lang = 'zh-CN'; break; }
      if (tag) break;
    }
  }
  if (lang !== 'zh-TW' && lang !== 'zh-CN') return;
  const ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'content'];
  const SKIP = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'KBD', 'TEXTAREA']);
  import(`./page-i18n.${lang}.js`).then(({ default: { dict, patterns } }) => {
    const tr = text => {
      const key = text.trim().replace(/\s+/g, ' ');
      if (!key || !/[A-Za-zë]/.test(key)) return null;
      if (Object.hasOwn(dict, key)) return dict[key];
      for (const [re, tpl] of patterns) { const m = key.match(re); if (m) return tpl.replace(/\$(\d)/g, (_, i) => m[Number(i)] ?? ''); }
      return null;
    };
    const textNode = node => {
      if (!node.parentElement || SKIP.has(node.parentElement.tagName)) return;
      const hit = tr(node.nodeValue);
      if (hit != null) { const lead = node.nodeValue.match(/^\s*/)[0], trail = node.nodeValue.match(/\s*$/)[0]; node.nodeValue = lead + hit + trail; }
    };
    const element = el => {
      for (const a of ATTRS) {
        if (a === 'content' && el.tagName !== 'META') continue;
        const v = el.getAttribute?.(a); const hit = v && tr(v); if (hit != null) el.setAttribute(a, hit);
      }
    };
    const walk = root => {
      if (root.nodeType === Node.TEXT_NODE) return textNode(root);
      if (root.nodeType !== Node.ELEMENT_NODE) return;
      element(root);
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      while (w.nextNode()) { const n = w.currentNode; if (n.nodeType === Node.TEXT_NODE) textNode(n); else element(n); }
    };
    document.documentElement.lang = lang;
    const title = tr(document.title); if (title) document.title = title;
    if (!document.getElementById('i18n-cjk-css')) document.head.append(Object.assign(document.createElement('link'), { id: 'i18n-cjk-css', rel: 'stylesheet', href: 'i18n-cjk.css' }));
    walk(document.head); walk(document.body);
    new MutationObserver(list => {
      for (const m of list) {
        if (m.type === 'characterData') textNode(m.target);
        else if (m.type === 'attributes') element(m.target);
        else m.addedNodes.forEach(walk);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }).catch(() => { /* keep the page in its original language */ });
})();
