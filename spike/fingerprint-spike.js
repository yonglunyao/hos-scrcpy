process.env.MSYS_NO_PATHCONV = '1';
const fs = require('fs');
const path = require('path');
const { buildScreenModel } = require('../dist/screen-model');
const { computeFingerprint, matchAnchors } = require('../dist/page-graph');

const SPIKE_DIR = __dirname;
const FILES = ['set-1.json', 'set-2.json', 'tb-1.json', 'tb-2.json', 'tb-3.json', 'pg-1.json', 'pg-2.json', 'pg-3.json']
  .filter((f) => fs.existsSync(path.join(SPIKE_DIR, f)));

function topTypes(types, n) {
  return Object.entries(types)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([t, c]) => `${t}:${c}`)
    .join(' ');
}

function analyze(file) {
  const json = fs.readFileSync(path.join(SPIKE_DIR, file), 'utf-8');
  const model = buildScreenModel(json);
  const fp = computeFingerprint({ elements: model.elements });

  const types = {};
  for (const e of model.elements) {
    const t = e.attrs.type ?? '(none)';
    types[t] = (types[t] ?? 0) + 1;
  }

  const clickable = model.elements.filter((e) => e.attrs.clickable).length;
  const noText = model.elements.filter(
    (e) => e.attrs.clickable && (e.texts.length === 0 || e.texts.every((t) => !t)),
  ).length;
  const scrollable = model.elements.filter((e) => e.attrs.scrollable).length;

  // 列表容器识别:规则①规范化依赖(scrollable OR type 含 list/waterflow/grid)
  const listContainers = model.elements.filter(
    (e) => e.attrs.scrollable || /list|waterflow|grid/i.test(e.attrs.type ?? ''),
  ).length;

  const iconRatio = clickable > 0 ? noText / clickable : 0;

  // 屏幕尺寸推导(从 bounds)
  let maxR = 1, maxB = 1;
  for (const e of model.elements) {
    maxR = Math.max(maxR, e.bounds[2]);
    maxB = Math.max(maxB, e.bounds[3]);
  }

  return {
    file,
    hash: fp.skeletonHash.slice(0, 16),
    anchors: fp.anchors,
    anchorCount: fp.anchors.length,
    elementCount: model.elements.length,
    clickable,
    scrollable,
    listContainers,
    noTextClickable: noText,
    iconRatio,
    screenSize: `${maxR}x${maxB}`,
    typeDist: topTypes(types, 8),
  };
}

const results = FILES.map(analyze);

console.log('=== 指纹 spike 报告(现有真机 dump 数据)===');
console.log(`样本: ${FILES.length} 个 dump | fingerprint version: v1\n`);

// 1. 每页概览
console.log('--- 1. 各页指纹概览 ---');
for (const r of results) {
  console.log(
    `${r.file}: hash=${r.hash} els=${r.elementCount} click=${r.clickable} scroll=${r.scrollable} listCt=${r.listContainers} icon=${r.noTextClickable}/${r.clickable}=${(r.iconRatio * 100).toFixed(0)}% scr=${r.screenSize}`,
  );
  console.log(`  anchors(${r.anchorCount}): [${r.anchors.slice(0, 8).join(', ')}]`);
  console.log(`  types: ${r.typeDist}\n`);
}

// 2. 区分性
const hashes = results.map((r) => r.hash);
const unique = new Set(hashes);
console.log('--- 2. 区分性 ---');
console.log(`${results.length} 页 / ${unique.size} 唯一 hash (${unique.size === results.length ? '全部不同 OK' : '有重复 FAIL'})`);
if (unique.size !== results.length) {
  const seen = {};
  for (const r of results) {
    seen[r.hash] = (seen[r.hash] || []);
    seen[r.hash].push(r.file);
  }
  for (const [h, fs_] of Object.entries(seen)) {
    if (fs_.length > 1) console.log(`  重复 hash ${h}: ${fs_.join(', ')}`);
  }
}

// 3. 同组稳定性 + Jaccard(疑似同页的文件分组)
console.log('\n--- 3. 同组对比(稳定性 / 近似度)---');
const groups = [
  ['set-1.json', 'set-2.json'],
  ['tb-1.json', 'tb-2.json', 'tb-3.json'],
  ['pg-1.json', 'pg-2.json', 'pg-3.json'],
];
for (const g of groups) {
  const mem = g.filter((f) => results.some((r) => r.file === f));
  if (mem.length < 2) continue;
  console.log(`\n[${mem[0].split('-')[0]} 组]`);
  for (let i = 0; i < mem.length; i++) {
    for (let j = i + 1; j < mem.length; j++) {
      const a = results.find((r) => r.file === mem[i]);
      const b = results.find((r) => r.file === mem[j]);
      const sameHash = a.hash === b.hash;
      const jac = matchAnchors(a.anchors, b.anchors);
      console.log(
        `  ${mem[i]} vs ${mem[j]}: hash=${sameHash ? 'SAME' : 'DIFF'} jaccard=${jac.toFixed(3)} (anchors ${a.anchorCount}/${b.anchorCount})`,
      );
    }
  }
}

// 4. 跨组近似度(不同 app 页面之间应低 Jaccard,验证 anchors 区分力)
console.log('\n--- 4. 跨组近似度(取各组首项,应低 Jaccard)---');
const cross = ['set-1.json', 'tb-1.json', 'pg-1.json'].filter((f) => results.some((r) => r.file === f));
for (let i = 0; i < cross.length; i++) {
  for (let j = i + 1; j < cross.length; j++) {
    const a = results.find((r) => r.file === cross[i]);
    const b = results.find((r) => r.file === cross[j]);
    const jac = matchAnchors(a.anchors, b.anchors);
    console.log(`  ${cross[i]} vs ${cross[j]}: jaccard=${jac.toFixed(3)}`);
  }
}

// 5. 汇总指标
console.log('\n--- 5. 汇总 ---');
const totalClick = results.reduce((s, r) => s + r.clickable, 0);
const totalNoText = results.reduce((s, r) => s + r.noTextClickable, 0);
const totalList = results.reduce((s, r) => s + r.listContainers, 0);
const totalScroll = results.reduce((s, r) => s + r.scrollable, 0);
console.log(`总 clickable: ${totalClick}`);
console.log(`总 纯图标 clickable(no text): ${totalNoText} (${((totalNoText / totalClick) * 100).toFixed(1)}%)`);
console.log(`总 scrollable: ${totalScroll} | 列表容器(scrollable OR list/grid/waterflow type): ${totalList}`);
const allAnchors = results.flatMap((r) => r.anchors);
const noiseLike = allAnchors.filter((a) => /^(NUM|:|K\/s|\/|MB|GB|%)$/i.test(a)).length;
console.log(`总 anchors: ${allAnchors.length} | 疑似状态栏噪声(NUM/:/K/s 等): ${noiseLike} (${((noiseLike / allAnchors.length) * 100).toFixed(0)}%)`);
