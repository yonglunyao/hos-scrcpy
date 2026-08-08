import type { ScreenModel, Element } from '../../../src/screen-model';
import type { DevicePrimitives } from '../../../src/explore/types';

/** 回放录制的 ScreenModel 序列 + 记录设备调用。 */
export class FakeDevice implements DevicePrimitives {
  screenSize = { w: 1080, h: 2340 };
  private models: ScreenModel[];
  private idx = 0;
  calls: { tapRef: string[]; tapCoord: Array<{x:number;y:number}>; back: number; launch: Array<{bundle:string;ability?:string}>; shell: string[]; recover: number } =
    { tapRef: [], tapCoord: [], back: 0, launch: [], shell: [], recover: 0 };

  constructor(models: ScreenModel[], screenSize?: { w: number; h: number }) {
    this.models = models;
    if (screenSize) this.screenSize = screenSize;
  }
  async dump(): Promise<ScreenModel> {
    const m = this.models[Math.min(this.idx, this.models.length - 1)];
    this.idx++;
    return m;
  }
  async tapRef(ref: string): Promise<void> { this.calls.tapRef.push(ref); }
  async tapCoord(x: number, y: number): Promise<void> { this.calls.tapCoord.push({ x, y }); }
  async pressBack(): Promise<void> { this.calls.back++; }
  async launchApp(bundle: string, ability?: string): Promise<void> { this.calls.launch.push({ bundle, ability }); }
  async shell(cmd: string): Promise<string> { this.calls.shell.push(cmd); return '1'; }
  async recover(): Promise<void> { this.calls.recover++; }
}

export function model(els: Element[], gen = 1): ScreenModel {
  return { generation: gen, ts: gen, elements: els };
}

export function el(text: string, type = 'Button', opts: { bounds?: number[]; clickable?: boolean } = {}): Element {
  const b = opts.bounds ?? [0, 0, 100, 100];
  const idx = Math.abs(text.length * 7 + (b[0] ?? 0)) % 10;
  return { ref: `@e${idx}#s1`, bounds: b, center: { x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2 }, texts: text ? [text] : [], attrs: { clickable: opts.clickable ?? true, type } };
}
