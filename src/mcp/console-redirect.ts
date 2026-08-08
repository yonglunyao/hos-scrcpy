/**
 * MCP stdio 模式下的 stdout 净化。
 *
 * MCP 协议承载在 stdout 上,任何应用自身的 stdout 输出都会破坏协议。
 * hos-scrcpy 的 logger(shared/logger.ts)以及 device-manager / uitest-server
 * 里大量直接调用 console.log/info/warn,因此在此把这些方法重定向到 stderr。
 * console.error 本就走 stderr,保持原样。
 *
 * 该模块作为入口最先 import,在模块求值时自动生效(幂等)。
 */

let installed = false;

function formatArg(arg: unknown): string {
  if (arg instanceof Error) {
    return `${arg.message}${arg.stack ? `\n${arg.stack}` : ''}`;
  }
  if (typeof arg === 'object' && arg !== null) {
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }
  return String(arg);
}

export function redirectConsoleToStderr(): void {
  if (installed) return;
  installed = true;

  const redirect = (level: string): typeof console.log =>
    (...args: unknown[]): void => {
      process.stderr.write(`[hos-scrcpy:${level}] ${args.map(formatArg).join(' ')}\n`);
    };

  console.log = redirect('log');
  console.info = redirect('info');
  console.debug = redirect('debug');
  console.warn = redirect('warn');
}

// 模块求值即生效,确保在入口最先 import 此文件即可净化 stdout
redirectConsoleToStderr();
