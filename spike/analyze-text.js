// 验证"可点击控件能否按其子树/重叠的 text 定位"(=系统免费OCR覆盖率)
const fs = require('fs');
const root = JSON.parse(fs.readFileSync(process.argv[2], 'utf-8'));
const parseB = (s) => { const m = String(s || '').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/); return m ? [+m[1], +m[2], +m[3], +m[4]] : null; };
const overlap = (a, b) => !(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]);

// 收集所有 Text 节点(有 text + bounds)
const texts = [];
const collect = (n) => {
  if (!n || typeof n !== 'object') return;
  const a = n.attributes || {};
  const t = String(a.text ?? a.originalText ?? '').trim();
  const b = parseB(a.bounds);
  if (t && b) texts.push({ t, b });
  (n.children || []).forEach(collect);
};
collect(root);

let click = 0, bySubtree = 0, byOverlap = 0;
const samples = [];
const visit = (n) => {
  if (!n || typeof n !== 'object') return;
  const a = n.attributes || {};
  const cb = parseB(a.bounds);
  if (a.clickable === 'true' && cb) {
    click++;
    // 子树内 text
    const subTexts = [];
    const walk = (m) => { if (!m || typeof m !== 'object') return; const ma = m.attributes || {}; const tt = String(ma.text ?? ma.originalText ?? '').trim(); if (tt && parseB(ma.bounds)) subTexts.push(tt); (m.children || []).forEach(walk); };
    walk(n);
    if (subTexts.length) { bySubtree++; if (samples.length < 8) samples.push(`"${subTexts[0]}"`); }
    else {
      // 重叠的 text(邻近标签)
      const ov = texts.filter((x) => overlap(cb, x.b));
      if (ov.length) byOverlap++;
    }
  }
  (n.children || []).forEach(visit);
};
visit(root);

const pct = (x) => click ? (x / click * 100).toFixed(0) + '%' : '0%';
console.log(`可点击控件 ${click}`);
console.log(`  子树含 text(按钮内文字)  : ${bySubtree} ${pct(bySubtree)}`);
console.log(`  仅重叠 text(邻近标签)    : ${byOverlap} ${pct(byOverlap)}`);
console.log(`  合计可用 text 定位        : ${bySubtree + byOverlap} ${pct(bySubtree + byOverlap)}  ← text定位覆盖率`);
console.log(`  样本: ${samples.join(' | ') || '(无)'}`);
