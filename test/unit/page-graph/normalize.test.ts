import { describe, it, expect } from 'vitest';
import { normalizeSkeleton, bucketize, normalizeDynamic, learnStaticWhitelist } from '../../../src/page-graph/normalize';
import type { FingerprintInput } from '../../../src/page-graph/types';

// 类型化 helper(避免裸 any)。元素需符合 FingerprintInput.elements: Element。
function el(text: string, type = 'Button', opts: { clickable?: boolean; scrollable?: boolean } = {}): FingerprintInput['elements'][number] {
  return {
    ref: '@e0#s1', bounds: [0, 0, 100, 100], center: { x: 50, y: 50 },
    texts: [text], attrs: { clickable: opts.clickable ?? true, scrollable: opts.scrollable, type },
  };
}

describe('normalizeSkeleton', () => {
  it('规则⑤:开关 checked-state 文本归一(toggle 不污染指纹)', () => {
    // 规则⑤ 由纯文本 CHECKED_STATE 驱动(spec §4.1.2):"已开启"/"已关闭" 都归一为 CHECKED_STATE。
    const off = normalizeSkeleton({ elements: [el('已关闭', 'Text')] });
    const on = normalizeSkeleton({ elements: [el('已开启', 'Text')] });
    expect(JSON.stringify(off.nodes)).toBe(JSON.stringify(on.nodes));
  });

  it('规则①:列表项 multiset 顺序无关', () => {
    const a = normalizeSkeleton({ elements: [
      el('列表', 'List', { scrollable: true }),
      el('项A', 'Text'), el('项B', 'Text'), el('项C', 'Text'),
    ]});
    const b = normalizeSkeleton({ elements: [
      el('列表', 'List', { scrollable: true }),
      el('项C', 'Text'), el('项A', 'Text'), el('项B', 'Text'),
    ]});
    expect(JSON.stringify(a.lists)).toBe(JSON.stringify(b.lists));
  });

  it('bucketize 容量桶', () => {
    expect(bucketize(1)).toBe('1');
    expect(bucketize(3)).toBe('2-5');
    expect(bucketize(15)).toBe('6-20');
    expect(bucketize(50)).toBe('21-100');
    expect(bucketize(200)).toBe('100+');
  });

  it('规则③:广告位无条件剥离(在场/不在场同骨架)', () => {
    const withAd = normalizeSkeleton({ elements: [el('内容', 'Text'), el('广告', 'Text')] });
    const noAd = normalizeSkeleton({ elements: [el('内容', 'Text')] });
    expect(JSON.stringify(withAd.nodes)).toBe(JSON.stringify(noAd.nodes));
  });
});

