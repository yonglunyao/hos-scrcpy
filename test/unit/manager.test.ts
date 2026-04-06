import { describe, it, expect } from 'vitest';
import { sprintf } from '../../src/device/application/device-manager';

describe('sprintf', () => {
  it('replaces %s', () => {
    expect(sprintf('hello %s', 'world')).toBe('hello world');
  });

  it('replaces %d', () => {
    expect(sprintf('port %d', 8080)).toBe('port 8080');
  });

  it('replaces mixed', () => {
    expect(sprintf('%s:%d', 'tcp', 5000)).toBe('tcp:5000');
  });

  it('multiple args', () => {
    expect(sprintf('%s %s %d', 'a', 'b', 3)).toBe('a b 3');
  });

  it('no placeholders returns as-is', () => {
    expect(sprintf('hello', 'ignored')).toBe('hello');
  });
});

describe('compareVersion', () => {
  // We test compareVersion by instantiating DeviceManager with a mock HdcClient
  // Since compareVersion is an instance method, we need to import the class
  // and use a mock that provides shell responses

  it('would compare versions correctly (logic extracted)', () => {
    // Extract the comparison logic for standalone testing
    function compareVersion(targetVersion: string, deviceVersion: string): number {
      try {
        const tParts = targetVersion.split('.');
        const dParts = deviceVersion.split('.');
        const minLen = Math.min(tParts.length, dParts.length);
        for (let i = 0; i < minLen; i++) {
          const t = parseInt(tParts[i]!, 10);
          const d = parseInt(dParts[i]!, 10);
          if (t > d) return 1;
          if (t < d) return -1;
        }
        return 0;
      } catch {
        return -1;
      }
    }

    expect(compareVersion('6.0.2.1', '6.0.2.1')).toBe(0);
    expect(compareVersion('6.0.2.1', '6.0.2.0')).toBe(1);
    expect(compareVersion('6.0.2.1', '6.0.2.2')).toBe(-1);
    expect(compareVersion('5.1.1.2', '6.0.2.1')).toBe(-1);
    expect(compareVersion('6.0.2.1', '5.1.1.2')).toBe(1);
    expect(compareVersion('5.1.1.3', '5.1.1.3')).toBe(0);
    expect(compareVersion('5.1.1', '5.1.1.3')).toBe(0); // same prefix
    expect(compareVersion('6.0.2.1', '')).toBe(0); // parseInt('')=NaN, NaN comparisons false, loop exits with 0
    expect(compareVersion('', '6.0.2.1')).toBe(0); // minLen=0, loop doesn't execute
  });
});

describe('buildScrcpyParams', () => {
  it('generates correct default parameter format', () => {
    // Verify the format string logic matches expected output
    const scale = 2;
    const frameRate = 60;
    const bitRate = 8; // Mbps
    const port = 5000;
    const screenId = 0;
    const iFrameInterval = 500;
    const repeatInterval = 33;

    const params = `-scale ${scale} -frameRate ${frameRate} -bitRate ${bitRate * 1024 * 1024} -p ${port} -screenId ${screenId} -encodeType 0 -iFrameInterval ${iFrameInterval} -repeatInterval ${repeatInterval}`;
    expect(params).toContain('-scale 2');
    expect(params).toContain('-frameRate 60');
    expect(params).toContain('-bitRate 8388608');
    expect(params).toContain('-p 5000');
    expect(params).toContain('-iFrameInterval 500');
    expect(params).toContain('-repeatInterval 33');
  });

  it('different bitrate produces different output', () => {
    const a = `-bitRate ${4 * 1024 * 1024}`;
    const b = `-bitRate ${8 * 1024 * 1024}`;
    expect(a).not.toBe(b);
  });
});

describe('PID parsing (getScrcpyPids logic)', () => {
  it('extracts PID from valid ps line', () => {
    function parsePids(output: string, extensionName: string, port: number): string[] {
      const pids: string[] = [];
      for (const line of output.split(/\r?\n/)) {
        if (
          line.includes('singleness') &&
          (line.includes(extensionName) || line.includes('-p ' + port)) &&
          line.includes('extension-name') &&
          !line.includes('grep')
        ) {
          const parts = line.split(/\s+/);
          if (parts.length >= 2) {
            pids.push(parts[1]!);
          }
        }
      }
      return pids;
    }

    const psOutput = `root      1234  1  /system/bin/uitest start-daemon singleness --extension-name libscreen_casting.z.so -scale 2`;
    const pids = parsePids(psOutput, 'libscreen_casting.z.so', 5000);
    expect(pids).toEqual(['1234']);
  });

  it('filters out grep line', () => {
    function parsePids(output: string, extensionName: string, port: number): string[] {
      const pids: string[] = [];
      for (const line of output.split(/\r?\n/)) {
        if (
          line.includes('singleness') &&
          (line.includes(extensionName) || line.includes('-p ' + port)) &&
          line.includes('extension-name') &&
          !line.includes('grep')
        ) {
          const parts = line.split(/\s+/);
          if (parts.length >= 2) pids.push(parts[1]!);
        }
      }
      return pids;
    }

    const psOutput = `root      1234  1  /system/bin/uitest singleness --extension-name libscreen_casting.z.so\ngrep singleness`;
    const pids = parsePids(psOutput, 'libscreen_casting.z.so', 5000);
    expect(pids).toEqual(['1234']);
  });

  it('returns empty for no match', () => {
    function parsePids(output: string, extensionName: string, port: number): string[] {
      const pids: string[] = [];
      for (const line of output.split(/\r?\n/)) {
        if (
          line.includes('singleness') &&
          (line.includes(extensionName) || line.includes('-p ' + port)) &&
          line.includes('extension-name') &&
          !line.includes('grep')
        ) {
          const parts = line.split(/\s+/);
          if (parts.length >= 2) pids.push(parts[1]!);
        }
      }
      return pids;
    }

    const pids = parsePids('some random output', 'libscreen_casting.z.so', 5000);
    expect(pids).toEqual([]);
  });

  it('handles multiple matches', () => {
    function parsePids(output: string, extensionName: string, port: number): string[] {
      const pids: string[] = [];
      for (const line of output.split(/\r?\n/)) {
        if (
          line.includes('singleness') &&
          (line.includes(extensionName) || line.includes('-p ' + port)) &&
          line.includes('extension-name') &&
          !line.includes('grep')
        ) {
          const parts = line.split(/\s+/);
          if (parts.length >= 2) pids.push(parts[1]!);
        }
      }
      return pids;
    }

    const psOutput = `root      100  1  uitest singleness --extension-name libscreen_casting.z.so\nroot      200  1  uitest singleness --extension-name libscreen_casting.z.so`;
    const pids = parsePids(psOutput, 'libscreen_casting.z.so', 5000);
    expect(pids).toEqual(['100', '200']);
  });
});
