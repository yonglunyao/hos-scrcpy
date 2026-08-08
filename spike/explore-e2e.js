// 真机端到端:连设备 → preFlight → launchApp 到设置 → Explorer 扫只读 app → 报告。
// 用 console.error(stderr 无缓冲)输出,finally disconnectSession 让 node 正常退出。
// memory hos-scrcpy-daemon-input-conflict:探索用 MCP 截图模式,勿开投屏。
process.env.MSYS_NO_PATHCONV = '1';
const path = require('path');
const { createMcpDevice, DaemonWatchdog, Explorer, ActExecutor } = require('../dist/explore');
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
  log('preFlight OK (daemon socket 存在)');
  await watchdog.launchApp(BUNDLE, ABILITY);
  await sleep(2000);
  log(`已启动 ${BUNDLE}/${ABILITY},开始探索...`);

  const store = new MapStore(path.join(__dirname, 'maps'));
  const act = new ActExecutor(watchdog, { stallMs: Number(process.env.ACT_STALL_MS ?? 200) });
  const exp = new Explorer(act, watchdog, {
    appBundle: BUNDLE, appVersion: VERSION, appAbility: ABILITY,
    maxSteps: Number(process.env.MAX_STEPS || 30),
    maxNoNewPage: Number(process.env.EXPLORE_MAX_NO_NEW ?? 6),
    maxBacktrackFail: Number(process.env.EXPLORE_MAX_BACKTRACK ?? 3),
    sampleLimit: 8,
  }, store);

  const t0 = Date.now();
  const report = await exp.explore();
  log(`=== 探索完成 ${Date.now() - t0}ms ===`);
  log(`app ${BUNDLE} ${VERSION} | 终止 ${report.terminated}`);
  log(`步数 ${report.steps} 新页 ${report.newPages} 节点 ${report.graph.nodes.size} 边 ${report.graph.edges.length}`);
  log('覆盖率: ' + JSON.stringify(report.coverage));
  const opCount = {};
  for (const e of report.graph.edges) opCount[e.opType] = (opCount[e.opType] || 0) + 1;
  log('边 opType: ' + JSON.stringify(opCount));
  for (const [, n] of report.graph.nodes) log('  节点 anchors: ' + JSON.stringify(n.fingerprint.anchors));
  log('图已落盘: ' + path.join(__dirname, 'maps', `${BUNDLE}-${VERSION}.json`));
}

main()
  .catch((e) => { console.error('ERROR', e); process.exitCode = 1; })
  .finally(() => disconnectSession().catch(() => undefined));
