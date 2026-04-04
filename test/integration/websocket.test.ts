import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import { ChildProcess, spawn } from 'child_process';
import { getDeviceSn } from '../helpers/device-check';

const SN = getDeviceSn();
const SERVER_PORT = 19234;

describe.skipIf(!SN)('WebSocket integration', () => {
  const SERVER_URL = `ws://localhost:${SERVER_PORT}`;
  let serverProc: ChildProcess | null = null;

  beforeAll(async () => {
    serverProc = spawn('node', ['dist/bin/server.js', '--port', String(SERVER_PORT)], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });

    // 等待服务器端口就绪
    const net = require('net');
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 10000;
      const tryConnect = () => {
        if (Date.now() > deadline) { reject(new Error('server did not start')); return; }
        const sock = new net.Socket();
        sock.connect(SERVER_PORT, '127.0.0.1', () => { sock.destroy(); resolve(); });
        sock.on('error', () => { sock.destroy(); setTimeout(tryConnect, 300); });
      };
      tryConnect();
    });
  }, 15000);

  afterAll(async () => {
    if (serverProc) {
      try { serverProc.kill(); } catch {}
      serverProc = null;
    }
  });

  it('GET /api/devices returns JSON with device list', async () => {
    const http = require('http');
    const result = await new Promise<string>((resolve, reject) => {
      http.get(`http://localhost:${SERVER_PORT}/api/devices`, (res: any) => {
        let data = '';
        res.on('data', (chunk: any) => data += chunk);
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });
    const json = JSON.parse(result);
    expect(json.devices).toBeDefined();
    expect(Array.isArray(json.devices)).toBe(true);
    if (SN) expect(json.devices).toContain(SN);
  });

  it('WS connection + screen message receives screenConfig', async () => {
    const ws = new WebSocket(SERVER_URL + `/ws/screen/${SN}`);
    let configReceived = false;
    let binaryCount = 0;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 30000);

      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'screen', sn: SN, remoteIp: '127.0.0.1', remotePort: '8710' }));
      });

      ws.on('message', (data: Buffer, isBinary: boolean) => {
        if (!isBinary) {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'screenConfig') configReceived = true;
          } catch {}
        } else {
          binaryCount++;
        }
        if (configReceived && binaryCount >= 3) {
          clearTimeout(timeout);
          ws.send(JSON.stringify({ type: 'stop', sn: SN }));
          setTimeout(() => { ws.close(); resolve(); }, 1000);
        }
      });

      ws.on('error', (err) => { clearTimeout(timeout); reject(err); });
    });

    expect(configReceived).toBe(true);
    expect(binaryCount).toBeGreaterThanOrEqual(3);
  }, 35000);

  it('touchEvent message accepted without error', async () => {
    const ws = new WebSocket(SERVER_URL + `/ws/screen/${SN}`);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 30000);

      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'screen', sn: SN, remoteIp: '127.0.0.1', remotePort: '8710' }));
      });

      ws.on('message', (data: Buffer, isBinary: boolean) => {
        if (!isBinary) {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'screenConfig') {
              ws.send(JSON.stringify({ type: 'touchEvent', sn: SN, message: { event: 'down', x: 100, y: 200 } }));
              ws.send(JSON.stringify({ type: 'touchEvent', sn: SN, message: { event: 'up', x: 100, y: 200 } }));
              clearTimeout(timeout);
              ws.send(JSON.stringify({ type: 'stop', sn: SN }));
              setTimeout(() => { ws.close(); resolve(); }, 1000);
            }
          } catch {}
        }
      });

      ws.on('error', (err) => { clearTimeout(timeout); reject(err); });
    });
  }, 35000);

  it('HOME keyCode message accepted', async () => {
    const ws = new WebSocket(SERVER_URL + `/ws/screen/${SN}`);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 30000);

      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'screen', sn: SN, remoteIp: '127.0.0.1', remotePort: '8710' }));
      });

      ws.on('message', (data: Buffer, isBinary: boolean) => {
        if (!isBinary) {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'screenConfig') {
              ws.send(JSON.stringify({ type: 'keyCode', sn: SN, message: { key: 'HOME', code: 'Home' } }));
              clearTimeout(timeout);
              ws.send(JSON.stringify({ type: 'stop', sn: SN }));
              setTimeout(() => { ws.close(); resolve(); }, 1000);
            }
          } catch {}
        }
      });

      ws.on('error', (err) => { clearTimeout(timeout); reject(err); });
    });
  }, 35000);

  it('stop message ends stream', async () => {
    const ws = new WebSocket(SERVER_URL + `/ws/screen/${SN}`);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 30000);

      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'screen', sn: SN, remoteIp: '127.0.0.1', remotePort: '8710' }));
      });

      ws.on('message', (data: Buffer, isBinary: boolean) => {
        if (!isBinary) {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'screenConfig') {
              ws.send(JSON.stringify({ type: 'stop', sn: SN }));
              clearTimeout(timeout);
              setTimeout(() => { ws.close(); resolve(); }, 2000);
            }
          } catch {}
        }
      });

      ws.on('close', () => resolve());
      ws.on('error', (err) => { clearTimeout(timeout); reject(err); });
    });
  }, 35000);

  it('reconnect after disconnect', async () => {
    const ws1 = new WebSocket(SERVER_URL + `/ws/screen/${SN}`);
    let config1 = false;

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => { ws1.close(); resolve(); }, 30000);
      ws1.on('open', () => {
        ws1.send(JSON.stringify({ type: 'screen', sn: SN, remoteIp: '127.0.0.1', remotePort: '8710' }));
      });
      ws1.on('message', (data: Buffer, isBinary: boolean) => {
        if (!isBinary) {
          try {
            if (JSON.parse(data.toString()).type === 'screenConfig') {
              config1 = true;
              ws1.send(JSON.stringify({ type: 'stop', sn: SN }));
              clearTimeout(timeout);
              setTimeout(() => { ws1.close(); resolve(); }, 2000);
            }
          } catch {}
        }
      });
    });

    const ws2 = new WebSocket(SERVER_URL + `/ws/screen/${SN}`);
    let config2 = false;

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => { ws2.close(); resolve(); }, 30000);
      ws2.on('open', () => {
        ws2.send(JSON.stringify({ type: 'screen', sn: SN, remoteIp: '127.0.0.1', remotePort: '8710' }));
      });
      ws2.on('message', (data: Buffer, isBinary: boolean) => {
        if (!isBinary) {
          try {
            if (JSON.parse(data.toString()).type === 'screenConfig') {
              config2 = true;
              ws2.send(JSON.stringify({ type: 'stop', sn: SN }));
              clearTimeout(timeout);
              setTimeout(() => { ws2.close(); resolve(); }, 1000);
            }
          } catch {}
        }
      });
    });

    expect(config1).toBe(true);
    expect(config2).toBe(true);
  }, 70000);

  it('multiple clients share stream', async () => {
    const ws1 = new WebSocket(SERVER_URL + `/ws/screen/${SN}`);
    const ws2 = new WebSocket(SERVER_URL + `/ws/screen/${SN}`);
    let config1 = false, config2 = false, binary1 = 0, binary2 = 0;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { ws1.close(); ws2.close(); reject(new Error('timeout')); }, 35000);
      const checkDone = () => {
        if (config1 && config2 && binary1 >= 3 && binary2 >= 3) {
          clearTimeout(timeout);
          ws1.send(JSON.stringify({ type: 'stop', sn: SN }));
          setTimeout(() => { ws1.close(); ws2.close(); resolve(); }, 500);
        }
      };

      ws1.on('open', () => ws1.send(JSON.stringify({ type: 'screen', sn: SN, remoteIp: '127.0.0.1', remotePort: '8710' })));
      ws2.on('open', () => ws2.send(JSON.stringify({ type: 'screen', sn: SN, remoteIp: '127.0.0.1', remotePort: '8710' })));

      ws1.on('message', (data: Buffer, isBinary: boolean) => {
        if (!isBinary) { try { if (JSON.parse(data.toString()).type === 'screenConfig') config1 = true; } catch {} }
        else { binary1++; }
        checkDone();
      });
      ws2.on('message', (data: Buffer, isBinary: boolean) => {
        if (!isBinary) { try { if (JSON.parse(data.toString()).type === 'screenConfig') config2 = true; } catch {} }
        else { binary2++; }
        checkDone();
      });

      ws1.on('error', (err) => { clearTimeout(timeout); reject(err); });
      ws2.on('error', (err) => { clearTimeout(timeout); reject(err); });
    });

    expect(config1).toBe(true);
    expect(config2).toBe(true);
  }, 40000);
});
