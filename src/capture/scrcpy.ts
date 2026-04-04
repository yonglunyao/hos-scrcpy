import * as grpc from '@grpc/grpc-js';
import { DeviceManager } from '../device/manager';
import {
  decodeReplyMessage,
  encodeEmpty,
  encodeGrpcMessage,
} from './protobuf';

type DataCallback = (data: Buffer) => void;
type ReadyCallback = () => void;
type ErrorCallback = (err: Error) => void;

/**
 * Scrcpy 视频流 — 通过 @grpc/grpc-js 连接 scrcpy gRPC server
 *
 * 使用标准 HTTP/2 + gRPC 协议，与 Java ManagedChannelBuilder.usePlaintext() 兼容。
 */
export class ScrcpyStream {
  private device: DeviceManager;
  private client: grpc.Client | null = null;
  private call: grpc.ClientReadableStream<any> | null = null;
  private stopFlag = false;
  private onData: DataCallback | null = null;
  private onReady: ReadyCallback | null = null;
  private onError: ErrorCallback | null = null;

  constructor(device: DeviceManager) {
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

    const forwardPort = this.device.getScrcpyForwardPort();
    if (forwardPort === 0) {
      throw new Error('Scrcpy forward port not set');
    }

    const target = `127.0.0.1:${forwardPort}`;
    console.log(`[ScrcpyStream] connecting to ${target}`);

    this.client = new grpc.Client(
      target,
      grpc.credentials.createInsecure(),
      { 'grpc.max_receive_message_length': 104857600 }
    );

    // /ScrcpyService/onStart — server streaming, Empty request
    console.log('[ScrcpyStream] creating gRPC call to /ScrcpyService/onStart');
    this.call = this.client.makeServerStreamRequest(
      '/ScrcpyService/onStart',
      () => Buffer.alloc(0), // Empty serializer
      (buf: Buffer) => buf,  // raw deserializer
      {} // Empty message
    );
    console.log('[ScrcpyStream] gRPC call created');

    this.call.on('data', (data: Buffer) => {
      console.log('[ScrcpyStream] DATA RECEIVED:', data.length, 'bytes, stopFlag:', this.stopFlag, ', hasOnData:', !!this.onData);
      if (this.stopFlag || !this.onData) return;

      try {
        const msg = decodeReplyMessage(data);
        console.log('[ScrcpyStream] decoded message, data field:', msg.data);
        const dataPayload = msg.payload.get('data');
        if (dataPayload?.valBytes && dataPayload.valBytes.length > 0) {
          console.log('[ScrcpyStream] sending H.264 data:', dataPayload.valBytes.length, 'bytes');
          this.onData(Buffer.from(dataPayload.valBytes));
        } else {
          console.log('[ScrcpyStream] no H.264 data in payload, keys:', Array.from(msg.payload.keys()));
        }
      } catch (e) {
        console.log('[ScrcpyStream] decode error, sending raw:', (e as Error).message);
        this.onData(data);
      }
    });

    this.call.on('error', (err: any) => {
      console.error('[ScrcpyStream] error:', err.code, err.message, err.details);
      if (!this.stopFlag) {
        this.onError?.(new Error(`gRPC error: ${err.code} ${err.message}`));
      }
    });

    this.call.on('end', () => {
      console.log('[ScrcpyStream] stream ended');
    });

    this.call.on('status', (status: any) => {
      console.log('[ScrcpyStream] status:', status.code, status.details, status.metadata);
    });

    // Wake up screen and notify ready
    this.device.wakeUp().catch(() => {});
    this.onReady?.();
    console.log('[ScrcpyStream] ready');
  }

  async requestIdrFrame(): Promise<void> {
    if (!this.client) return;
    try {
      this.client.makeUnaryRequest(
        '/ScrcpyService/onRequestIDRFrame',
        () => Buffer.alloc(0),
        (buf: Buffer) => buf,
        {},
        (err, value) => {
          if (err) console.warn('[ScrcpyStream] IDR request error:', err.message);
        }
      );
    } catch {}
  }

  async stop(): Promise<void> {
    this.stopFlag = true;
    if (this.call) {
      try { this.call.cancel(); } catch {}
      this.call = null;
    }
    if (this.client) {
      try { this.client.close(); } catch {}
      this.client = null;
    }
  }
}
