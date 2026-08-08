// 逐步诊断:测各原语耗时,定位端到端卡点。用 console.error(stderr 无缓冲)输出时间戳。
process.env.MSYS_NO_PATHCONV = '1';
const { createMcpDevice, classifySafety } = require('../dist/explore');
const { computeFingerprint, stripPopup, extractAnchors } = require('../dist/page-graph');
const { connectSession, listDevices, sleep } = require('../dist/mcp/session');

const log = (m) => console.error(`[${new Date().toISOString()}] ${m}`);
const ms = (t0) => `${Date.now() - t0}ms`;

(async () => {
  let t = Date.now();
  const d = (await listDevices())[0]; log(`listDevices ok sn=${d} ${ms(t)}`);

  t = Date.now();
  await connectSession(d); log(`connectSession ok ${ms(t)}`);

  t = Date.now();
  const dev = await createMcpDevice(); log(`createMcpDevice ok screenSize=${JSON.stringify(dev.screenSize)} ${ms(t)}`);

  t = Date.now();
  const m1 = await dev.dump(); log(`dump1 ok els=${m1.elements.length} gen=${m1.generation} ${ms(t)}`);

  const input = { elements: m1.elements, screenSize: dev.screenSize };
  const fp = computeFingerprint(stripPopup(input));
  log(`fingerprint anchors=${JSON.stringify(fp.anchors)} hash=${fp.skeletonHash.slice(0, 12)}`);
  const allowed = m1.elements.filter((e) => e.attrs.clickable !== false && classifySafety(e).allow);
  log(`white-list candidates=${allowed.length}: ${JSON.stringify(allowed.slice(0, 6).map((e) => e.texts))}`);

  if (allowed.length > 0) {
    const cand = allowed[0];
    log(`tapping ref=${cand.ref} texts=${JSON.stringify(cand.texts)}`);
    t = Date.now();
    await dev.tapRef(cand.ref); log(`tapRef ok ${ms(t)}`);
    await sleep(1500);
    t = Date.now();
    const m2 = await dev.dump(); log(`dump2 after tap els=${m2.elements.length} gen=${m2.generation} ${ms(t)}`);
    const fp2 = computeFingerprint(stripPopup({ elements: m2.elements, screenSize: dev.screenSize }));
    log(`after-tap anchors=${JSON.stringify(fp2.anchors)} changed=${fp.skeletonHash !== fp2.skeletonHash}`);

    t = Date.now();
    await dev.pressBack(); log(`pressBack ok ${ms(t)}`);
    await sleep(1000);
    t = Date.now();
    const m3 = await dev.dump(); log(`dump3 after back els=${m3.elements.length} ${ms(t)}`);
    const fp3 = computeFingerprint(stripPopup({ elements: m3.elements, screenSize: dev.screenSize }));
    log(`after-back back-to-root=${fp.skeletonHash === fp3.skeletonHash}`);
  } else {
    log('no white-list candidate on current page');
  }
  log('DIAG DONE');
})().catch((e) => { console.error('DIAG ERROR', e); process.exit(1); });
