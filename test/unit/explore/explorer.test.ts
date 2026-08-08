import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Explorer } from '../../../src/explore/explorer';
import { ActExecutor } from '../../../src/explore/act-executor';
import { FakeDevice, model, el } from './fakes';
import { MapStore } from '../../../src/page-graph';
import type { ExplorerConfig } from '../../../src/explore/types';

function cfg(over: Partial<ExplorerConfig> = {}): ExplorerConfig {
  return { appBundle: 'com.test', appVersion: '1.0', maxSteps: 20, maxNoNewPage: 3, maxBacktrackFail: 2, sampleLimit: 10, ...over };
}
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'exp-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

// root 页:标题"设置"(纯 Text,clickable=false → anchor,不进 frontier)+"关于手机"入口
const root = model([
  el('设置', 'Text', { bounds: [0, 0, 1080, 100], clickable: false }),
  el('关于手机', 'Button', { bounds: [0, 100, 540, 200] }),
]);
const about = model([el('设备名称', 'Text', { bounds: [0, 0, 1080, 80] })]);   // 入口页:无白名单候选 → frontier 空

describe('Explorer', () => {
  it('navigate 到新页 → 建两节点 + navigate 边 + 增量落盘', async () => {
    const dev = new FakeDevice([root, root, about, about, root, root, root, root]);
    const store = new MapStore(dir);
    const exp = new Explorer(new ActExecutor(dev, { stallMs: 0 }), dev, cfg(), store);
    const r = await exp.explore();
    expect(r.graph.nodes.size).toBe(2);
    expect(r.newPages).toBe(1);
    expect(r.graph.edges.some((e) => e.opType === 'navigate' && e.to !== e.from)).toBe(true);
    expect(store.load('com.test', '1.0')?.nodes.size).toBe(2);
  });

  it('toggle(指纹变+锚点同)→ 自环边,不裂变节点', async () => {
    const p1 = model([el('设置', 'Text', { bounds: [0, 0, 1080, 100], clickable: false }), el('更多', 'Button', { bounds: [0, 100, 540, 200] }), el('状态A', 'Text', { bounds: [0, 300, 540, 400] })]);
    const p2 = model([el('设置', 'Text', { bounds: [0, 0, 1080, 100], clickable: false }), el('更多', 'Button', { bounds: [0, 100, 540, 200] }), el('状态B', 'Text', { bounds: [0, 300, 540, 400] })]);
    const dev = new FakeDevice([p1, p1, p2, p2, p1, p1]);
    const exp = new Explorer(new ActExecutor(dev, { stallMs: 0 }), dev, cfg(), new MapStore(dir));
    const r = await exp.explore();
    expect(r.graph.nodes.size).toBe(1);
    expect(r.graph.edges.some((e) => e.opType === 'toggle' && e.to === e.from)).toBe(true);
  });

  it('回溯核验:BACK 后落点==父 → back 调用', async () => {
    const dev = new FakeDevice([root, root, about, about, root, root, root, root]);
    const exp = new Explorer(new ActExecutor(dev, { stallMs: 0 }), dev, cfg(), new MapStore(dir));
    await exp.explore();
    expect(dev.calls.back).toBeGreaterThan(0);
  });

  it('连续 BACK 失败 → 冷启动回 root(launchApp 调用)', async () => {
    const stray = model([el('乱七八糟', 'Text', { bounds: [0, 0, 1080, 80] })]);
    const dev = new FakeDevice([root, root, about, about, stray, stray, stray, stray, root, root]);
    const exp = new Explorer(new ActExecutor(dev, { stallMs: 0 }), dev, cfg({ maxSteps: 30 }), new MapStore(dir));
    await exp.explore();
    expect(dev.calls.launch.length).toBeGreaterThanOrEqual(1);
    expect(dev.calls.forceStop).toBeGreaterThanOrEqual(1);
  });

  it('终止:连续无新页达阈值 → terminated=no-new-page', async () => {
    const dev = new FakeDevice([root, root, about, about, root, root]);
    const exp = new Explorer(new ActExecutor(dev, { stallMs: 0 }), dev, cfg({ maxNoNewPage: 2 }), new MapStore(dir));
    const r = await exp.explore();
    expect(r.terminated).toBe('no-new-page');
  });

  it('resume:首次建图后落盘含 root + rootId', async () => {
    const dev = new FakeDevice([root, root, root, root]);
    const store = new MapStore(dir);
    const exp = new Explorer(new ActExecutor(dev, { stallMs: 0 }), dev, cfg(), store);
    await exp.explore();
    const loaded = store.load('com.test', '1.0');
    expect(loaded?.nodes.size).toBeGreaterThanOrEqual(1);
    expect(loaded?.rootId).toBeDefined();
  });
});
