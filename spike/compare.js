// 比较两次 dumpLayout 的标识符稳定性(A1 核心:锚点跨 dump 是否一致)
// 用法: node compare.js a.json b.json
const fs = require('fs');
const collect = (file) => {
  const root = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const out = { ids: [], keys: [], accs: [], hashes: [], texts: [] };
  const visit = (n) => {
    if (!n || typeof n !== 'object') return;
    const a = n.attributes || {};
    out.ids.push(String(a.id ?? ''));
    out.keys.push(String(a.key ?? ''));
    out.accs.push(String(a.accessibilityId ?? ''));
    out.hashes.push(String(a.hashcode ?? ''));
    out.texts.push(String(a.text ?? a.originalText ?? ''));
    (n.children || []).forEach(visit);
  };
  visit(root);
  return out;
};
const A = collect(process.argv[2]);
const B = collect(process.argv[3]);
console.log(`\n=== ${process.argv[2].split('/').pop()} vs ${process.argv[3].split('/').pop()} ===`);
for (const f of ['ids', 'keys', 'accs', 'hashes', 'texts']) {
  const lenMatch = A[f].length === B[f].length;
  let diff = 0;
  const min = Math.min(A[f].length, B[f].length);
  for (let i = 0; i < min; i++) if (A[f][i] !== B[f][i]) diff++;
  const stable = lenMatch && diff === 0;
  console.log(
    `${f.padEnd(8)} 节点 ${A[f].length}/${B[f].length} ${stable ? '✓ 完全一致(稳定)' : `✗ 差异 ${diff} 处`}`,
  );
}
