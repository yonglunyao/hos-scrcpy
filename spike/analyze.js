// dumpLayout fixture 锚点质量分析 —— 回答 A1(id/key/text 非空率)
// 用法: node analyze.js <fixture.json> [label]
const fs = require('fs');
const file = process.argv[2];
const label = process.argv[3] || file;
const root = JSON.parse(fs.readFileSync(file, 'utf-8'));

let total = 0;
const c = { id: 0, key: 0, text: 0, click: 0, accId: 0, anyAnchor: 0, anyOrClick: 0, neither: 0 };
const idSample = new Set();

const visit = (node) => {
  if (!node || typeof node !== 'object') return;
  const a = node.attributes || {};
  total++;
  const hasId = !!(a.id && String(a.id).trim());
  const hasKey = !!(a.key && String(a.key).trim());
  const hasText = !!(a.text && String(a.text).trim()) || !!(a.originalText && String(a.originalText).trim());
  const hasClick = a.clickable === 'true';
  const hasAcc = !!(a.accessibilityId && String(a.accessibilityId).trim());
  if (hasId) { c.id++; if (idSample.size < 12) idSample.add(String(a.id)); }
  if (hasKey) c.key++;
  if (hasText) c.text++;
  if (hasClick) c.click++;
  if (hasAcc) c.accId++;
  if (hasId || hasKey || hasText) c.anyAnchor++; else c.neither++;
  if (hasId || hasKey || hasText || hasClick) c.anyOrClick++;
  (node.children || []).forEach(visit);
};
visit(root);

const pct = (n) => (total ? (n / total * 100).toFixed(1) + '%' : '0%');
console.log(`\n=== ${label} ===`);
console.log('总节点:', total);
console.log('id 非空        :', c.id, pct(c.id));
console.log('key 非空       :', c.key, pct(c.key));
console.log('text 非空      :', c.text, pct(c.text));
console.log('accessibilityId:', c.accId, pct(c.accId));
console.log('clickable=true :', c.click, pct(c.click));
console.log('有锚点(id|key|text):', c.anyAnchor, pct(c.anyAnchor), '  ← A1 核心指标(目标≥80%)');
console.log('有锚点或可点击    :', c.anyOrClick, pct(c.anyOrClick));
console.log('id 样本:', [...idSample].join(', '));
