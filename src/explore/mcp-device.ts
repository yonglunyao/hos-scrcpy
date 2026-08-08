import type { DevicePrimitives } from './types';
import {
  requireSession, connectSession, disconnectSession,
  captureScreenModel, actByRef,
} from '../mcp/session';

/** 生产 DevicePrimitives:包装 MVP session.ts。recover 重连后所有方法取新 session。 */
export async function createMcpDevice(): Promise<DevicePrimitives> {
  const { device } = requireSession();
  const sn = device.getSn();
  const size = await device.getScreenSize().catch(() => ({ width: 1080, height: 2340 }));

  return {
    screenSize: { w: size.width, h: size.height },
    dump: async () => (await captureScreenModel()).model,
    tapRef: async (ref) => { await actByRef(ref, 'click', 800); },
    tapCoord: async (x, y) => {
      const { uitest } = requireSession();
      await uitest.touchDown(x, y);
      await uitest.touchUp(x, y);
    },
    pressBack: async () => { await requireSession().uitest.pressKey(4); },
    launchApp: async (bundle, ability) => {
      await requireSession().device.shell(`aa start -a ${ability ?? 'EntryAbility'} -b ${bundle}`);
    },
    shell: (cmd, timeoutSec) => requireSession().device.shell(cmd, timeoutSec),
    recover: async () => { await disconnectSession(); await connectSession(sn); },
  };
}
