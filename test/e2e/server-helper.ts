import { spawn, ChildProcess } from 'child_process';
import * as net from 'net';
import * as path from 'path';

const E2E_PORT = 19300;
let _baseUrl = '';

export function getBaseUrl(): string { return _baseUrl; }

export async function startServer(): Promise<{ baseUrl: string; proc: ChildProcess }> {
  const templatesDir = path.resolve(__dirname, '../../templates');
  const proc = spawn('node', [
    'dist/bin/server.js',
    '--port', String(E2E_PORT),
    '--templates', templatesDir,
  ], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'], shell: false });

  await new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 15_000;
    const tryConnect = () => {
      if (Date.now() > deadline) { reject(new Error('Server did not start')); return; }
      const sock = new net.Socket();
      sock.connect(E2E_PORT, '127.0.0.1', () => { sock.destroy(); resolve(); });
      sock.on('error', () => { sock.destroy(); setTimeout(tryConnect, 300); });
    };
    tryConnect();
  });

  _baseUrl = `http://127.0.0.1:${E2E_PORT}`;
  return { baseUrl: _baseUrl, proc };
}

export async function stopServer(proc: ChildProcess): Promise<void> {
  if (proc) { try { proc.kill(); } catch {} }
}
