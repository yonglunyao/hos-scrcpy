import { describe, it, expect } from 'vitest';
import { DaemonWatchdog } from '../../../src/explore/daemon-watchdog';
import { FakeDevice, model, el } from './fakes';

describe('DaemonWatchdog', () => {
  it('socket 存在 → 正常 dump,不 recover', async () => {
    const inner = new FakeDevice([model([el('A', 'Text')])]);
    inner.shell = async () => '1';
    const wd = new DaemonWatchdog(inner, { actTimeoutMs: 5000 });
    await wd.dump();
    expect(inner.calls.recover).toBe(0);
  });
  it('socket 不存在 → recover 后再 dump', async () => {
    const inner = new FakeDevice([model([el('A', 'Text')])]);
    inner.shell = async () => '0';
    const wd = new DaemonWatchdog(inner, { actTimeoutMs: 5000 });
    await wd.dump();
    expect(inner.calls.recover).toBe(1);
  });
  it('操作超时 → recover → 重试一次', async () => {
    const inner = new FakeDevice([model([el('A', 'Text')])]);
    inner.shell = async () => '1';
    let calls = 0;
    inner.tapRef = async () => { calls++; if (calls === 1) await new Promise((_, r) => setTimeout(() => r(new Error('hang')), 50)); };
    const wd = new DaemonWatchdog(inner, { actTimeoutMs: 20 });
    await wd.tapRef('x');
    expect(inner.calls.recover).toBe(1);
    expect(calls).toBe(2);
  });
  it('preFlight:socket 存在 → true;不存在 → false', async () => {
    const ok = new FakeDevice([]); ok.shell = async () => '1';
    const bad = new FakeDevice([]); bad.shell = async () => '0';
    expect(await new DaemonWatchdog(ok).preFlight()).toBe(true);
    expect(await new DaemonWatchdog(bad).preFlight()).toBe(false);
  });
});
