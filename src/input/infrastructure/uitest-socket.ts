/**
 * UiTest TCP 连接管理 — Socket 创建、发送、接收
 */

import * as net from 'net';

export function allocatePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address() as { port: number };
      server.close(() => resolve(port.port));
    });
    server.on('error', reject);
  });
}

export function connectSocket(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket();
    sock.setNoDelay(true);
    sock.connect(port, '127.0.0.1', () => resolve(sock));
    sock.on('error', reject);
  });
}

export function closeSocket(sock: net.Socket | null): void {
  if (sock) {
    try { sock.destroy(); } catch { /* ignore cleanup errors */ }
  }
}

/**
 * 发送普通请求并等待响应
 */
export function sendRequest(
  socket: net.Socket | null,
  isReady: boolean,
  request: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!socket || !isReady) {
      reject(new Error('Uitest not ready'));
      return;
    }
    const data = Buffer.from(request, 'utf-8');

    const onData = (buf: Buffer) => {
      socket!.off('data', onData);
      resolve(buf.toString('utf-8'));
    };

    const onError = (err: Error) => {
      socket!.off('data', onData);
      reject(err);
    };

    socket.once('data', onData);
    socket.once('error', onError);
    socket.write(data);
  });
}

/**
 * 发送 HEAD/TAIL 帧请求并等待布局响应
 */
export function sendLayoutRequest(
  socket: net.Socket | null,
  isReady: boolean,
  frame: Buffer,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!socket || !isReady) {
      reject(new Error('Uitest not ready'));
      return;
    }

    let chunks: Buffer[] = [];
    let _totalLen = 0;
    let found = false;

    const onData = (buf: Buffer) => {
      chunks.push(buf);
      _totalLen += buf.length;
      const combined = Buffer.concat(chunks);
      const text = combined.toString('utf-8');

      if (text.includes('_uitestkit_rpc_message_tail_')) {
        found = true;
        socket!.off('data', onData);
        resolve(text);
      }
    };

    const onError = (err: Error) => {
      socket!.off('data', onData);
      reject(err);
    };

    socket.on('data', onData);
    socket.once('error', onError);
    socket.write(frame);

    setTimeout(() => {
      if (!found) {
        socket!.off('data', onData);
        resolve('');
      }
    }, timeoutMs);
  });
}
