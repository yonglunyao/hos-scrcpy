/**
 * HTTP 路由处理 — API 端点、静态文件、默认页面
 */

import * as http from 'http';
import { createChildLogger } from '../shared/logger';
import type { ServerConfig } from '../shared/types';
import { serveStaticFile, getDefaultHtml } from './static-files';

const logger = createChildLogger('HttpHandler');

export class HttpHandler {
  constructor(
    private config: ServerConfig,
    private devices: Map<string, unknown>,
    private isCasting: (sn: string) => boolean,
  ) {}

  async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = req.url || '/';
    logger.debug(`[HTTP] ${req.method} ${url}`);

    if (url === '/api/devices' || url === '/api/devices/') {
      await this.handleApiDevices(req, res);
      return;
    }

    if (url.startsWith('/api/status')) {
      this.handleApiStatus(req, res);
      return;
    }

    if (serveStaticFile(this.config.templatesDir, url, res)) {
      return;
    }

    if (url === '/') {
      const port = 9523; // default, actual port set by caller
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getDefaultHtml(port));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  }

  private async handleApiDevices(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const { exec } = require('child_process');
      const hdc = this.config.hdcPath;
      const result = await new Promise<string>((resolve) => {
        exec(`${hdc} list targets`, (err: Error | null, stdout: string) => {
          resolve(stdout);
        });
      });
      const devices = result
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0 && !l.startsWith('['));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ devices, count: devices.length }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(err) }));
    }
  }

  private handleApiStatus(req: http.IncomingMessage, res: http.ServerResponse): void {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const sn = url.searchParams.get('sn');

      res.writeHead(200, { 'Content-Type': 'application/json' });

      if (sn) {
        const casting = this.isCasting(sn);
        res.end(JSON.stringify({ casting, sn }));
      } else {
        const devices: Record<string, { casting: boolean }> = {};
        for (const [deviceSn, ctx] of this.devices.entries()) {
          const dc = ctx as { isScrcpyStarted: () => boolean };
          devices[deviceSn] = { casting: dc.isScrcpyStarted() };
        }
        res.end(JSON.stringify({ devices }));
      }
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(err) }));
    }
  }
}