describe('normalizeSkeleton 补充', () => {
  it('bucketize 边界稳定(长度变化不跨桶则桶不变)', () => {
    // 下界归属:2 与 5 同桶,6 与 20 同桶,21 与 100 同桶
    expect(bucketize(2)).toBe('2-5');
    expect(bucketize(5)).toBe('2-5');
    expect(bucketize(6)).toBe('6-20');
    expect(bucketize(20)).toBe('6-20');
    expect(bucketize(21)).toBe('21-100');
    expect(bucketize(100)).toBe('21-100');
    expect(bucketize(101)).toBe('100+');
    // 0 与 1 同桶(空/单元素列表)
    expect(bucketize(0)).toBe('1');
  });

  it('规则③:不同措辞的广告位都剥离(推广/sponsor/AD)', () => {
    const baseline = normalizeSkeleton({ elements: [el('正文', 'Text')] });
    const variants = ['推广', 'sponsor', 'AD', 'Sponsor'];
    for (const marker of variants) {
      const withAd = normalizeSkeleton({ elements: [el('正文', 'Text'), el(marker, 'Text')] });
      expect(JSON.stringify(withAd.nodes), `marker=${marker}`).toBe(JSON.stringify(baseline.nodes));
    }
  });

  it('规则①:列表项 multiset 含重复项也顺序无关', () => {
    const a = normalizeSkeleton({ elements: [
      el('列表', 'List', { scrollable: true }),
      el('项A', 'Text'), el('项A', 'Text'), el('项B', 'Text'),
    ]});
    const b = normalizeSkeleton({ elements: [
      el('列表', 'List', { scrollable: true }),
      el('项B', 'Text'), el('项A', 'Text'), el('项A', 'Text'),
    ]});
    expect(JSON.stringify(a.lists)).toBe(JSON.stringify(b.lists));
  });

  it('规则②:动态值归一(数字/时间/日期粗筛)', () => {
    // 数字归一:不同点赞数同骨架
    const a = normalizeSkeleton({ elements: [el('点赞 42', 'Text')] });
    const b = normalizeSkeleton({ elements: [el('点赞 1,024', 'Text')] });
    expect(JSON.stringify(a.nodes)).toBe(JSON.stringify(b.nodes));
  });

  it('规则①:Swiper 轮播容器识别(子项剥离入 lists,不进 nodes)', () => {
    // spike §4:Swiper(轮播)未被 /list|waterflow|grid/ 覆盖,子项错误进入 nodes。
    // 容器与子项同 bounds(等边界即视为包含,见 isInside)。
    const swiper: FingerprintInput['elements'][number] = {
      ref: '@e0#s1', bounds: [0, 0, 100, 100], center: { x: 50, y: 50 },
      texts: ['轮播'], attrs: { clickable: false, scrollable: false, type: 'Swiper' },
    };
    const child = el('图片A', 'Text');   // bounds [0,0,100,100] 落在 swiper 内
    const skeleton = normalizeSkeleton({ elements: [swiper, child] });
    // Swiper 当容器 → 子项进 lists.itemSigs(被裁剪),不进 nodes
    expect(skeleton.lists).toHaveLength(1);
    expect(skeleton.lists[0].type).toBe('Swiper');
    expect(skeleton.nodes.map((n) => n.text)).not.toContain('图片A');
  });
});

describe('规则② 动态归一增强', () => {
  it('静态白名单:"第2屏"含数字但跨 dump 不变 → 保留(不归一)', () => {
    expect(normalizeDynamic('第2屏')).toBe('第2屏');
  });

  it('静态白名单:第N屏/页/章/节/步 均保留', () => {
    expect(normalizeDynamic('第3页')).toBe('第3页');
    expect(normalizeDynamic('第10章')).toBe('第10章');
    expect(normalizeDynamic('第5节')).toBe('第5节');
    expect(normalizeDynamic('第1步')).toBe('第1步');
  });

  it('动态计数:"12 条新消息" → NUM 占位', () => {
    expect(normalizeDynamic('12 条新消息')).toBe('NUM 条新消息');
  });

  it('NUM 正则不裂变:任意长度无逗号数字归一为单个 NUM', () => {
    // 4+ 位无逗号数字曾因 \d{1,3} 限 3 位裂变为 "NUMNUM"
    expect(normalizeDynamic('1024')).toBe('NUM');
    expect(normalizeDynamic('1234567')).toBe('NUM');
    // 3 位与 4+ 位同桶(NUM 一致),防边界假差异
    expect(normalizeDynamic('999')).toBe(normalizeDynamic('1024'));
    // 千分位/小数仍归一为单个 NUM
    expect(normalizeDynamic('1,024')).toBe('NUM');
    expect(normalizeDynamic('3.14')).toBe('NUM');
    expect(normalizeDynamic('1,000,000.50')).toBe('NUM');
  });

  it('DATE 正则放宽非零填充:月/日 1-2 位都识别', () => {
    expect(normalizeDynamic('2024-1-5')).toBe('DATE');
    expect(normalizeDynamic('2024-12-05')).toBe('DATE');
  });

  it('learnStaticWhitelist:同位 text 跨 dump 不变=静态,变=动态', () => {
    // 位置 0 三次 dump 都是"设置"(静态);位置 1 三次不同(动态)
    const samePositionTexts = [
      ['设置', '设置', '设置'],
      ['12条', '5条', '8条'],
    ];
    const wl = learnStaticWhitelist(samePositionTexts);
    expect(wl.has('设置')).toBe(true);
    expect(wl.has('12条')).toBe(false);
  });

  it('learnStaticWhitelist:全部位置都变化 → 空白名单', () => {
    const samePositionTexts = [
      ['1', '2', '3'],
      ['a', 'b', 'c'],
    ];
    expect(learnStaticWhitelist(samePositionTexts).size).toBe(0);
  });
});

