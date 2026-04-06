/**
 * WebSocket 消息路由 — 处理投屏、输入、按键等 WS 消息
 */

import { WebSocket } from 'ws';
import * as http from 'http';
import { DeviceContext } from '../device/context';
import { IDeviceFactory } from '../device/interfaces';
import { getHdcKeyCode } from '../input/keycode';
import { createChildLogger } from '../shared/logger';
import type { ServerConfig } from '../shared/types';
import {
  DEFAULT_HDC_PORT,
  DEFAULT_SCALE,
  DEFAULT_FRAME_RATE,
  DEFAULT_BIT_RATE_MBPS,
  UINPUT_TOUCH_TIMEOUT_SEC,
} from '../constants';

const logger = createChildLogger('WsHandler');

/**
 * WebSocket 消息类型定义
 */
export interface WsMessage {
  type: 'screen' | 'uitest' | 'touchEvent' | 'keyCode' | 'stop';
  sn?: string;
  remoteIp?: string;
  remotePort?: string;
  message?: WsMessageData;
}

export interface WsMessageData {
  event?: 'down' | 'up' | 'move';
  x?: number;
  y?: number;
  key?: string;
  code?: string;
  [key: string]: unknown;
}

export class WsHandler {
  private clientIdCounter = 0;
  private clientToDevice = new Map<string, string>();

  constructor(
    private config: ServerConfig,
    private devices: Map<string, DeviceContext>,
    private factory: IDeviceFactory,
  ) {}

