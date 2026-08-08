// 深度拆解 dumpLayout JSON:字段全景 / type 分布 / id 来源 / 可点击控件可用锚点 / 层级
const fs = require('fs');
const root = JSON.parse(fs.readFileSync(process.argv[2], 'utf-8'));
const nodes = [];
const visit = (n) => {
  if (!n || typeof n !== 'object') return;
  nodes.push(n.attributes || {});
  (n.children || []).forEach(visit);
};
visit(root);

const meaningful = (v) => {
  const s = String(v ?? '').trim();
  return s && s !== 'false' && s !== '0' && s !== 'empty source' && s !== '0.00px' && s !== 'HitTestMode.Default';
};

// 1. 字段全景
const fields = new Set();
nodes.forEach((a) => Object.keys(a).forEach((k) => fields.add(k)));
console.log(`总节点 ${nodes.length}\n=== 字段有意义值率 ===`);
[...fields].sort().forEach((k) => {
  const c = nodes.filter((a) => meaningful(a[k])).length;
  console.log(`  ${k.padEnd(22)} ${String(c).padStart(4)}/${nodes.length}  ${(c / nodes.length * 100).toFixed(1)}%`);
});

// 2. type 分布(top15)
const tc = {};
nodes.forEach((a) => { const t = a.type || '(空)'; tc[t] = (tc[t] || 0) + 1; });
console.log('\n=== type 分布(top15) ===');
Object.entries(tc).sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([t, c]) => console.log(`  ${(t || '').padEnd(24)} ${c}`));

// 3. id 来源
let dev = 0, nat = 0, num = 0, ts = 0, empty = 0;
const devSamples = new Set();
nodes.forEach((a) => {
  const id = String(a.id ?? '').trim();
  if (!id || id === '0') return empty++;
  if (/^NativeNode_\d+$/.test(id)) return nat++;
  if (/^\d+$/.test(id)) return num++;
  if (/\d{13}/.test(id)) return ts++;
  dev++; if (devSamples.size < 20) devSamples.add(id);
});
console.log(`\n=== id 来源 ===`);
console.log(`  开发者命名(稳定)  : ${dev}`);
console.log(`  NativeNode_ 动态   : ${nat}`);
console.log(`  纯数字            : ${num}`);
console.log(`  含13位时间戳       : ${ts}`);
console.log(`  空/0              : ${empty}`);
console.log(`  开发者 id 样本: ${[...devSamples].join(' | ')}`);

// 4. 可点击控件:哪些字段有有意义值(找除 id/text 外的锚点)
const clicks = nodes.filter((a) => a.clickable === 'true');
console.log(`\n=== 可点击控件 ${clicks.length} 个:字段有意义值率(找锚点) ===`);
const cf = {};
clicks.forEach((a) => Object.keys(a).forEach((k) => { if (meaningful(a[k])) cf[k] = (cf[k] || 0) + 1; }));
Object.entries(cf).sort((a, b) => b[1] - a[1]).forEach(([k, c]) => console.log(`  ${k.padEnd(22)} ${String(c).padStart(3)}/${clicks.length}  ${(c / clicks.length * 100).toFixed(0)}%`));

// 5. 可点击控件的 type
const ctc = {};
clicks.forEach((a) => { const t = a.type || '(空)'; ctc[t] = (ctc[t] || 0) + 1; });
console.log('\n=== 可点击控件 type ===');
Object.entries(ctc).sort((a, b) => b[1] - a[1]).forEach(([t, c]) => console.log(`  ${(t || '').padEnd(24)} ${c}`));

// 6. 层级深度
const depths = {};
nodes.forEach((a) => { const d = a.hierarchy ? String(a.hierarchy).split(',').length : 0; depths[d] = (depths[d] || 0) + 1; });
console.log('\n=== hierarchy 层级深度分布 ===');
Object.keys(depths).sort((a, b) => a - b).forEach((d) => console.log(`  深度 ${d}: ${depths[d]} 节点`));
