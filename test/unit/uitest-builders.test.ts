import { describe, it, expect } from 'vitest';
import { UitestServer } from '../../src/input/uitest';
import { MockHdcClient } from '../helpers/mock-hdc';
import { DeviceManager } from '../../src/device/manager';

// Access private builder methods by creating a test instance
// The builders are now public for testing, but they require an instance
function createTestInstance(): UitestServer {
  const mock = new MockHdcClient();
  // We need a DeviceManager, which requires a HdcClient
  // Since we can't easily mock HdcClient in the constructor, we'll test the JSON output directly
  const dm = new DeviceManager({
    sn: 'TEST',
    hdcPath: 'hdc',
    ip: '127.0.0.1',
    hdcPort: 8710,
  });
  return new UitestServer(dm);
}

// Since UitestServer's builder methods are now public but require instance context,
// and the JSON output is deterministic, we test the output format directly.
describe('buildGesturesRequest', () => {
  it('produces correct JSON structure for touchDown', () => {
    const server = createTestInstance();
    const result = server.buildGesturesRequest('touchDown', { x: 100, y: 200 });
    const parsed = JSON.parse(result);
    expect(parsed.module).toBe('com.ohos.devicetest.hypiumApiHelper');
    expect(parsed.method).toBe('Gestures');
    expect(parsed.params.api).toBe('touchDown');
    expect(parsed.params.args).toEqual({ x: 100, y: 200 });
  });

  it('produces correct JSON for touchMove', () => {
    const server = createTestInstance();
    const result = server.buildGesturesRequest('touchMove', { x: 50, y: 75 });
    const parsed = JSON.parse(result);
    expect(parsed.params.api).toBe('touchMove');
    expect(parsed.params.args).toEqual({ x: 50, y: 75 });
  });

  it('produces correct JSON for ButtonLeftDown', () => {
    const server = createTestInstance();
    const result = server.buildGesturesRequest('ButtonLeftDown', { x: 0, y: 0 });
    const parsed = JSON.parse(result);
    expect(parsed.params.api).toBe('ButtonLeftDown');
  });

  it('produces valid JSON', () => {
    const server = createTestInstance();
    const result = server.buildGesturesRequest('AxisUp', { x: 100, y: 100 });
    // Should not throw
    expect(() => JSON.parse(result)).not.toThrow();
  });
});

describe('buildModuleRequest', () => {
  it('captureLayout with correct method and params', () => {
    const server = createTestInstance();
    const result = server.buildModuleRequest('Captures', { api: 'captureLayout' });
    const parsed = JSON.parse(result);
    expect(parsed.module).toBe('com.ohos.devicetest.hypiumApiHelper');
    expect(parsed.method).toBe('Captures');
    expect(parsed.params.api).toBe('captureLayout');
  });

  it('getResolution with correct method', () => {
    const server = createTestInstance();
    const result = server.buildModuleRequest('Display', { api: 'getResolution' });
    const parsed = JSON.parse(result);
    expect(parsed.method).toBe('Display');
    expect(parsed.params.api).toBe('getResolution');
  });

  it('captureScreen with args', () => {
    const server = createTestInstance();
    const args = { api: 'captureScreen', args: { displayId: 0, savePath: '/tmp/screen.jpeg' } };
    const result = server.buildModuleRequest('Captures', args);
    const parsed = JSON.parse(result);
    expect(parsed.params.args.displayId).toBe(0);
    expect(parsed.params.args.savePath).toBe('/tmp/screen.jpeg');
  });

  it('produces valid JSON', () => {
    const server = createTestInstance();
    const result = server.buildModuleRequest('Captures', { api: 'test' });
    expect(() => JSON.parse(result)).not.toThrow();
  });
});

describe('buildCallHypiumRequest', () => {
  it('pressHome with correct api and this', () => {
    const server = createTestInstance();
    const result = server.buildCallHypiumRequest('Driver.pressHome', []);
    const parsed = JSON.parse(result);
    expect(parsed.module).toBe('com.ohos.devicetest.hypiumApiHelper');
    expect(parsed.method).toBe('callHypiumApi');
    expect(parsed.params.api).toBe('Driver.pressHome');
    expect(parsed.params.args).toEqual([]);
    expect(parsed.params.this).toBe('Driver#0');
  });

  it('pressBack with correct api', () => {
    const server = createTestInstance();
    const result = server.buildCallHypiumRequest('Driver.pressBack', []);
    const parsed = JSON.parse(result);
    expect(parsed.params.api).toBe('Driver.pressBack');
  });

  it('inputText with coordinate and text', () => {
    const server = createTestInstance();
    const result = server.buildCallHypiumRequest('Driver.inputText', [[{ x: 100, y: 200 }, 'hello']]);
    const parsed = JSON.parse(result);
    expect(parsed.params.args).toEqual([[{ x: 100, y: 200 }, 'hello']]);
  });

  it('setDisplayRotation with rotation value', () => {
    const server = createTestInstance();
    const result = server.buildCallHypiumRequest('Driver.setDisplayRotation', [0]);
    const parsed = JSON.parse(result);
    expect(parsed.params.args).toEqual([0]);
  });

  it('produces valid JSON', () => {
    const server = createTestInstance();
    const result = server.buildCallHypiumRequest('Driver.pressHome', []);
    expect(() => JSON.parse(result)).not.toThrow();
  });
});
