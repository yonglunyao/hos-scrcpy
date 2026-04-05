import * as http2 from 'http2';
import { IDeviceManager, IScrcpyStream } from '../device/interfaces';
import { decodeReplyMessage } from './protobuf';
import { ConnectionTimeoutError, ScrcpyStartupError } from '../errors';
import {
  HTTP2_CONNECT_TIMEOUT_MS,
  HTTP2_INITIAL_WINDOW_SIZE,
  GRPC_MAX_RECEIVE_MESSAGE_LENGTH,
} from '../constants';

type DataCallback = (data: Buffer) => void;
type ReadyCallback = () => void;
type ErrorCallback = (err: Error) => void;

/**
 * HTTP/2 gRPC 客户端 — 替代 @grpc/grpc-js
 *
 * Java demoWithoutRecord 使用 grpc-java BlockingStub 正常工作。
 * @grpc/grpc-js 的 async observer 模式无法接收 HarmonyOS gRPC 数据。
 *
 * 本实现使用 Node.js 内置 http2 模块手动处理：
 * 1. HTTP/2 连接建立 (PRI * HTTP/2.0 preface + SETTINGS)
 * 2. 发送 gRPC POST 请求 (HEADERS + DATA)
 * 3. 接收 server-streaming 响应 (DATA 帧包含 gRPC 帧)
 * 4. 解析 gRPC 5字节帧前缀 + protobuf ReplyMessage
 */
export class DirectScrcpyStream implements IScrcpyStream {
  private device: IDeviceManager;
  private session: http2.ClientHttp2Session | null = null;
  private stream: http2.ClientHttp2Stream | null = null;
  private stopFlag = false;
  private frameBuffer = Buffer.alloc(0);
  private onData: DataCallback | null = null;
  private onReady: ReadyCallback | null = null;
  private onError: ErrorCallback | null = null;

  constructor(device: IDeviceManager) {
    this.device = device;
  }

  async start(opts: {
    onData: DataCallback;
    onReady: ReadyCallback;
    onError: ErrorCallback;
  }): Promise<void> {
    this.onData = opts.onData;
    this.onReady = opts.onReady;
    this.onError = opts.onError;
    this.stopFlag = false;
    this.frameBuffer = Buffer.alloc(0);

    const forwardPort = this.device.getScrcpyForwardPort();
    if (forwardPort === 0) {
      throw new ScrcpyStartupError('forward port not set');
    }

    const target = `http://127.0.0.1:${forwardPort}`;
    console.log(`[DirectScrcpy] connecting to ${target}`);

    // 1. 建立 HTTP/2 连接 (h2c prior knowledge)
    this.session = http2.connect(target, {
      settings: {
        enablePush: false,
        initialWindowSize: HTTP2_INITIAL_WINDOW_SIZE, // 16MB for large video frames
      },
    });

    this.session.on('error', (err) => {
      console.error('[DirectScrcpy] HTTP/2 session error:', err.message);
      if (!this.stopFlag) {
        this.onError?.(err);
      }
    });

    this.session.on('close', () => {
      console.log('[DirectScrcpy] HTTP/2 session closed');
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new ConnectionTimeoutError('HTTP/2 connect', HTTP2_CONNECT_TIMEOUT_MS)), HTTP2_CONNECT_TIMEOUT_MS);
      this.session!.once('connect', () => {
        clearTimeout(timeout);
        console.log('[DirectScrcpy] HTTP/2 connected');
        resolve();
      });
      this.session!.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    // 2. 发送 gRPC 请求
    this.stream = this.session.request({
      ':method': 'POST',
      ':path': '/ScrcpyService/onStart',
      ':scheme': 'http',
      ':authority': `127.0.0.1:${forwardPort}`,
      'content-type': 'application/grpc',
      'te': 'trailers',
      'grpc-encoding': 'identity',
      'user-agent': 'hos-scrcpy-ts/1.0',
      'grpc.max_receive_message_length': String(GRPC_MAX_RECEIVE_MESSAGE_LENGTH),
    });

    // 3. 发送空 gRPC 请求帧: 1字节压缩标志(0) + 4字节长度(0)
    const grpcFrame = Buffer.alloc(5);
    this.stream.write(grpcFrame);
    this.stream.end();

    console.log('[DirectScrcpy] gRPC request sent to /ScrcpyService/onStart');

    // 4. 处理响应
    this.stream.on('response', (headers) => {
      console.log('[DirectScrcpy] gRPC response headers:', JSON.stringify(headers));
    });

    this.stream.on('data', (chunk: Buffer) => {
      if (this.stopFlag) return;
      this.frameBuffer = Buffer.concat([this.frameBuffer, chunk]);
      this.processFrames();
    });

    this.stream.on('trailers', (trailers) => {
      console.log('[DirectScrcpy] gRPC trailers:', JSON.stringify(trailers));
    });

    this.stream.on('end', () => {
      console.log('[DirectScrcpy] stream ended');
      // 处理剩余 buffer
      if (this.frameBuffer.length > 0) {
        this.processFrames();
      }
    });

    this.stream.on('error', (err) => {
      console.error('[DirectScrcpy] stream error:', err.message);
      if (!this.stopFlag) {
        this.onError?.(new Error(`gRPC stream error: ${err.message}`));
      }
    });

    this.stream.on('close', () => {
      console.log('[DirectScrcpy] stream closed');
    });

    // 5. 唤醒屏幕并通知就绪
    this.device.wakeUp().catch(() => {});
    this.onReady?.();
    console.log('[DirectScrcpy] ready');
  }

