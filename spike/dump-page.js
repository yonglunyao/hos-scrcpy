// 通用 dump:连设备 → launch app → 打印可点元素的 type/text(供 SafetyFilter 词表适配)。
process.env.MSYS_NO_PATHCONV = '1';
const { createMcpDevice, classifySafety } = require('../dist/explore');
const { connectSession, disconnectSession, listDevices, sleep } = require('../dist/mcp/session');

const BUNDLE = process.env.B;
const ABILITY = process.env.A || BUNDLE + '.MainAbility';

(async () => {
  if (!BUNDLE) { console.error('用法: B=<bundle> A=<ability> node spike/dump-page.js'); process.exit(1); }
  const d = (await listDevices())[0];
  await connectSession(d);
  const dev = await createMcpDevice();
  await dev.launchApp(BUNDLE, ABILITY);
  await sleep(2500);
  const m = await dev.dump();
  console.error(`=== ${BUNDLE} els=${m.elements.length} ===`);
  for (const e of m.elements) {
    if (e.attrs.clickable === false) continue;
    const v = classifySafety(e);
    console.error(`[${v.allow ? 'ALLOW' : 'DENY '}:${v.reason}] type=${e.attrs.type ?? ''} texts=${JSON.stringify(e.texts)}`);
  }
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => disconnectSession().catch(() => undefined));