  handleConnection(ws: WebSocket, req: http.IncomingMessage): void {
    const urlPath = req.url || '/';
    logger.debug(`[WS] Client connected: ${urlPath}`);

    const clientId = `ws-${++this.clientIdCounter}-${Date.now()}`;
    const parts = urlPath.split('/').filter(Boolean);
    const urlSn = parts.length >= 3 ? parts[2]! : '';

    ws.on('message', async (raw) => {
      try {
        const message = typeof raw === 'string' ? raw : raw.toString('utf-8');
        await this.handleMessage(ws, message, urlSn, clientId);
      } catch (err) {
        const errorResponse = JSON.stringify({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(errorResponse);
        }
        logger.error({ err, clientId }, 'Message handler error');
      }
    });

    ws.on('close', async (code: number, reason: Buffer) => {
      const reasonStr = reason ? reason.toString('utf8') : '';
      logger.debug(`[WS] Client disconnected: ${clientId}, code: ${code}, reason: ${reasonStr || 'none'}`);
      const sn = this.clientToDevice.get(clientId);
      if (sn) {
        const ctx = this.devices.get(sn);
        if (ctx) {
          ctx.stopCaptureForWs(ws);
          await ctx.removeClient(clientId);
          if (ctx.getClientCount() === 0 && !ctx.isPersistent()) {
            logger.debug({ sn }, 'No more clients for device, cleaning up');
            this.devices.delete(sn);
            ctx.stop().catch(() => logger.warn({ sn }, 'Cleanup error during device stop'));
          } else if (ctx.getClientCount() === 0 && ctx.isPersistent()) {
            logger.debug(`[WS] No more clients for persistent device ${sn}, keeping stream alive`);
          }
        }
        this.clientToDevice.delete(clientId);
      }
    });
  }

  private async handleMessage(ws: WebSocket, message: string, urlSn?: string, clientId?: string): Promise<void> {
    let jsonMsg: WsMessage;
    try {
      jsonMsg = JSON.parse(message.replace(/\\/g, '\\\\')) as WsMessage;
    } catch {
      throw new Error('Invalid JSON message');
    }

    // Validate message structure
    if (!jsonMsg || typeof jsonMsg !== 'object') {
      throw new Error('Message must be an object');
    }

    if (!jsonMsg.type || typeof jsonMsg.type !== 'string') {
      throw new Error('Message must have a valid type field');
    }

    const validTypes = ['screen', 'uitest', 'touchEvent', 'keyCode', 'stop'];
    if (!validTypes.includes(jsonMsg.type)) {
      throw new Error(`Invalid message type: ${jsonMsg.type}. Valid types: ${validTypes.join(', ')}`);
    }

    const type: string = jsonMsg.type;
    const sn: string = jsonMsg.sn || urlSn || '';
    const remoteIp: string = jsonMsg.remoteIp || '';
    const remotePort: string = jsonMsg.remotePort || '';
    const msg: Record<string, unknown> = jsonMsg.message || {};

    if (type === 'screen') {
      await this.handleScreenCast(ws, sn, remoteIp, remotePort, msg, clientId);
    } else if (type === 'uitest') {
      await this.handleUitestCast(ws, sn, remoteIp, remotePort, msg);
    } else if (type === 'touchEvent') {
      await this.handleTouchEvent(sn, msg);
    } else if (type === 'keyCode') {
      await this.handleKeyCode(sn, msg);
    } else if (type === 'stop') {
      await this.handleStop(sn);
    }
  }

  private async handleScreenCast(
    ws: WebSocket, sn: string, remoteIp: string, remotePort: string,
    _msg: Record<string, unknown>, clientId?: string,
  ): Promise<void> {
    const ctx = await this.getOrCreateDevice(sn, remoteIp, remotePort, clientId);
    await ctx.startScreenCast(ws, clientId);
  }

  private async handleUitestCast(
    ws: WebSocket, sn: string, remoteIp: string, remotePort: string,
    _msg: Record<string, unknown>,
  ): Promise<void> {
    const ctx = await this.getOrCreateDevice(sn, remoteIp, remotePort);
    await ctx.startUitestCast(ws);
  }

  private async handleTouchEvent(sn: string, msg: Record<string, unknown>): Promise<void> {
    // Validate required fields
    if (!msg.event || typeof msg.event !== 'string') {
      throw new Error('touchEvent message must have an event field (down/up/move)');
    }
    if (typeof msg.x !== 'number' || typeof msg.y !== 'number') {
      throw new Error('touchEvent message must have numeric x and y fields');
    }

    const validEvents = ['down', 'up', 'move'];
    if (!validEvents.includes(msg.event)) {
      throw new Error(`Invalid touch event: ${msg.event}. Valid events: ${validEvents.join(', ')}`);
    }

    const ctx = this.devices.get(sn);
    logger.debug(`[WS] touch event: sn=${sn}, ctx=${!!ctx}, uitestRunning=${ctx?.uitest?.isUitestRunning()}`);
    if (!ctx?.uitest?.isUitestRunning()) {
      logger.warn(`[WS] touch event ignored: uitest not running`);
      return;
    }

    const event = msg.event as string;
    const x = msg.x as number;
    const y = msg.y as number;
    logger.debug(`[WS] touch: ${event} at (${x}, ${y})`);

    try {
      if (event === 'down') {
        await ctx.uitest.touchDown(x, y);
      } else if (event === 'up') {
        await ctx.uitest.touchUp(x, y);
      } else if (event === 'move') {
        await ctx.uitest.touchMove(x, y);
      }
    } catch (err: any) {
      logger.error(`[WS] touch ${event} error:`, err.message);
    }
  }

  private async handleKeyCode(sn: string, msg: Record<string, unknown>): Promise<void> {
    // Validate required fields
    if (!msg.key || typeof msg.key !== 'string') {
      throw new Error('keyCode message must have a key field');
    }
    if (!msg.code || typeof msg.code !== 'string') {
      throw new Error('keyCode message must have a code field');
    }

    const ctx = this.devices.get(sn);
    if (!ctx) return;

    const key = msg.key as string;
    const code = msg.code as string;
    const hdcCode = getHdcKeyCode(key, code);
    if (hdcCode !== null) {
      const handled = ctx.uitest?.isUitestRunning() ? await ctx.uitest.pressKey(hdcCode) : false;
      if (!handled) {
        await ctx.manager.shell(`uinput -K -d ${hdcCode} -u ${hdcCode}`, UINPUT_TOUCH_TIMEOUT_SEC);
      }
    }
  }

  private async handleStop(sn: string): Promise<void> {
    const ctx = this.devices.get(sn);
    if (!ctx) return;
    await ctx.stop();
    this.devices.delete(sn);
  }

  private async getOrCreateDevice(
    sn: string, remoteIp: string, remotePort: string, clientId?: string,
  ): Promise<DeviceContext> {
    let ctx = this.devices.get(sn);
    if (ctx) {
      if (clientId) {
        ctx.addClient(clientId);
        this.clientToDevice.set(clientId, sn);
      }
      return ctx;
    }

    const newCtx = this.factory.createDeviceContext({
      sn,
      ip: remoteIp || '127.0.0.1',
      hdcPath: this.config.hdcPath,
      hdcPort: remotePort ? parseInt(remotePort, 10) : DEFAULT_HDC_PORT,
      scale: DEFAULT_SCALE,
      frameRate: DEFAULT_FRAME_RATE,
      bitRate: DEFAULT_BIT_RATE_MBPS,
    });
    ctx = newCtx as DeviceContext;

    if (clientId) {
      ctx.addClient(clientId);
      this.clientToDevice.set(clientId, sn);
    }
    this.devices.set(sn, ctx);
    return ctx;
  }
}
