// 真机导航端到端:连设备 → 加载阶段③ 探索图 → Navigator 导航到目标节点 → 报告。
// 注意:阶段③ 探索图无 navigate 边(点击未触发跳页),故预期多为 no-path;此脚本验证 Navigator 真机集成。
process.env.MSYS_NO_PATHCONV = '1';
const path = require('path');
const { createMcpDevice, DaemonWatchdog, ActExecutor, Navigator } = require('../dist/explore');
const { MapStore } = require('../dist/page-graph');
const { connectSession, disconnectSession, listDevices, sleep } = require('../dist/mcp/session');

const BUNDLE = process.env.EXPLORE_BUNDLE || 'com.huawei.hmos.settings';
const ABILITY = process.env.EXPLORE_ABILITY || 'com.huawei.hmos.settings.MainAbility';
const VERSION = process.env.EXPLORE_VERSION || '1.0';
const log = (m) => console.error(`[${new Date().toISOString()}] ${m}`);

async function main() {
  const devices = await listDevices();
  if (!devices.length) throw new Error('无设备,先 hdc connect');
  log(`设备 ${devices[0]}`);
  await connectSession(devices[0]);
  const raw = await createMcpDevice();
  const watchdog = new DaemonWatchdog(raw, { actTimeoutMs: 15000 });
  if (!(await watchdog.preFlight())) { console.error('preFlight 失败:uitest_socket 不存在。'); return; }
  log('preFlight OK');

  const store = new MapStore(path.join(__dirname, 'maps'));
  const graph = store.load(BUNDLE, VERSION);
  if (!graph) { console.error('无已存图,先跑 explore-e2e.js 建图'); return; }
  const navEdges = graph.edges.filter((e) => e.opType === 'navigate').length;
  log(`加载图: 节点 ${graph.nodes.size} 边 ${graph.edges.length}(navigate ${navEdges})`);

  const act = new ActExecutor(watchdog, { stallMs: 300 });
  const nav = new Navigator(act, graph);

  await watchdog.launchApp(BUNDLE, ABILITY);
  await sleep(2000);
  const cur = await act.senseStable();
  log(`当前页 anchors: ${JSON.stringify(cur.fingerprint.anchors)}`);

  const targetNode = [...graph.nodes.values()].find((n) => n.id !== cur.fingerprint.skeletonHash);
  if (!targetNode) { log('图中无其他节点可导航'); return; }
  log(`导航目标 anchors: ${JSON.stringify(targetNode.fingerprint.anchors)}`);

  const r = await nav.navigate(cur, { fingerprintHash: targetNode.id }, { maxPathSteps: 6, maxReverify: 1, maxBadEdges: 2 });
  log(`=== 导航结果 ===`);
  log(`success=${r.success} reason=${r.reason} traversed=${r.traversed} pathLen=${r.path.length}`);
  log(`verified: ${JSON.stringify(r.verified)}`);
}
main()
  .catch((e) => { console.error('ERROR', e); process.exitCode = 1; })
  .finally(() => disconnectSession().catch(() => undefined));
