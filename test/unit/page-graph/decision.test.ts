import { describe, it, expect } from 'vitest';
import { classifyInconsistency } from '../../../src/page-graph/decision';
import type { PageFingerprint } from '../../../src/page-graph/types';
import type { PopupInfo } from '../../../src/page-graph/popup';

function fp(hash: string, anchors: string[]): PageFingerprint { return { version: 'v1', skeletonHash: hash, anchors }; }
const popup: PopupInfo = { kind: 'dialog' };

describe('classifyInconsistency', () => {
  it('有弹窗 → popup', () => {
    expect(classifyInconsistency(fp('a', ['x']), fp('b', ['y']), popup)).toBe('popup');
  });
  it('无弹窗 + skeletonHash 同 → consistent(动态噪声已吸收)', () => {
    expect(classifyInconsistency(fp('h', ['x']), fp('h', ['x']), null)).toBe('consistent');
  });
  it('hash 不同 + anchors 高重叠 → partial_revision(局部改版)', () => {
    // Jaccard = 交集{设置,关于,显示,声音} / 并集{设置,关于,显示,声音,电池,网络} = 4/6 ≈ 0.67 ≥ 0.6
    expect(classifyInconsistency(fp('h1', ['设置','关于','显示','声音','电池']), fp('h2', ['设置','关于','显示','声音','网络']), null))
      .toBe('partial_revision');
  });
  it('hash 不同 + anchors 低重叠 → full_revision(整体改版)', () => {
    expect(classifyInconsistency(fp('h1', ['设置','关于']), fp('h2', ['购物','支付']), null)).toBe('full_revision');
  });
});
