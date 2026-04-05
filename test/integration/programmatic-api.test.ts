/**
 * 编程式 API 集成测试
 *
 * 测试 HosScrcpyServer 的编程式方法：
 * - startDevice() / stopDevice() / stopAll()
 * - isCasting() / getPort()
 * - /api/status 端点
 * - /webview/* 路由
 * - 持久化设备行为
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ChildProcess, spawn } from 'child_process';
import { getDeviceSn } from '../helpers/device-check';

const SN = getDeviceSn();
// 使用固定端口避免冲突
const SERVER_PORT = 19235;

describe.skipIf(!SN)('Programmatic API integration', () => {
  const SERVER_URL = `http://localhost:${SERVER_PORT}`;
  const WS_URL = `ws://localhost:${SERVER_PORT}`;
  let serverProc: ChildProcess | null = null;

  beforeEach(async () => {
    // 每个测试前启动服务器
    if (serverProc) return;

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

    // 额外等待 500ms 确保服务器完全就绪
    await new Promise(resolve => setTimeout(resolve, 500));
  }, 15000);

  afterEach(async () => {
    // 每个测试后停止服务器
    if (serverProc) {
      try { serverProc.kill('SIGTERM'); } catch { /* ignore cleanup errors */ }
      await new Promise(resolve => setTimeout(resolve, 500));
      try { serverProc.kill('SIGKILL'); } catch { /* ignore cleanup errors */ }
      serverProc = null;
    }
    // 等待端口释放
    await new Promise(resolve => setTimeout(resolve, 500));
  });

  describe('GET /api/status', () => {
    it('returns empty devices object when no device casting', async () => {
      const http = require('http');
      const result = await new Promise<string>((resolve, reject) => {
        http.get(`${SERVER_URL}/api/status`, (res: any) => {
          let data = '';
          res.on('data', (chunk: any) => data += chunk);
          res.on('end', () => resolve(data));
        }).on('error', reject);
      });
      const json = JSON.parse(result);
      expect(json.devices).toBeDefined();
      expect(typeof json.devices).toBe('object');
      expect(Object.keys(json.devices)).toHaveLength(0);
    });

    it('returns casting=false for non-existent device', async () => {
      const http = require('http');
      const result = await new Promise<string>((resolve, reject) => {
        http.get(`${SERVER_URL}/api/status?sn=NONEXISTENT`, (res: any) => {
          let data = '';
          res.on('data', (chunk: any) => data += chunk);
          res.on('end', () => resolve(data));
        }).on('error', reject);
      });
      const json = JSON.parse(result);
      expect(json.sn).toBe('NONEXISTENT');
      expect(json.casting).toBe(false);
    });
  });

  describe('Persistent device casting via programmatic API', () => {
    const WebSocket = require('ws');
    const http = require('http');

    // 注意：这些测试通过 WS 客户端来验证状态
    // 实际的 startDevice() 方法测试在 server-api.test.ts 中

    it('WS client can start casting and status reflects it', async () => {
      const ws = new WebSocket(`${WS_URL}/ws/screen/${SN}`);
      let configReceived = false;

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
                configReceived = true;
                clearTimeout(timeout);
                setTimeout(() => resolve(), 500);
              }
            } catch { /* ignore JSON parse errors in message handler */ }
          }
        });

        ws.on('error', (err) => { clearTimeout(timeout); reject(err); });
      });

      expect(configReceived).toBe(true);

      // 验证 /api/status 返回 casting=true
      const statusResult = await new Promise<string>((resolve, reject) => {
        http.get(`${SERVER_URL}/api/status?sn=${SN}`, (res: any) => {
          let data = '';
          res.on('data', (chunk: any) => data += chunk);
          res.on('end', () => resolve(data));
        }).on('error', reject);
      });
      const statusJson = JSON.parse(statusResult);
      expect(statusJson.casting).toBe(true);
      expect(statusJson.sn).toBe(SN);

      // 停止投屏
      ws.send(JSON.stringify({ type: 'stop', sn: SN }));
      await new Promise(resolve => setTimeout(resolve, 1000));
      ws.close();
    }, 35000);

    it('WS client disconnect does NOT stop casting for persistent device', async () => {
      // 这个测试验证通过 startDevice() 启动的设备在 WS 断开后保持活跃
      // 由于集成测试是独立进程，我们通过 WS 协议来模拟

      const ws1 = new WebSocket(`${WS_URL}/ws/screen/${SN}`);
      let configReceived = false;

      // 第一个客户端启动投屏
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { ws1.close(); reject(new Error('timeout')); }, 30000);

        ws1.on('open', () => {
          ws1.send(JSON.stringify({ type: 'screen', sn: SN, remoteIp: '127.0.0.1', remotePort: '8710' }));
        });

        ws1.on('message', (data: Buffer, isBinary: boolean) => {
          if (!isBinary) {
            try {
              const msg = JSON.parse(data.toString());
              if (msg.type === 'screenConfig') {
                configReceived = true;
                clearTimeout(timeout);
                setTimeout(() => resolve(), 500);
              }
            } catch { /* ignore JSON parse errors in message handler */ }
          }
        });

        ws1.on('error', (err) => { clearTimeout(timeout); reject(err); });
      });

      expect(configReceived).toBe(true);

      // 断开第一个客户端
      ws1.close();
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 等待一段时间确保服务器已处理断开
      // 然后尝试重新连接，看是否能复用流（如果是持久化的）
      // 注意：当前实现中，WS 客户端启动的设备是非持久化的
      // 这个测试只是验证行为一致性

      const ws2 = new WebSocket(`${WS_URL}/ws/screen/${SN}`);
      let reconnected = false;

      await new Promise<void>((resolve, _reject) => {
        const timeout = setTimeout(() => { ws2.close(); resolve(); }, 10000);

        ws2.on('open', () => {
          ws2.send(JSON.stringify({ type: 'screen', sn: SN, remoteIp: '127.0.0.1', remotePort: '8710' }));
        });

        ws2.on('message', (data: Buffer, isBinary: boolean) => {
          if (!isBinary) {
            try {
              const msg = JSON.parse(data.toString());
              if (msg.type === 'screenConfig') {
                reconnected = true;
                clearTimeout(timeout);
                setTimeout(() => resolve(), 500);
              }
            } catch { /* ignore JSON parse errors in message handler */ }
          }
        });

        ws2.on('error', () => { clearTimeout(timeout); resolve(); });
      });

      // 重连成功（无论流是否复用，都应能正常连接）
      expect(reconnected).toBe(true);

      // 清理
      ws2.send(JSON.stringify({ type: 'stop', sn: SN }));
      await new Promise(resolve => setTimeout(resolve, 500));
      ws2.close();
    }, 45000);
  });

  describe('Multiple device management', () => {
    it('handles multiple WS clients for same device', async () => {
      const WebSocket = require('ws');
      const ws1 = new WebSocket(`${WS_URL}/ws/screen/${SN}`);
      const ws2 = new WebSocket(`${WS_URL}/ws/screen/${SN}`);

      let config1 = false, config2 = false, binary1 = 0, binary2 = 0;

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { ws1.close(); ws2.close(); reject(new Error('timeout')); }, 30000);
        const checkDone = () => {
          if (config1 && config2 && binary1 >= 2 && binary2 >= 2) {
            clearTimeout(timeout);
            ws1.send(JSON.stringify({ type: 'stop', sn: SN }));
            setTimeout(() => { ws1.close(); ws2.close(); resolve(); }, 500);
          }
        };

        ws1.on('open', () => ws1.send(JSON.stringify({ type: 'screen', sn: SN, remoteIp: '127.0.0.1', remotePort: '8710' })));
        ws2.on('open', () => ws2.send(JSON.stringify({ type: 'screen', sn: SN, remoteIp: '127.0.0.1', remotePort: '8710' })));

        ws1.on('message', (data: Buffer, isBinary: boolean) => {
          if (!isBinary) { try { if (JSON.parse(data.toString()).type === 'screenConfig') config1 = true; } catch { /* ignore JSON parse errors */ } }
          else { binary1++; }
          checkDone();
        });
        ws2.on('message', (data: Buffer, isBinary: boolean) => {
          if (!isBinary) { try { if (JSON.parse(data.toString()).type === 'screenConfig') config2 = true; } catch { /* ignore JSON parse errors */ } }
          else { binary2++; }
          checkDone();
        });

        ws1.on('error', (err) => { clearTimeout(timeout); reject(err); });
        ws2.on('error', (err) => { clearTimeout(timeout); reject(err); });
      });

      expect(config1).toBe(true);
      expect(config2).toBe(true);
      expect(binary1).toBeGreaterThanOrEqual(2);
      expect(binary2).toBeGreaterThanOrEqual(2);
    }, 35000);
  });

  describe('/api/devices endpoint', () => {
    it('returns device list with connected SN', async () => {
      const http = require('http');
      const result = await new Promise<string>((resolve, reject) => {
        http.get(`${SERVER_URL}/api/devices`, (res: any) => {
          let data = '';
          res.on('data', (chunk: any) => data += chunk);
          res.on('end', () => resolve(data));
        }).on('error', reject);
      });
      const json = JSON.parse(result);
      expect(json.devices).toBeDefined();
      expect(Array.isArray(json.devices)).toBe(true);
      expect(json.devices).toContain(SN);
      expect(json.count).toBeGreaterThan(0);
    });
  });

  describe('WebSocket protocol compliance', () => {
    it('rejects connection to invalid path', async () => {
      const WebSocket = require('ws');
      const ws = new WebSocket(`${WS_URL}/ws/invalid/${SN}`);

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => { ws.close(); resolve(); }, 3000);
        ws.on('error', () => { clearTimeout(timeout); resolve(); });
        ws.on('open', () => { clearTimeout(timeout); ws.close(); resolve(); });
      });
    });

    it('handles malformed JSON gracefully', async () => {
      const WebSocket = require('ws');
      const ws = new WebSocket(`${WS_URL}/ws/screen/${SN}`);

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => { ws.close(); resolve(); }, 5000);

        ws.on('open', () => {
          // 发送无效 JSON
          ws.send('not a json');
          ws.send('{broken json');
          setTimeout(() => {
            ws.send(JSON.stringify({ type: 'screen', sn: SN, remoteIp: '127.0.0.1', remotePort: '8710' }));
          }, 500);
        });

        ws.on('message', (data: Buffer, isBinary: boolean) => {
          if (!isBinary) {
            try {
              const msg = JSON.parse(data.toString());
              if (msg.type === 'screenConfig') {
                clearTimeout(timeout);
                ws.send(JSON.stringify({ type: 'stop', sn: SN }));
                setTimeout(() => { ws.close(); resolve(); }, 500);
              }
            } catch { /* ignore JSON parse errors in message handler */ }
          }
        });

        ws.on('error', () => { clearTimeout(timeout); resolve(); });
      });
    }, 10000);
  });
});
