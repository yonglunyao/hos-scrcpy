import { spawn, SpawnOptions, ChildProcess } from 'child_process';

export interface HdcOptions {
  hdcPath: string;
  ip?: string;
  sn: string;
  port?: number; // hdc port, default 8710
}

/**
 * HDC CLI 封装 — HarmonyOS Device Connector 命令行工具
 */
export class HdcClient {
  private hdcPath: string;
  private ip: string;
  private sn: string;
  private port: number;

  constructor(opts: HdcOptions) {
    this.hdcPath = opts.hdcPath;
    this.ip = opts.ip || '127.0.0.1';
    this.sn = opts.sn;
    this.port = opts.port || 8710;
  }

  private buildArgs(extraArgs: string): string[] {
    return [this.hdcPath, ...extraArgs.split(' ')];
  }

  async exec(command: string, timeoutSec = 8): Promise<string> {
    const args = this.buildArgs(command);
    return this.execRaw(args, timeoutSec);
  }

  private execRaw(args: string[], timeoutSec: number): Promise<string> {
    return new Promise((resolve) => {
      let output = '';
      let killed = false;

      const proc = spawn(args[0]!, args.slice(1), {
        windowsHide: true,
        shell: false,
      } as SpawnOptions);

      const timer = setTimeout(() => {
        killed = true;
        proc.kill('SIGKILL');
      }, timeoutSec * 1000);

      proc.stdout?.on('data', (data: Buffer) => {
        output += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        output += data.toString();
      });

      proc.on('close', () => {
        clearTimeout(timer);
        resolve(output);
      });

      proc.on('error', () => {
        clearTimeout(timer);
        resolve(output);
      });
    });
  }

  /** hdc shell <command> */
  async shell(command: string, timeoutSec = 8): Promise<string> {
    return this.exec(`-s ${this.ip}:${this.port} -t ${this.sn} shell ${command}`, timeoutSec);
  }

  /**
   * 启动持久 shell 命令（如 scrcpy），保持 hdc 进程存活以维持设备端进程。
   * 返回 ChildProcess 引用，调用者负责在不需要时 kill。
   */
  spawnShell(command: string): ChildProcess {
    const args = [
      this.hdcPath, '-s', `${this.ip}:${this.port}`, '-t', this.sn,
      'shell', command,
    ];
    const proc = spawn(args[0]!, args.slice(1), {
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    proc.stdout?.on('data', () => {});
    proc.stderr?.on('data', () => {});
    return proc;
  }

  /** hdc list targets */
  async listTargets(): Promise<string[]> {
    const result = await this.exec('list targets');
    return result
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('[') && !l.includes('must <'));
  }

  /** 检查设备是否在线 */
  async isOnline(): Promise<boolean> {
    const targets = await this.listTargets();
    return targets.some(t => t === this.sn);
  }

  /** hdc fport create */
  async createForward(localPort: number, remotePort: number): Promise<string> {
    return this.exec(
      `-s ${this.ip}:${this.port} -t ${this.sn} fport tcp:${localPort} tcp:${remotePort}`
    );
  }

  /** hdc fport create (abstract socket, 用于新版 uitest/scrcpy) */
  async createAbstractForward(localPort: number, abstractSocket: string): Promise<string> {
    return this.exec(
      `-s ${this.ip}:${this.port} -t ${this.sn} fport tcp:${localPort} localabstract:${abstractSocket}`
    );
  }

  /** hdc fport remove */
  async removeForward(localPort: number, remotePort: number): Promise<string> {
    return this.exec(
      `-s ${this.ip}:${this.port} -t ${this.sn} fport rm tcp:${localPort} tcp:${remotePort}`
    );
  }

  /** hdc fport remove (abstract socket) */
  async removeAbstractForward(localPort: number, abstractSocket: string): Promise<string> {
    return this.exec(
      `-s ${this.ip}:${this.port} -t ${this.sn} fport rm tcp:${localPort} localabstract:${abstractSocket}`
    );
  }

  /** hdc file send */
  async pushFile(localPath: string, remotePath: string): Promise<string> {
    return this.exec(
      `-s ${this.ip}:${this.port} -t ${this.sn} file send ${localPath} ${remotePath}`,
      30
    );
  }

  /** hdc file recv */
  async pullFile(remotePath: string, localPath: string): Promise<string> {
    return this.exec(
      `-s ${this.ip}:${this.port} -t ${this.sn} file recv ${remotePath} ${localPath}`,
      30
    );
  }

  getSn(): string { return this.sn; }
  getIp(): string { return this.ip; }
}
