// 诊断:tap 设置列表入口项("显示和亮度")后连续 dump,判定导航慢(时序)还是未导航(坐标/特性)。
process.env.MSYS_NO_PATHCONV = '1';
const { createMcpDevice } = require('../dist/explore');
const { computeFingerprint, stripPopup } = require('../dist/page-graph');
const { connectSession, disconnectSession, listDevices, sleep } = require('../dist/mcp/session');

const log = (m) => console.error(`[+${ms()}ms] ${m}`);
let t0 = 0; const ms = () => Date.now() - t0;

(async () => {
  t0 = Date.now();
  const d = (await listDevices())[0];
  await connectSession(d);
  const dev = await createMcpDevice();
  const fp = (mm) => computeFingerprint(stripPopup({ elements: mm.elements, screenSize: dev.screenSize }));

  await dev.launchApp('com.huawei.hmos.settings', 'com.huawei.hmos.settings.MainAbility');
  await sleep(2500);
  let m = await dev.dump();
  const rootHash = fp(m).skeletonHash;
  log(`root anchors=${JSON.stringify(fp(m).anchors.slice(0, 4))} els=${m.elements.length}`);

  const el = m.elements.find((e) => (e.texts[0] || '').includes('显示'));
  if (!el) { log('未找到"显示"元素'); return; }
  log(`target texts=${JSON.stringify(el.texts)} type=${el.attrs.type} center=${JSON.stringify(el.center)} bounds=${JSON.stringify(el.bounds)} ref=${el.ref}`);

  log(`tapRef ${el.ref}`);
  await dev.tapRef(el.ref);

  for (let i = 1; i <= 6; i++) {
    await sleep(700);
    const mm = await dev.dump();
    const f = fp(mm);
    log(`dump${i} anchors=${JSON.stringify(f.anchors.slice(0, 4))} els=${mm.elements.length} changed=${f.skeletonHash !== rootHash}`);
  }
  log('DIAG_TAP_DONE');
})().catch((e) => { console.error('ERR', e); process.exitCode = 1; }).finally(() => disconnectSession().catch(() => undefined));
