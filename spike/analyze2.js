// 可点击控件的稳定锚点覆盖率 —— 回放真正操作的是按钮,这个指标比"所有节点锚点率"更准
// 动态 id 判定:NativeNode_NNN / 纯数字 / 含13位时间戳 / 单独"0"
const fs = require('fs');
const file = process.argv[2];
const root = JSON.parse(fs.readFileSync(file, 'utf-8'));

const isDynamicId = (id) => {
  const s = String(id ?? '').trim();
  if (!s || s === '0') return true;
  if (/^NativeNode_\d+$/.test(s)) return true;
  if (/^\d+$/.test(s)) return true;
  if (/\d{13}/.test(s)) return true;
  return false;
};

let total = 0, clickTotal = 0;
let clickStableId = 0, clickAnyId = 0, clickText = 0, clickStableAnchor = 0;
const stableIdSamples = [];
const noAnchorSamples = [];

const visit = (n) => {
  if (!n || typeof n !== 'object') return;
  const a = n.attributes || {};
  total++;
  const click = a.clickable === 'true';
  const id = String(a.id ?? '').trim();
  const text = String(a.text ?? a.originalText ?? '').trim();
  const stableId = id && !isDynamicId(id);
  if (click) {
    clickTotal++;
    if (id) clickAnyId++;
    if (stableId) { clickStableId++; if (stableIdSamples.length < 10) stableIdSamples.push(id); }
    if (text) clickText++;
    if (stableId || text) clickStableAnchor++;
    else if (noAnchorSamples.length < 10) noAnchorSamples.push(`bounds=${a.bounds} text="${text}" id="${id}"`);
  }
  (n.children || []).forEach(visit);
};
visit(root);

const pct = (n, d) => (d ? (n / d * 100).toFixed(1) + '%' : '0%');
console.log(`\n=== ${file.split(/[/\\]/).pop()} ===`);
console.log('总节点:', total, ' 可点击控件:', clickTotal);
console.log('可点击控件中:');
console.log('  有 id(含动态)   :', clickAnyId, pct(clickAnyId, clickTotal));
console.log('  有稳定 id        :', clickStableId, pct(clickStableId, clickTotal));
console.log('  有 text          :', clickText, pct(clickText, clickTotal));
console.log('  有稳定锚点(id稳|text):', clickStableAnchor, pct(clickStableAnchor, clickTotal), ' ← 回放关键指标');
console.log('稳定 id 样本:', stableIdSamples.join(' | ') || '(无)');
console.log('无锚点的可点击控件样本:', noAnchorSamples.slice(0, 5).join(' | ') || '(无)');