describe('isAd 英文 marker 词边界(修复误命中)', () => {
  it('广告/推广/赞助 中文 marker 仍命中', () => {
    const baseline = normalizeSkeleton({ elements: [el('正文', 'Text')] });
    for (const marker of ['广告', '推广', '赞助']) {
      const withAd = normalizeSkeleton({ elements: [el('正文', 'Text'), el(marker, 'Text')] });
      expect(JSON.stringify(withAd.nodes), `marker=${marker}`).toBe(JSON.stringify(baseline.nodes));
    }
  });

  it('header/leader/loading/reader/shadow 含 ad 子串但不是广告 → 不误剥', () => {
    const words = ['header', 'leader', 'loading', 'reader', 'shadow'];
    for (const w of words) {
      const skeleton = normalizeSkeleton({ elements: [el('正文', 'Text'), el(w, 'Text')] });
      const texts = skeleton.nodes.map((n) => n.text);
      expect(texts, `word=${w}`).toContain(w);
    }
  });

  it('独立 "ad"/"ads"/"AD"/"Sponsor" 仍命中广告剥离', () => {
    const baseline = normalizeSkeleton({ elements: [el('正文', 'Text')] });
    for (const marker of ['ad', 'ads', 'AD', 'Sponsor']) {
      const withAd = normalizeSkeleton({ elements: [el('正文', 'Text'), el(marker, 'Text')] });
      expect(JSON.stringify(withAd.nodes), `marker=${marker}`).toBe(JSON.stringify(baseline.nodes));
    }
  });
});

describe('纯图标页几何签名集成(geometry 字段)', () => {
  function iconEl(x: number, y: number): FingerprintInput['elements'][number] {
    return {
      ref: '@e0#s1', bounds: [0, 0, 50, 50], center: { x, y },
      texts: [], attrs: { clickable: true, type: 'Image' },
    };
  }

  it('纯图标页(所有 node 无 text)→ 填 geometry', () => {
    const sk = normalizeSkeleton({
      elements: [iconEl(50, 50), iconEl(150, 50)],
      screenSize: { w: 400, h: 800 },
    });
    expect(sk.geometry).toBeTruthy();
  });

  it('混合页(有 text node)→ 不填 geometry', () => {
    const sk = normalizeSkeleton({
      elements: [el('按钮', 'Button'), iconEl(150, 50)],
      screenSize: { w: 400, h: 800 },
    });
    expect(sk.geometry).toBeUndefined();
  });

  it('Task3/4 规则不受影响:广告剥离 + checked 归一仍生效', () => {
    // 含广告的纯图标页:广告被剥离,几何签名仅含图标
    const adEl: FingerprintInput['elements'][number] = {
      ref: '@e1#s1', bounds: [0, 0, 50, 50], center: { x: 200, y: 200 },
      texts: ['广告'], attrs: { clickable: true, type: 'Image' },
    };
    const sk = normalizeSkeleton({
      elements: [iconEl(50, 50), adEl],
      screenSize: { w: 400, h: 800 },
    });
    // 广告被剥离 → nodes 只有图标;texts=['广告'] 非 empty → 不进 geometry cells
    expect(sk.nodes.map((n) => n.text)).toEqual(['']);
    expect(sk.geometry).not.toContain('广告');
  });
});
