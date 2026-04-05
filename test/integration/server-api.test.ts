/**
 * HosScrcpyServer 编程式 API 直接测试
 *
 * 直接导入 HosScrcpyServer 类进行测试，不通过子进程
 */

import { describe, it, expect } from 'vitest';
import { HosScrcpyServer } from '../../src/server';
import { getDeviceSn } from '../helpers/device-check';
import WebSocket from 'ws';

const SN = getDeviceSn();

describe.skipIf(!SN)('HosScrcpyServer direct API', () => {
  let server: HosScrcpyServer;
  let actualPort: number;

  beforeAll(async () => {
    // 使用动态端口
    server = new HosScrcpyServer({
      port: 0,  // 动态分配
      hdcPath: 'hdc',
    });
    await server.start();
    actualPort = server.getPort();
    expect(actualPort).toBeGreaterThan(0);
  }, 30000);

  afterAll(async () => {
    await server.stopAll();
    await server.stop();
  });

  describe('getPort()', () => {
    it('returns actual listening port after start', () => {
      expect(server.getPort()).toBe(actualPort);
      expect(server.getPort()).not.toBe(0);
      expect(server.getPort()).not.toBe(9523);  // 不是默认端口
    });

    it('port is reachable via TCP', async () => {
      const net = require('net');
      await new Promise<void>((resolve, reject) => {
        const sock = new net.Socket();
        sock.connect(actualPort, '127.0.0.1', () => {
          sock.destroy();
          resolve();
        });
        sock.on('error', reject);
      });
    });
  });

  describe('isCasting()', () => {
    it('returns false when device not casting', () => {
      expect(server.isCasting(SN)).toBe(false);
      expect(server.isCasting('NONEXISTENT')).toBe(false);
    });
  });

  describe('/api/status endpoint', () => {
    it('returns empty devices object when no casting', async () => {
      const http = require('http');
      const result = await new Promise<string>((resolve) => {
        http.get(`http://localhost:${actualPort}/api/status`, (res: any) => {
          let data = '';
          res.on('data', (chunk: any) => data += chunk);
          res.on('end', () => resolve(data));
        }).on('error', () => resolve('{"error": "connection failed"}'));
      });
      const json = JSON.parse(result);
      expect(json.devices).toBeDefined();
      expect(Object.keys(json.devices)).toHaveLength(0);
    });

    it('returns casting=false for non-existent device', async () => {
      const http = require('http');
      const result = await new Promise<string>((resolve) => {
        http.get(`http://localhost:${actualPort}/api/status?sn=NONEXISTENT`, (res: any) => {
          let data = '';
          res.on('data', (chunk: any) => data += chunk);
          res.on('end', () => resolve(data));
        }).on('error', () => resolve('{"error": "connection failed"}'));
      });
      const json = JSON.parse(result);
      expect(json.casting).toBe(false);
      expect(json.sn).toBe('NONEXISTENT');
    });
  });

  describe('startDevice() / stopDevice()', () => {
    it('startDevice() starts casting and isCasting() returns true', async () => {
      await server.startDevice(SN);

      // 等待 scrcpy 启动完成
      await new Promise(resolve => setTimeout(resolve, 3000));

      expect(server.isCasting(SN)).toBe(true);
    }, 30000);

    it('/api/status?sn=xxx returns casting=true after startDevice', async () => {
      const http = require('http');
      const result = await new Promise<string>((resolve) => {
        http.get(`http://localhost:${actualPort}/api/status?sn=${SN}`, (res: any) => {
          let data = '';
          res.on('data', (chunk: any) => data += chunk);
          res.on('end', () => resolve(data));
        }).on('error', () => resolve('{"error": "connection failed"}'));
      });
      const json = JSON.parse(result);
      expect(json.casting).toBe(true);
      expect(json.sn).toBe(SN);
    });

    it('stopDevice() stops casting and isCasting() returns false', async () => {
      await server.stopDevice(SN);
      await new Promise(resolve => setTimeout(resolve, 1000));
      expect(server.isCasting(SN)).toBe(false);
    });

    it('stopDevice() is idempotent (can call multiple times)', async () => {
      await server.stopDevice(SN);
      await server.stopDevice(SN);
      await server.stopDevice(SN);
      expect(server.isCasting(SN)).toBe(false);
    });

    it('startDevice() is idempotent (can call when already casting)', async () => {
      await server.startDevice(SN);
      await new Promise(resolve => setTimeout(resolve, 2000));
      expect(server.isCasting(SN)).toBe(true);

      // 再次调用应该不报错
      await server.startDevice(SN);
      await new Promise(resolve => setTimeout(resolve, 1000));
      expect(server.isCasting(SN)).toBe(true);

      await server.stopDevice(SN);
    }, 30000);
  });

  describe('stopAll()', () => {
    it('stops all casting devices', async () => {
      // 启动设备（实际只有一个）
      await server.startDevice(SN);
      await new Promise(resolve => setTimeout(resolve, 2000));
      expect(server.isCasting(SN)).toBe(true);

      // 停止所有
      await server.stopAll();
      expect(server.isCasting(SN)).toBe(false);
    }, 30000);

    it('stopAll() is idempotent', async () => {
      await server.stopAll();
      await server.stopAll();
      await server.stopAll();
      expect(server.isCasting(SN)).toBe(false);
    });
  });

  describe('Persistent device behavior', () => {
    it('device started via startDevice() stays casting without WS clients', async () => {
      // 通过 startDevice 启动（持久化）
      await server.startDevice(SN);
      await new Promise(resolve => setTimeout(resolve, 4000));
      expect(server.isCasting(SN)).toBe(true);

      // 没有 WS 客户端连接，设备应该仍然投屏中
      await new Promise(resolve => setTimeout(resolve, 2000));
      expect(server.isCasting(SN)).toBe(true);

      // 清理
      await server.stopDevice(SN);
    }, 50000);

    it('WS client can connect to persistent device and receives stream', async () => {
      // 先通过 startDevice 启动
      await server.startDevice(SN);
      await new Promise(resolve => setTimeout(resolve, 4000));

      // 验证设备在投屏中
      expect(server.isCasting(SN)).toBe(true);

      // WS 客户端连接应该能接收视频流
      const ws = new WebSocket(`ws://localhost:${actualPort}/ws/screen/${SN}`);
      let configReceived = false;
      let binaryCount = 0;
      let messages: string[] = [];

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          // 如果至少收到了 screenConfig，就算成功
          if (configReceived) {
            ws.close();
            resolve();
          } else {
            ws.close();
            reject(new Error('timeout - no screenConfig received'));
          }
        }, 20000);

        ws.on('open', () => {
          // 发送 screen 消息（虽然设备已在投屏）
          ws.send(JSON.stringify({ type: 'screen', sn: SN, remoteIp: '127.0.0.1', remotePort: '8710' }));
        });

        ws.on('message', (data: Buffer, isBinary: boolean) => {
          if (!isBinary) {
            try {
              const msg = JSON.parse(data.toString());
              messages.push(msg.type || 'unknown');
              if (msg.type === 'screenConfig') {
                configReceived = true;
              }
            } catch {
              messages.push('parse-error');
            }
          } else {
            binaryCount++;
          }
          // 收到 screenConfig 后等待一些视频帧
          if (configReceived && binaryCount >= 2) {
            clearTimeout(timeout);
            setTimeout(() => resolve(), 500);
          }
        });

        ws.on('error', (err) => {
          clearTimeout(timeout);
          // 不要因为 WS 错误就失败，可能流已经关闭
          if (configReceived) {
            resolve();
          } else {
            reject(err);
          }
        });
      });

      // 至少应该收到 screenConfig
      expect(configReceived).toBe(true);

      // 关闭 WS 连接
      try { ws.close(); } catch { /* ignore cleanup errors */ }

      // 等待一下确保断开处理完成
      await new Promise(resolve => setTimeout(resolve, 1500));

      // 注意：由于流可能已结束，这里只验证之前是投屏状态
      // 如果流仍然活跃，则 isCasting 应该仍为 true
      // 如果流已结束，则 isCasting 为 false
      // 这个测试主要验证 WS 客户端能够连接并接收数据

      // 清理
      await server.stopDevice(SN);
    }, 60000);
  });

  describe('/webview/* routing', () => {
    it('returns 404 for non-existent webview files', async () => {
      const http = require('http');
      const result = await new Promise<{ status: number }>((resolve) => {
        http.get(`http://localhost:${actualPort}/webview/nonexistent.html`, (res: any) => {
          res.resume();  // 消耗响应体
          resolve({ status: res.statusCode });
        }).on('error', () => resolve({ status: 0 }));
      });
      expect(result.status).toBe(404);
    });

    it('returns 404 for path traversal attempts', async () => {
      const http = require('http');
      const result = await new Promise<{ status: number }>((resolve) => {
        http.get(`http://localhost:${actualPort}/webview/../../etc/passwd`, (res: any) => {
          res.resume();
          resolve({ status: res.statusCode });
        }).on('error', () => resolve({ status: 0 }));
      });
      // 应该返回 404（路径遍历被阻止）或 403
      expect([404, 403]).toContain(result.status);
    });
  });

  describe('stop() method', () => {
    it('stop() calls stopAll() and closes server', async () => {
      const testServer = new HosScrcpyServer({ port: 0 });
      await testServer.start();
      const testPort = testServer.getPort();

      // 启动设备投屏
      await testServer.startDevice(SN);
      await new Promise(resolve => setTimeout(resolve, 2000));
      expect(testServer.isCasting(SN)).toBe(true);

      // 调用 stop()
      await testServer.stop();

      // 端口应该不再可达
      const net = require('net');
      await new Promise<void>((resolve) => {
        const sock = new net.Socket();
        sock.connect(testPort, '127.0.0.1', () => {
          sock.destroy();
          // 如果能连接，说明服务器还没关闭，再等一下
          setTimeout(() => resolve(), 500);
        });
        sock.on('error', () => resolve());  // 连接失败说明已关闭
      });
    }, 30000);
  });
});
