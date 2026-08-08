// SLAM diff 端到端:加载 photos 探索图 → 构造"改版"图(增/改/删)→ diffGraphs → formatDiff 报告。
// 纯图操作,不需设备。验证阶段⑤ diff 在真实探索图上的工作(超越单测合成 fixture)。
const path = require('path');
const { MapStore, diffGraphs } = require('../dist/page-graph');
const { formatDiff } = require('../dist/explore');

const store = new MapStore(path.join(__dirname, 'maps'));
const oldG = store.load('com.huawei.hmos.photos', '1.0');
if (!oldG) { console.error('无 photos 图,先跑 explore-e2e.js 建图'); process.exit(1); }

// 深拷贝构造新版图(diff 只用 fingerprint.skeletonHash/anchors,浅拷贝足够)
const cloneNode = (n) => ({
  ...n,
  fingerprint: { ...n.fingerprint },
  skeletonArchive: { ...n.skeletonArchive },
  frontierExplored: [...n.frontierExplored],
});
const newG = {
  ...oldG,
  nodes: new Map([...oldG.nodes].map(([k, v]) => [k, cloneNode(v)])),
  edges: oldG.edges.map((e) => ({ ...e })),
};

const nodes = [...newG.nodes.values()];

// 改版:首个节点 anchors 变(模拟局部改版)+ 换 skeletonHash
const revised = nodes[0];
const oldHash = revised.fingerprint.skeletonHash;
revised.fingerprint = {
  ...revised.fingerprint,
  skeletonHash: oldHash + '_rev',
  anchors: [...revised.fingerprint.anchors, '改版标记'],
};
newG.nodes.delete(oldHash);
newG.nodes.set(revised.fingerprint.skeletonHash, revised);

// 新增:加一个新节点
const added = {
  id: 'new_album_hash',
  fingerprint: { version: 'v2', skeletonHash: 'new_album_hash', anchors: ['新增相册', 'SPEED'] },
  skeletonArchive: { nodes: [], lists: [] },
  frontierExplored: [], frontierPending: [], visitedAt: 0,
};
newG.nodes.set(added.id, added);

// 移除:删最后一个非 revised 节点(若 >2 节点)
if (nodes.length > 2) {
  const removed = nodes[nodes.length - 1];
  if (removed.id !== revised.id) newG.nodes.delete(removed.fingerprint.skeletonHash);
}

const diff = diffGraphs(oldG, newG);
console.log(formatDiff(diff).text);
console.log('\n(old 节点 %d, new 节点 %d)', oldG.nodes.size, newG.nodes.size);
