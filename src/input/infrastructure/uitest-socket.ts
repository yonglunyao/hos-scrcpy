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
 * 每个 socket 的响应累积缓冲。
 *
 * daemon 响应为单行 JSON(以 \n 结尾)。TCP 会分包/合包,导致一个 `data` 事件
 * 未必等于一条完整响应。这里按 \n 切分、跨事件累积,保证连续请求不错位。
 */
const respBuffers = new WeakMap<net.Socket, string>();

/**
 * 发送普通请求并等待一行响应(按 \n 切分,正确处理 TCP 分包/合包)。
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
    const sock = socket;

    const onData = (chunk: Buffer) => {
      const acc = (respBuffers.get(sock) ?? '') + chunk.toString('utf-8');
      const nl = acc.indexOf('\n');
      if (nl >= 0) {
        respBuffers.set(sock, acc.slice(nl + 1));
        sock.off('data', onData);
        sock.off('error', onError);
        resolve(acc.slice(0, nl));
      } else {
        respBuffers.set(sock, acc);
      }
    };
    const onError = (err: Error) => {
      sock.off('data', onData);
      reject(err);
    };

    sock.on('data', onData);
    sock.once('error', onError);
    sock.write(Buffer.from(request, 'utf-8'));
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