  /**
   * 从 frameBuffer 中解析 gRPC 帧，提取 H.264 视频数据
   *
   * gRPC 帧格式: [compressed:1][length:4BE][protobuf_message:length]
   * HTTP/2 DATA 帧可能包含不完整的 gRPC 帧，需要累积 buffer
   */
  private processFrames(): void {
    while (this.frameBuffer.length >= 5) {
      const _compressed = this.frameBuffer[0]!;
      const msgLength = this.frameBuffer.readUInt32BE(1);

      if (this.frameBuffer.length < 5 + msgLength) {
        // 不完整的帧，等待更多数据
        break;
      }

      const protobufData = this.frameBuffer.subarray(5, 5 + msgLength);
      this.frameBuffer = this.frameBuffer.subarray(5 + msgLength);

      this.handleGrpcMessage(protobufData);
    }
  }

  private handleGrpcMessage(protobufData: Buffer): void {
    try {
      const msg = decodeReplyMessage(protobufData);

      // 提取 payload["data"].val_bytes → H.264 视频数据
      const dataPayload = msg.payload.get('data');
      if (dataPayload?.valBytes && dataPayload.valBytes.length > 0) {
        this.onData?.(Buffer.from(dataPayload.valBytes));
      }
    } catch (e) {
      console.error('[DirectScrcpy] protobuf decode error:', (e as Error).message);
    }
  }

  /**
   * 请求 IDR 帧
   */
  async requestIdrFrame(): Promise<void> {
    if (!this.session) return;

    const forwardPort = this.device.getScrcpyForwardPort();
    const req = this.session.request({
      ':method': 'POST',
      ':path': '/ScrcpyService/onRequestIDRFrame',
      ':scheme': 'http',
      ':authority': `127.0.0.1:${forwardPort}`,
      'content-type': 'application/grpc',
      'te': 'trailers',
      'grpc-encoding': 'identity',
    });

    const grpcFrame = Buffer.alloc(5);
    req.write(grpcFrame);
    req.end();

    req.on('response', (headers) => {
      console.log('[DirectScrcpy] IDR response:', JSON.stringify(headers));
    });

    req.on('end', () => {
      req.close();
    });
  }

  async stop(): Promise<void> {
    this.stopFlag = true;

    if (this.stream) {
      try { this.stream.close(); } catch { /* ignore cleanup errors */ }
      this.stream = null;
    }

    if (this.session) {
      try { this.session.close(); } catch { /* ignore cleanup errors */ }
      this.session = null;
    }

    this.frameBuffer = Buffer.alloc(0);
  }
}
