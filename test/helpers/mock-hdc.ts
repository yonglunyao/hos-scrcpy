import { ChildProcess } from 'child_process';

export class MockHdcClient {
  private shellResponses: Map<string, string> = new Map();
  private shellCalls: string[] = [];
  private createdForwards: Array<{ localPort: number; remotePort?: number; abstractSocket?: string }> = [];
  private removedForwards: Array<{ localPort: number; remotePort?: number; abstractSocket?: string }> = [];
  private pushedFiles: Array<{ local: string; remote: string }> = [];

  constructor(responses?: Record<string, string>) {
    if (responses) {
      for (const [key, val] of Object.entries(responses)) {
        this.shellResponses.set(key, val);
      }
    }
  }

  setShellResponse(pattern: string, response: string): void {
    this.shellResponses.set(pattern, response);
  }

  getShellCalls(): string[] {
    return [...this.shellCalls];
  }

  getCreatedForwards() {
    return [...this.createdForwards];
  }

  getRemovedForwards() {
    return [...this.removedForwards];
  }

  getPushedFiles() {
    return [...this.pushedFiles];
  }

  async shell(command: string, _timeoutSec?: number): Promise<string> {
    this.shellCalls.push(command);
    // Find response by substring match (longest match first)
    let bestMatch = '';
    let bestResponse = '';
    for (const [pattern, response] of this.shellResponses) {
      if (command.includes(pattern) && pattern.length > bestMatch.length) {
        bestMatch = pattern;
        bestResponse = response;
      }
    }
    return bestResponse;
  }

  async spawnShell(command: string): Promise<{ kill: () => void }> {
    this.shellCalls.push(`spawn:${command}`);
    return { kill: () => {} };
  }

  async createForward(localPort: number, remotePort: number): Promise<string> {
    this.createdForwards.push({ localPort, remotePort });
    return `tcp:${localPort} tcp:${remotePort}`;
  }

  async createAbstractForward(localPort: number, abstractSocket: string): Promise<string> {
    this.createdForwards.push({ localPort, abstractSocket });
    return `tcp:${localPort} localabstract:${abstractSocket}`;
  }

  async removeForward(localPort: number, remotePort: number): Promise<string> {
    this.removedForwards.push({ localPort, remotePort });
    return '';
  }

  async removeAbstractForward(localPort: number, abstractSocket: string): Promise<string> {
    this.removedForwards.push({ localPort, abstractSocket });
    return '';
  }

  async pushFile(localPath: string, remotePath: string): Promise<string> {
    this.pushedFiles.push({ local: localPath, remote: remotePath });
    return '';
  }

  async listTargets(): Promise<string[]> {
    return ['TEST_DEVICE'];
  }

  async isOnline(): Promise<boolean> {
    return true;
  }

  getSn(): string { return 'TEST_DEVICE'; }
  getIp(): string { return '127.0.0.1'; }
}
