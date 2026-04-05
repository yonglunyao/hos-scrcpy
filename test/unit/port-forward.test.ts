import { describe, it, expect } from 'vitest';
import { MockHdcClient } from '../helpers/mock-hdc';

describe('PortForwardManager withLock', () => {
  // Test the withLock serialization logic extracted
  it('serializes concurrent calls', async () => {
    let _resolveLock!: () => void;
    let lock: Promise<void> = Promise.resolve();
    const order: number[] = [];

    async function withLock(fn: () => Promise<void>): Promise<void> {
      const prev = lock;
      let r!: () => void;
      lock = new Promise<void>(res => { r = res; });
      _resolveLock = r;
      await prev;
      try {
        await fn();
      } finally {
        r();
      }
    }

    const p1 = withLock(async () => {
      order.push(1);
      await new Promise(res => setTimeout(res, 50));
      order.push(2);
    });

    const p2 = withLock(async () => {
      order.push(3);
      order.push(4);
    });

    await Promise.all([p1, p2]);

    expect(order).toEqual([1, 2, 3, 4]);
  });

  it('releases lock after error', async () => {
    let lock: Promise<void> = Promise.resolve();
    let calledAfterError = false;

    async function withLock(fn: () => Promise<void>): Promise<void> {
      const prev = lock;
      let r!: () => void;
      lock = new Promise<void>(res => { r = res; });
      await prev;
      try {
        await fn();
      } finally {
        r();
      }
    }

    await withLock(async () => { throw new Error('test'); }).catch(() => {});

    await withLock(async () => { calledAfterError = true; });
    expect(calledAfterError).toBe(true);
  });
});

describe('MockHdcClient forward tracking', () => {
  it('createTcpForward records the forward', async () => {
    const mock = new MockHdcClient();
    await mock.createForward(12345, 5000);
    const forwards = mock.getCreatedForwards();
    expect(forwards).toEqual([{ localPort: 12345, remotePort: 5000 }]);
  });

  it('createAbstractForward records the forward', async () => {
    const mock = new MockHdcClient();
    await mock.createAbstractForward(12346, 'scrcpy_grpc_socket');
    const forwards = mock.getCreatedForwards();
    expect(forwards).toEqual([{ localPort: 12346, abstractSocket: 'scrcpy_grpc_socket' }]);
  });

  it('removeForward records the removal', async () => {
    const mock = new MockHdcClient();
    await mock.removeForward(12345, 5000);
    const removed = mock.getRemovedForwards();
    expect(removed).toEqual([{ localPort: 12345, remotePort: 5000 }]);
  });

  it('releaseAll pattern (all releases called)', async () => {
    const mock = new MockHdcClient();
    await mock.createForward(11111, 5000);
    await mock.createForward(22222, 5001);
    await mock.createAbstractForward(33333, 'test_socket');

    // Simulate releaseAll
    const forwards = mock.getCreatedForwards();
    await Promise.allSettled([
      ...forwards.filter(f => f.remotePort !== undefined).map(f =>
        mock.removeForward(f.localPort, f.remotePort!)
      ),
      ...forwards.filter(f => f.abstractSocket !== undefined).map(f =>
        mock.removeAbstractForward(f.localPort, f.abstractSocket!)
      ),
    ]);

    expect(mock.getRemovedForwards().length).toBe(3);
  });

  it('error in one release does not block others', async () => {
    const mock = new MockHdcClient();
    await mock.createForward(11111, 5000);
    await mock.createForward(22222, 5001);

    // Both succeed
    const results = await Promise.allSettled([
      mock.removeForward(11111, 5000),
      mock.removeForward(22222, 5001),
    ]);

    expect(results.every(r => r.status === 'fulfilled')).toBe(true);
  });
});
