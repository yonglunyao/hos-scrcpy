import { describe, it, expect } from 'vitest';
import { ActExecutor } from '../../../src/explore/act-executor';
import { LocatorUnresolved } from '../../../src/explore/types';
import { FakeDevice, model, el } from './fakes';
import { computeFingerprint } from '../../../src/page-graph';

describe('ActExecutor', () => {
  it('sense:dump→stripPopup→指纹(底层页),弹窗不污染指纹', async () => {
    const base = model([el('设置', 'Text', { bounds: [0, 0, 1080, 100] }), el('关于手机', 'Button', { bounds: [0, 100, 540, 200] })]);
    const withPopup = model([
      el('设置', 'Text', { bounds: [0, 0, 1080, 100] }),
      el('关于手机', 'Button', { bounds: [0, 100, 540, 200] }),
      { ref: '@e9#s1', bounds: [0,0,1080,2340], center:{x:540,y:1170}, texts:[], attrs:{clickable:true, type:'Stack'} },
      { ref: '@e8#s1', bounds: [100,800,980,1500], center:{x:540,y:1150}, texts:['广告'], attrs:{type:'Dialog'} },
    ]);
    const dev = new FakeDevice([withPopup]);
    const act = new ActExecutor(dev);
    const s = await act.sense();
    expect(s.popup).not.toBeNull();
    expect(s.fingerprint.skeletonHash).toBe(computeFingerprint({ elements: base.elements, screenSize: dev.screenSize }).skeletonHash);
  });

  it('senseStable:连续两次指纹一致才返回(防过渡态)', async () => {
    const a = model([el('设置', 'Text')]);
    const b = model([el('设置', 'Text'), el('加载中', 'Text')]);
    const dev = new FakeDevice([b, a, a]);
    const act = new ActExecutor(dev, { stallMs: 0 });
    const s = await act.senseStable(3);
    expect(s.fingerprint.skeletonHash).toBe(computeFingerprint({ elements: a.elements, screenSize: dev.screenSize }).skeletonHash);
  });

  it('perform:resolveLocator 命中 → tapRef;返回 after SenseResult', async () => {
    const p1 = model([el('关于手机', 'Button', { bounds: [0, 100, 540, 200] })]);
    const p2 = model([el('设备名称', 'Text', { bounds: [0, 0, 1080, 80] })]);
    const dev = new FakeDevice([p1, p1, p2, p2]);
    const act = new ActExecutor(dev, { stallMs: 0 });
    const cur = await act.senseStable();
    const r = await act.perform(cur, { text: '关于手机' });
    expect(dev.calls.tapRef.length).toBe(1);
    expect(r.after.fingerprint.skeletonHash).toBe(computeFingerprint({ elements: p2.elements, screenSize: dev.screenSize }).skeletonHash);
  });

  it('perform:未命中 + fallbackCoord → tapCoord + usedFallback', async () => {
    const p1 = model([el('X', 'Text')]);
    const p2 = model([el('Y', 'Text')]);
    const dev = new FakeDevice([p1, p1, p2, p2]);
    const act = new ActExecutor(dev, { stallMs: 0 });
    const cur = await act.senseStable();
    const r = await act.perform(cur, { text: '不存在' }, { x: 270, y: 150 });
    expect(dev.calls.tapRef.length).toBe(0);
    expect(dev.calls.tapCoord).toEqual([{ x: 270, y: 150 }]);
    expect(r.usedFallback).toBe(true);
  });

  it('perform:未命中且无 fallbackCoord → LocatorUnresolved', async () => {
    const p1 = model([el('X', 'Text')]);
    const dev = new FakeDevice([p1, p1]);
    const act = new ActExecutor(dev, { stallMs: 0 });
    const cur = await act.senseStable();
    await expect(act.perform(cur, { text: '不存在' })).rejects.toBeInstanceOf(LocatorUnresolved);
  });
});
