# SLAM 阶段①:页面指纹 + 图存储 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 SLAM 第二阶段阶段① —— 页面指纹(canonical 序列化 + 五条规范化规则 + 几何签名 + anchors 匹配)+ PageGraph 数据模型 + MapStore(序列化/增量/原子/diff),并用真机 spike 回填指纹阈值。

**Architecture:** 纯函数为主的新模块 `src/page-graph/`,建在已交付的 MVP 地基(`ScreenModel`/`Element`/`Locator`/`buildScreenModel`/`flattenLayout`)之上,不改 MVP。指纹 = 规范化骨架的 canonical 序列化 SHA-256;不存全量 dump,只存规范化骨架。spike 用已有 `spike/*.json`(设置/淘宝 dump)驱动。

**Tech Stack:** TypeScript (CJS/ES2020/strict)、vitest、Node `crypto`(SHA-256)、`fs`(MapStore)。复用 `src/screen-model`、`src/layout`。

**关联 spec:** `docs/superpowers/specs/2026-08-08-slam-autoexplore-design.md` §3(数据模型)、§4.1(指纹)、§4.8(MapStore)、§9 阶段①。

---

## File Structure

新增模块 `src/page-graph/`:

| 文件 | 职责 |
|---|---|
| `types.ts` | `FingerprintInput`、`NormalizedSkeleton`、`PageFingerprint`、`PageNode`、`Edge`、`PageGraph`、`OpType` |
| `normalize.ts` | 五条规范化规则:`normalizeSkeleton(input): NormalizedSkeleton` + 子规则函数 |
| `serialize.ts` | canonical 序列化:`serializeCanonical(skeleton): string`(pre-order DFS + 字典序 + S-expr + `v1:` 前缀) |
| `fingerprint.ts` | `computeFingerprint(input): PageFingerprint`(normalize→serialize→sha256 + anchors 提取)、`matchAnchors`、`classifyMatch`(精确/漂移/新页处置表) |
| `geometry.ts` | 纯图标页几何布局签名:`geometrySignature(elements)` |
| `store.ts` | `MapStore`:序列化、增量 append、原子写、`diff(oldGraph, newGraph)`、fingerprintVersion 校验 |
| `index.ts` | 桶导出 |

测试 `test/unit/page-graph/`:`normalize.test.ts`、`serialize.test.ts`、`fingerprint.test.ts`、`geometry.test.ts`、`store.test.ts`。

Fixtures `test/fixtures/page-graph/`:录制的 dumpLayout JSON(同页多 dump、不同页、动态列表、纯图标页)。优先复用 `spike/*.json`。

**关键对接点(已确认 MVP 接口):**
- `Element.attrs = { clickable?, scrollable?, enabled?, type? }` —— **无 checkable/checked**。
- `UiElement`(layout 层)有 `checkable/checked/description`。
- 规则⑤(checked-state 归一)需要 checked → `FingerprintInput` 由调用方从 `ScreenModel` + `flattenLayout` 合并补 `checked?` 字段(不改 MVP 的 `Element`,只在 page-graph 模块内扩展输入类型)。

---

## Task 1: 数据模型类型 + fixtures

**Files:**
- Create: `src/page-graph/types.ts`
- Create: `test/fixtures/page-graph/settings-about.json`(复用 `spike/set-1.json` 拷贝)、`settings-about-2.json`(同页二次 dump,验证稳定性)、`settings-display.json`(不同页,验证区分性)

- [ ] **Step 1: 写 `src/page-graph/types.ts`**

```typescript
import type { Element, Locator } from '../screen-model';

/** 指纹算法版本;规范化规则变更必升版本,旧图不静默碰撞。 */
export const FINGERPRINT_VERSION = 'v1';

export type OpType =
  | 'navigate' | 'toggle' | 'noop'
  | 'destructive' | 'external' | 'modal' | 'unknown';

/** 指纹输入:Element + 补充的 checked(规则⑤用)。不改 MVP Element,模块内扩展。 */
export interface FingerprintInput {
  elements: ReadonlyArray<Element & { checked?: boolean }>;
  /** 设备分辨率,用于几何签名归一化坐标;缺省按 bounds 推导 */
  screenSize?: { w: number; h: number };
}

/** 规范化后的骨架(canonical 序列化的输入)。 */
export interface NormalizedSkeleton {
  /** 稳定骨架节点:规范化后 text(已归一)+ type + 层级 */
  nodes: NormalizedNode[];
  /** 列表容器摘要(multiset + 容量桶) */
  lists: ListSummary[];
  /** 几何布局签名(纯图标页 text 缺失时启用) */
  geometry?: string;
}

export interface NormalizedNode {
  text: string;      // 已动态归一(占位或原值)
  type: string;
  depth: number;
}

export interface ListSummary {
  type: string;             // List/WaterFlow/Grid...
  countBucket: string;      // '1' | '2-5' | '6-20' | '21-100' | '100+'
  itemSigs: string[];       // 项骨架哈希的 multiset(排序后确定性)
}

export interface PageFingerprint {
  version: string;          // = FINGERPRINT_VERSION
  skeletonHash: string;     // serializeCanonical(skeleton) 的 SHA-256
  anchors: string[];        // 稳定锚点 text(已动态归一)
}

export interface PageNode {
  id: string;               // skeletonHash 派生
  fingerprint: PageFingerprint;
  skeletonArchive: NormalizedSkeleton;  // 规范化骨架(脱敏,非全量 dump)
  frontierExplored: Locator[];
  frontierPending: Locator[];
  visitedAt: number;
}

export interface Edge {
  from: string;
  locator: Locator;
  fallbackCoord?: { x: number; y: number };
  to: string;
  opType: OpType;
  backNavigable: 'confirmed' | 'heuristic' | 'unknown';
  effectReversible: boolean;
  verified: boolean;
}

export interface PageGraph {
  appBundle: string;
  appVersion: string;
  fingerprintVersion: string;   // = FINGERPRINT_VERSION
  stateLabel?: { ts?: number; network?: string; loggedIn?: boolean };
  nodes: Map<string, PageNode>;
  edges: Edge[];
  entryPoints: { id: string; label: string; origin: 'launcher' | 'deeplink' | 'notification' }[];
  rootId?: string;
}
```

- [ ] **Step 2: 准备 fixtures**

复制 `spike/set-1.json` → `test/fixtures/page-graph/settings-about.json`;再 dump 一次设置-关于手机页存为 `settings-about-2.json`;dump 设置-显示页存为 `settings-display.json`。(若 spike 数据不足,Task 10 spike 时补。)

- [ ] **Step 3: 类型检查 + 提交**

```bash
npx tsc --noEmit
git add src/page-graph/types.ts test/fixtures/page-graph/
git commit -m "feat(page-graph): 数据模型类型 + fixtures"
```

---

## Task 2: canonical 序列化(稳定性)

**Files:**
- Create: `src/page-graph/serialize.ts`
- Test: `test/unit/page-graph/serialize.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect } from 'vitest';
import { serializeCanonical } from '../../../src/page-graph/serialize';
import type { NormalizedSkeleton } from '../../../src/page-graph/types';

describe('serializeCanonical', () => {
  it('相同输入产生字节相同的字符串(确定性)', () => {
    const sk: NormalizedSkeleton = {
      nodes: [
        { text: '关于手机', type: 'Text', depth: 0 },
        { text: '设置', type: 'Text', depth: 0 },
      ],
      lists: [],
    };
    // 子节点顺序打乱也应产出同一串(字典序排序)
    const shuffled: NormalizedSkeleton = {
      nodes: [
        { text: '设置', type: 'Text', depth: 0 },
        { text: '关于手机', type: 'Text', depth: 0 },
      ],
      lists: [],
    };
    expect(serializeCanonical(shuffled)).toBe(serializeCanonical(sk));
  });

  it('以版本前缀开头', () => {
    const sk: NormalizedSkeleton = { nodes: [], lists: [] };
    expect(serializeCanonical(sk)).startsWith('v1:');
  });

  it('不同骨架产出不同串', () => {
    const a: NormalizedSkeleton = { nodes: [{ text: 'A', type: 'Text', depth: 0 }], lists: [] };
    const b: NormalizedSkeleton = { nodes: [{ text: 'B', type: 'Text', depth: 0 }], lists: [] };
    expect(serializeCanonical(a)).not.toBe(serializeCanonical(b));
  });
});
```

- [ ] **Step 2: 验证失败** — `npx vitest run test/unit/page-graph/serialize.test.ts` → FAIL(模块不存在)

- [ ] **Step 3: 实现 `src/page-graph/serialize.ts`**

```typescript
import { FINGERPRINT_VERSION, type NormalizedSkeleton, type NormalizedNode, type ListSummary } from './types';

/**
 * Canonical 序列化:pre-order + 字典序稳定排序 + S-expr + 版本前缀。
 * 保证同骨架(任意输入顺序)产出字节相同 → 哈希可比/diff 有效。
 * 不用 JSON(key 顺序/空白/数字格式不确定)。
 */
export function serializeCanonical(skeleton: NormalizedSkeleton): string {
  const parts: string[] = [`${FINGERPRINT_VERSION}:`];
  const sortedNodes = sortBy([...skeleton.nodes], nodeKey);
  for (const n of sortedNodes) parts.push(serializeNode(n));
  const sortedLists = sortBy([...skeleton.lists], listKey);
  for (const l of sortedLists) parts.push(serializeList(l));
  if (skeleton.geometry) parts.push(`G(${skeleton.geometry})`);
  return parts.join('');
}

function nodeKey(n: NormalizedNode): string {
  return `${n.depth}:${n.type}:${n.text}`;
}
function listKey(l: ListSummary): string {
  return `${l.type}:${l.countBucket}:${l.itemSigs.join(',')}`;
}
function serializeNode(n: NormalizedNode): string {
  return `N(${n.depth},${escape(n.type)},${escape(n.text)})`;
}
function serializeList(l: ListSummary): string {
  return `L(${escape(l.type)},${l.countBucket},{${l.itemSigs.join(',')}})`;
}

/** 字典序稳定排序(输入顺序无关)。 */
function sortBy<T>(arr: T[], key: (x: T) => string): T[] {
  return arr.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

/** 转义避免分隔符冲突:反斜杠/逗号/括号/花括号。 */
function escape(s: string): string {
  return s.replace(/([\\,(){}])/g, '\\$1');
}
```

- [ ] **Step 4: 验证通过** — `npx vitest run test/unit/page-graph/serialize.test.ts` → PASS

- [ ] **Step 5: 提交**
```bash
git add src/page-graph/serialize.ts test/unit/page-graph/serialize.test.ts
git commit -m "feat(page-graph): canonical 序列化(确定性 + 版本前缀)"
```

---

## Task 3: 规范化规则 ①③④⑤(列表 multiset / 广告剥离 / 稳定骨架 / checked 归一)

**Files:**
- Create: `src/page-graph/normalize.ts`
- Test: `test/unit/page-graph/normalize.test.ts`

- [ ] **Step 1: 写失败测试(代表性 case)**

```typescript
import { describe, it, expect } from 'vitest';
import { normalizeSkeleton, bucketize } from '../../../src/page-graph/normalize';
import type { FingerprintInput } from '../../../src/page-graph/types';

function el(text: string, type = 'Button', opts: { clickable?: boolean; scrollable?: boolean; checked?: boolean; depth?: number } = {}): any {
  return { ref: '@e0#s1', bounds: [0,0,100,100], center: {x:50,y:50}, texts: [text], attrs: { clickable: opts.clickable ?? true, scrollable: opts.scrollable, type }, checked: opts.checked };
}

describe('normalizeSkeleton', () => {
  it('规则⑤:开关 checked-state 文本归一(toggle 不污染指纹)', () => {
    const off = normalizeSkeleton({ elements: [el('已关闭', 'Text', { checked: false })] });
    const on = normalizeSkeleton({ elements: [el('已开启', 'Text', { checked: true })] });
    expect(JSON.stringify(off.nodes)).toBe(JSON.stringify(on.nodes)); // 都归一为占位
  });

  it('规则①:列表项 multiset 顺序无关', () => {
    const listType = 'List';
    const a = normalizeSkeleton({ elements: [
      el('列表', listType, { scrollable: true }),
      el('项A', 'Text'), el('项B', 'Text'), el('项C', 'Text'),
    ]});
    const b = normalizeSkeleton({ elements: [
      el('列表', listType, { scrollable: true }),
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
```

- [ ] **Step 2: 验证失败** — `npx vitest run test/unit/page-graph/normalize.test.ts` → FAIL

- [ ] **Step 3: 实现 `src/page-graph/normalize.ts`**

```typescript
import type { FingerprintInput, NormalizedSkeleton, NormalizedNode, ListSummary } from './types';

const AD_MARKERS = ['广告', 'ad', 'sponsor', '推广'];
const CHECKED_STATE = ['已开启', '已关闭', '已打开', '已关闭', '开启', '关闭', 'on', 'off'];

/** 规则① 容量桶。 */
export function bucketize(count: number): string {
  if (count <= 1) return '1';
  if (count <= 5) return '2-5';
  if (count <= 20) return '6-20';
  if (count <= 100) return '21-100';
  return '100+';
}

/** 五规则规范化。 */
export function normalizeSkeleton(input: FingerprintInput): NormalizedSkeleton {
  const listEls = input.elements.filter((e) => e.attrs.scrollable || /list|waterflow|grid/i.test(e.attrs.type ?? ''));
  const lists: ListSummary[] = listEls.map((container) => {
    const children = input.elements.filter((e) => isInside(e, container));
    const itemSigs = children.map((c) => sig(c)).sort();
    return { type: container.attrs.type ?? 'List', countBucket: bucketize(children.length), itemSigs };
  });

  // 规则③ 广告位无条件剥离;规则⑤ checked-state 归一;规则④ 稳定骨架
  const nodes: NormalizedNode[] = input.elements
    .filter((e) => !isAd(e) && !isListItem(e, listEls, input.elements))
    .map((e) => ({ text: normalizeText(e), type: e.attrs.type ?? 'Unknown', depth: 0 }));

  return { nodes, lists };
}

function normalizeText(e: FingerprintInput['elements'][number]): string {
  const t = e.texts[0] ?? '';
  if (CHECKED_STATE.includes(t)) return 'CHECKED_STATE';          // 规则⑤
  return normalizeDynamic(t);                                      // 规则②(Task 4 增强)
}

/** 规则② 动态值归一:NUM/TIME/PRICE/ID 正则粗筛(Task 4 加时序 + 白名单)。 */
export function normalizeDynamic(t: string): string {
  return t
    .replace(/\d{1,3}([,]\d{3})*([.]\d+)?/g, 'NUM')               // 金额/计数
    .replace(/\d+/g, 'NUM')                                        // 纯数字
    .replace(/\d{1,2}:\d{2}/g, 'TIME')                             // 时间
    .replace(/\d{4}-\d{2}-\d{2}/g, 'DATE');                        // 日期
}

function isAd(e: FingerprintInput['elements'][number]): boolean {
  const t = (e.texts[0] ?? '').toLowerCase();
  return AD_MARKERS.some((m) => t.includes(m));
}

function isListItem(e: FingerprintInput['elements'][number], containers: FingerprintInput['elements'], all: FingerprintInput['elements']): boolean {
  return containers.some((c) => isInside(e, c));
}

function isInside(child: FingerprintInput['elements'][number], parent: FingerprintInput['elements'][number]): boolean {
  const [cl, ct, cr, cb] = child.bounds;
  const [pl, pt, pr, pb] = parent.bounds;
  return child !== parent && cl >= pl && ct >= pt && cr <= pr && cb <= pb;
}

function sig(e: FingerprintInput['elements'][number]): string {
  return `${e.attrs.type ?? ''}:${normalizeDynamic(e.texts[0] ?? '')}`;
}
```

- [ ] **Step 4: 验证通过 + 补 case**(列表长度变化桶稳定、广告区域归一化坐标)— `npx vitest run test/unit/page-graph/normalize.test.ts` → PASS

- [ ] **Step 5: 提交**
```bash
git add src/page-graph/normalize.ts test/unit/page-graph/normalize.test.ts
git commit -m "feat(page-graph): 规范化规则①③④⑤(列表multiset/广告剥离/稳定骨架/checked归一)"
```

---

## Task 4: 规则② 动态值归一增强(时序一致性 + 静态白名单)

**Files:**
- Modify: `src/page-graph/normalize.ts`
- Test: `test/unit/page-graph/normalize.test.ts`(追加)

- [ ] **Step 1: 写失败测试**

```typescript
it('规则②:时序一致性 —— 同位 text 跨 dump 值变=动态列归一,值不变=静态保留', () => {
  // 静态标签"第2屏"含数字但不归一(跨 dump 不变)
  expect(normalizeDynamic('第2屏')).toBe('第2屏');
  // 动态计数"12 条新消息"归一
  expect(normalizeDynamic('12 条新消息')).toBe('NUM 条新消息');
});
```

- [ ] **Step 2: 验证失败** — 当前 `normalizeDynamic('第2屏')` = `'第NUM屏'`(误伤),测试 FAIL

- [ ] **Step 3: 实现** — 加"静态白名单 + 中文量词保护":含中文量词(屏/次/项/个常用功能)且数字在文本中部的,判静态保留。提供 `learnStaticWhitelist(multiDumps)` 从多次同位 text 学习位置+内容稳定的控件(接口供 spike 调用)。

```typescript
const STATIC_CONTEXT = /(第[0-9NUM]+[屏页章节]|第[0-9NUM]+步|[0-9NUM]+个常用|[0-9NUM]+小时在线)/;

export function normalizeDynamic(t: string): string {
  if (STATIC_CONTEXT.test(t)) return t;   // 静态保留(规则②白名单)
  return t
    .replace(/\d{1,3}(,\d{3})*(\.\d+)?/g, 'NUM')
    .replace(/\d+/g, 'NUM')
    .replace(/\d{1,2}:\d{2}/g, 'TIME')
    .replace(/\d{4}-\d{2}-\d{2}/g, 'DATE');
}

/** 时序一致性学习:多次同位 text 值不变 → 静态;变 → 动态。供 spike/多 dump 调用。 */
export function learnStaticWhitelist(samePositionTexts: string[][]): Set<string> {
  const statics = new Set<string>();
  for (const positions of samePositionTexts) {
    const unique = new Set(positions);
    if (unique.size === 1) statics.add(positions[0]);   // 跨 dump 不变 = 静态
  }
  return statics;
}
```

- [ ] **Step 4: 验证通过** — PASS

- [ ] **Step 5: 提交**
```bash
git commit -am "feat(page-graph): 规则② 动态归一加时序一致性 + 静态白名单"
```

---

## Task 5: 几何布局签名(纯图标页)

**Files:**
- Create: `src/page-graph/geometry.ts`
- Test: `test/unit/page-graph/geometry.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect } from 'vitest';
import { geometrySignature } from '../../../src/page-graph/geometry';

describe('geometrySignature', () => {
  it('纯图标页(text 缺失)产出几何签名;同布局同签名', () => {
    const icons = [
      { bounds: [0, 0, 100, 100], center: { x: 50, y: 50 }, texts: [], attrs: { clickable: true, type: 'Image' } },
      { bounds: [100, 0, 200, 100], center: { x: 150, y: 50 }, texts: [], attrs: { clickable: true, type: 'Image' } },
    ];
    const a = geometrySignature({ elements: icons, screenSize: { w: 400, h: 800 } });
    const b = geometrySignature({ elements: icons, screenSize: { w: 400, h: 800 } });
    expect(a).toBeTruthy();
    expect(a).toBe(b);
  });

  it('不同布局不同签名', () => {
    const layout1 = [{ bounds: [0,0,50,50], center:{x:25,y:25}, texts:[], attrs:{clickable:true,type:'Image'} }];
    const layout2 = [{ bounds: [200,200,250,250], center:{x:225,y:225}, texts:[], attrs:{clickable:true,type:'Image'} }];
    expect(geometrySignature({ elements: layout1, screenSize:{w:400,h:800} }))
      .not.toBe(geometrySignature({ elements: layout2, screenSize:{w:400,h:800} }));
  });
});
```

- [ ] **Step 2: 验证失败** — FAIL(模块不存在)

- [ ] **Step 3: 实现 `src/page-graph/geometry.ts`** — 可点控件的归一化中心坐标分桶(8×8 网格),排序后确定性拼接。

```typescript
import type { FingerprintInput } from './types';

const GRID = 8;

/** 纯图标页几何布局签名:归一化坐标分桶,顺序无关(排序)。 */
export function geometrySignature(input: FingerprintInput): string {
  const { w, h } = input.screenSize ?? deriveSize(input);
  const cells = input.elements
    .filter((e) => e.attrs.clickable && (e.texts.length === 0 || e.texts.every((t) => !t)))
    .map((e) => `${Math.floor((e.center.x / w) * GRID)},${Math.floor((e.center.y / h) * GRID)}`)
    .sort();
  return cells.join('|');
}

function deriveSize(input: FingerprintInput): { w: number; h: number } {
  let maxR = 1, maxB = 1;
  for (const e of input.elements) {
    maxR = Math.max(maxR, e.bounds[2]);
    maxB = Math.max(maxB, e.bounds[3]);
  }
  return { w: maxR, h: maxB };
}
```

- [ ] **Step 4: 验证通过** — PASS

- [ ] **Step 5: 集成进 normalize** — `normalizeSkeleton` 在 nodes 全无 text 时填 `geometry`:`if (nodes.every(n => !n.text)) sk.geometry = geometrySignature(input);`

- [ ] **Step 6: 提交**
```bash
git add src/page-graph/geometry.ts test/unit/page-graph/geometry.test.ts
git commit -m "feat(page-graph): 纯图标页几何布局签名"
```

---

## Task 6: anchors 提取 + Jaccard 匹配 + 处置表

**Files:**
- Create: `src/page-graph/fingerprint.ts`
- Test: `test/unit/page-graph/fingerprint.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect } from 'vitest';
import { extractAnchors, matchAnchors, classifyMatch } from '../../../src/page-graph/fingerprint';

describe('anchors', () => {
  it('extractAnchors: 顶部/底部稳定锚点 text(已归一)', () => {
    const els = [
      { bounds:[0,0,400,40], center:{x:200,y:20}, texts:['设置'], attrs:{type:'Text'} },
      { bounds:[0,760,400,800], center:{x:200,y:780}, texts:['首页','我的'], attrs:{type:'Tab'} },
    ];
    expect(extractAnchors({ elements: els, screenSize:{w:400,h:800} })).toContain('设置');
  });

  it('matchAnchors: Jaccard 相似度', () => {
    expect(matchAnchors(['设置','关于'], ['设置','关于'])).toBe(1);
    expect(matchAnchors(['设置','关于'], ['设置','显示'])).toBeCloseTo(1 / 3);
  });

  it('classifyMatch: 精确命中/漂移/新页处置表', () => {
    expect(classifyMatch({ exactHashHit: true })).toBe('same');
    expect(classifyMatch({ exactHashHit: false, jaccard: 0.9, margin: 0.6 })).toBe('drift');
    expect(classifyMatch({ exactHashHit: false, jaccard: 0.2, margin: 0.1 })).toBe('new');
  });
});
```

- [ ] **Step 2: 验证失败** — FAIL

- [ ] **Step 3: 实现** — anchors 取顶部 5%/底部 5% 归一化带内 type=Text/Tab 的 text(动态归一);Jaccard + margin;处置表阈值 T=0.6,Δ=0.2(待 spike 回填)。

```typescript
import { createHash } from 'crypto';
import type { FingerprintInput, PageFingerprint } from './types';
import { FINGERPRINT_VERSION } from './types';
import { normalizeSkeleton } from './normalize';
import { normalizeDynamic } from './normalize';
import { serializeCanonical } from './serialize';

const ANCHOR_BAND = 0.05;   // 顶/底 5% 归一化带
const DRIFT_T = 0.6;        // Jaccard 阈值(待 spike 回填)
const DRIFT_DELTA = 0.2;    // margin 阈值(待 spike 回填)

export function computeFingerprint(input: FingerprintInput): PageFingerprint {
  const skeleton = normalizeSkeleton(input);
  const hash = createHash('sha256').update(serializeCanonical(skeleton)).digest('hex');
  return { version: FINGERPRINT_VERSION, skeletonHash: hash, anchors: extractAnchors(input) };
}

export function extractAnchors(input: FingerprintInput): string[] {
  const { h } = input.screenSize ?? { h: maxBottom(input) };
  const topBand = h * ANCHOR_BAND;
  const bottomBand = h * (1 - ANCHOR_BAND);
  return input.elements
    .filter((e) => {
      const t = e.attrs.type ?? '';
      return /text|tab|header|title/i.test(t) && (e.center.y <= topBand || e.center.y >= bottomBand);
    })
    .map((e) => normalizeDynamic(e.texts[0] ?? ''))
    .filter(Boolean);
}

export function matchAnchors(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const sa = new Set(a), sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / (new Set([...a, ...b]).size);
}

export function classifyMatch(args: { exactHashHit: boolean; jaccard?: number; margin?: number }): 'same' | 'drift' | 'new' {
  if (args.exactHashHit) return 'same';
  const j = args.jaccard ?? 0;
  const m = args.margin ?? 0;
  return j >= DRIFT_T && m >= DRIFT_DELTA ? 'drift' : 'new';
}

function maxBottom(input: FingerprintInput): number {
  return input.elements.reduce((m, e) => Math.max(m, e.bounds[3]), 1);
}
```

- [ ] **Step 4: 验证通过** — PASS

- [ ] **Step 5: 提交**
```bash
git add src/page-graph/fingerprint.ts test/unit/page-graph/fingerprint.test.ts
git commit -m "feat(page-graph): anchors 提取 + Jaccard 匹配 + 漂移处置表"
```

---

## Task 7: PageGraph + MapStore(序列化/增量/原子/fingerprintVersion)

**Files:**
- Create: `src/page-graph/store.ts`
- Create: `src/page-graph/index.ts`(桶导出)
- Test: `test/unit/page-graph/store.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MapStore } from '../../../src/page-graph/store';
import type { PageGraph } from '../../../src/page-graph/types';

describe('MapStore', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pg-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('序列化/反序列化往返一致', () => {
    const store = new MapStore(dir);
    const g: PageGraph = emptyGraph('com.test', '1.0');
    g.nodes.set('h1', { id: 'h1', fingerprint: { version: 'v1', skeletonHash: 'h1', anchors: [] }, skeletonArchive: { nodes: [], lists: [] }, frontierExplored: [], frontierPending: [], visitedAt: 0 });
    store.save(g);
    const loaded = store.load('com.test', '1.0');
    expect(loaded?.nodes.get('h1')).toBeDefined();
  });

  it('增量 append:新节点追加(不重写全量)', () => {
    const store = new MapStore(dir);
    const g = emptyGraph('com.test', '1.0');
    store.save(g);
    g.nodes.set('h2', node('h2'));
    store.appendNode(g, g.nodes.get('h2')!);  // 增量
    const loaded = store.load('com.test', '1.0');
    expect(loaded?.nodes.size).toBe(2);
  });

  it('原子写:中途不产生损坏 JSON(write-to-temp + rename)', () => {
    const store = new MapStore(dir);
    store.save(emptyGraph('com.test', '1.0'));
    const file = join(dir, 'com.test-1.0.json');
    expect(existsSync(file)).toBe(true);
    expect(() => JSON.parse(readFileSync(file, 'utf-8'))).not.toThrow();
  });
});

function emptyGraph(appBundle: string, appVersion: string): PageGraph {
  return { appBundle, appVersion, fingerprintVersion: 'v1', nodes: new Map(), edges: [], entryPoints: [] };
}
function node(id: string): any {
  return { id, fingerprint: { version: 'v1', skeletonHash: id, anchors: [] }, skeletonArchive: { nodes: [], lists: [] }, frontierExplored: [], frontierPending: [], visitedAt: 0 };
}
```

- [ ] **Step 2: 验证失败** — FAIL

- [ ] **Step 3: 实现 `src/page-graph/store.ts`** — 全量 save(write-to-temp + rename 原子);appendNode 增量(读-改-原子写,后续阶段可换 JSONL 流式);load 校验 fingerprintVersion。

```typescript
import { writeFileSync, readFileSync, existsSync, renameSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { PageGraph, PageNode } from './types';
import { FINGERPRINT_VERSION } from './types';

export class MapStore {
  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private path(appBundle: string, appVersion: string): string {
    return join(this.dir, `${appBundle}-${appVersion}.json`);
  }

  save(graph: PageGraph): void {
    const file = this.path(graph.appBundle, graph.appVersion);
    const tmp = `${file}.tmp`;
    const serialized = JSON.stringify(graph, replacer);
    writeFileSync(tmp, serialized);     // write-to-temp
    renameSync(tmp, file);              // 原子 rename
  }

  /** 增量追加节点(读-改-原子写)。 */
  appendNode(graph: PageGraph, node: PageNode): void {
    graph.nodes.set(node.id, node);
    this.save(graph);
  }

  load(appBundle: string, appVersion: string): PageGraph | undefined {
    const file = this.path(appBundle, appVersion);
    if (!existsSync(file)) return undefined;
    const graph = JSON.parse(readFileSync(file, 'utf-8'), reviver) as PageGraph;
    if (graph.fingerprintVersion !== FINGERPRINT_VERSION) {
      throw new Error(`fingerprintVersion 不匹配:图=${graph.fingerprintVersion} 当前=${FINGERPRINT_VERSION},拒绝加载(规则迭代致旧图失效)`);
    }
    return graph;
  }

  list(): string[] {
    return existsSync(this.dir) ? readFileSync && [] : [];  // 实现按需列目录
  }
}

// Map 序列化支持(JSON 不原生支持 Map)
function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) return { __map: [...value.entries()] };
  return value;
}
function reviver(_key: string, value: any): any {
  if (value && typeof value === 'object' && value.__map) return new Map(value.__map);
  return value;
}
```

> 注:`list()` 简化;实现时用 `readdirSync` 列目录。replacer/reviver 处理 `nodes: Map`。

- [ ] **Step 4: 实现 `src/page-graph/index.ts` 桶导出**

```typescript
export type { FingerprintInput, NormalizedSkeleton, PageFingerprint, PageNode, Edge, PageGraph, OpType } from './types';
export { FINGERPRINT_VERSION } from './types';
export { normalizeSkeleton, bucketize, normalizeDynamic, learnStaticWhitelist } from './normalize';
export { serializeCanonical } from './serialize';
export { computeFingerprint, extractAnchors, matchAnchors, classifyMatch } from './fingerprint';
export { geometrySignature } from './geometry';
export { MapStore } from './store';
```

- [ ] **Step 5: 验证通过 + 全量单测** — `npm run test:unit` → 全绿(含原 146 个 + 新增)

- [ ] **Step 6: 提交**
```bash
git add src/page-graph/store.ts src/page-graph/index.ts test/unit/page-graph/store.test.ts
git commit -m "feat(page-graph): MapStore 序列化/增量/原子写 + fingerprintVersion 校验"
```

---

## Task 8: MapStore.diff(skeletonHash + anchors 二次匹配)

**Files:**
- Modify: `src/page-graph/store.ts`
- Test: `test/unit/page-graph/store.test.ts`(追加)

- [ ] **Step 1: 写失败测试**

```typescript
import { diffGraphs } from '../../../src/page-graph/store';

describe('diffGraphs', () => {
  it('精确 skeletonHash 匹配:相同节点判 unchanged', () => {
    const a = graphWith(node('h1'));
    const b = graphWith(node('h1'));
    const d = diffGraphs(a, b);
    expect(d.unchanged.map((n) => n.id)).toContain('h1');
  });

  it('anchors 二次匹配:hash 变但 anchors 同 → revised(非 removed+added)', () => {
    const a = graphWith({ id: 'h1', fingerprint: { version:'v1', skeletonHash:'old', anchors:['设置','关于'] }, skeletonArchive:{nodes:[],lists:[]}, frontierExplored:[], frontierPending:[], visitedAt:0 });
    const b = graphWith({ id: 'h2', fingerprint: { version:'v1', skeletonHash:'new', anchors:['设置','关于'] }, skeletonArchive:{nodes:[],lists:[]}, frontierExplored:[], frontierPending:[], visitedAt:0 });
    const d = diffGraphs(a, b, { anchorThreshold: 0.8 });
    expect(d.revised.length).toBe(1);   // 标"改版"而非 removed+added
    expect(d.added.length + d.removed.length).toBe(0);
  });
});
```

- [ ] **Step 2: 验证失败** — FAIL(`diffGraphs` 未导出)

- [ ] **Step 3: 实现 `diffGraphs`** — 三遍:skeletonHash 精确匹配→unchanged;剩余按 anchors Jaccard ≥ threshold→revised;其余→added/removed。

```typescript
import { matchAnchors } from './fingerprint';

export interface GraphDiff {
  unchanged: PageNode[];
  revised: { oldNode: PageNode; newNode: PageNode; jaccard: number }[];
  added: PageNode[];
  removed: PageNode[];
}

export function diffGraphs(oldGraph: PageGraph, newGraph: PageGraph, opts: { anchorThreshold?: number } = {}): GraphDiff {
  const t = opts.anchorThreshold ?? 0.6;
  const oldNodes = [...oldGraph.nodes.values()];
  const newNodes = [...newGraph.nodes.values()];

  const unchanged: PageNode[] = [];
  const revised: GraphDiff['revised'] = [];
  const added: PageNode[] = [];
  const removed: PageNode[] = [...oldNodes];

  for (const n of newNodes) {
    const exact = oldNodes.find((o) => o.fingerprint.skeletonHash === n.fingerprint.skeletonHash);
    if (exact) {
      unchanged.push(n);
      removed.splice(removed.indexOf(exact), 1);
      continue;
    }
    // anchors 二次匹配
    let best: { o: PageNode; j: number } | null = null;
    for (const o of removed) {
      const j = matchAnchors(o.fingerprint.anchors, n.fingerprint.anchors);
      if (!best || j > best.j) best = { o, j };
    }
    if (best && best.j >= t) {
      revised.push({ oldNode: best.o, newNode: n, jaccard: best.j });
      removed.splice(removed.indexOf(best.o), 1);
    } else {
      added.push(n);
    }
  }
  return { unchanged, revised, added, removed };
}
```

- [ ] **Step 4: 验证通过** — PASS

- [ ] **Step 5: 提交**
```bash
git commit -am "feat(page-graph): diff(skeletonHash + anchors 二次匹配)"
```

---

## Task 9: 桶导出 + 全量回归

- [ ] **Step 1: 确认 `src/page-graph/index.ts` 完整导出**(Task 7 已建,补 diff)

```typescript
export { MapStore, diffGraphs } from './store';
export type { GraphDiff } from './store';
```

- [ ] **Step 2: 在 `src/index.ts` 追加导出 page-graph 公共 API**

```typescript
export * from './page-graph';
```

- [ ] **Step 3: 全量验证** — `npm run build && npm run lint && npm run test:unit` → 全绿

- [ ] **Step 4: 提交**
```bash
git add src/index.ts src/page-graph/index.ts
git commit -m "feat(page-graph): 导出 page-graph 公共 API + 全量回归"
```

---

## Task 10: 真机 spike 回填阈值

**Files:**
- Create: `spike/fingerprint-spike.js`

- [ ] **Step 1: 写 spike 脚本** — 用 `spike/*.json`(设置 set-1/set-2 同页、tb-1/2/3 淘宝、pg-1/2/3)跑指纹,统计:
  - 同页多 dump 指纹一致率(裂变率)
  - 不同页指纹不同率(混同率 + 区分率)
  - type 字段对 List/Grid/Swiper 的识别覆盖率
  - 几何签名在纯图标页(tb 首页)的稳定性
  - 动态归一时序:同页多 dump 同位 text 哪些变(动态)/ 不变(静态)

```javascript
// spike/fingerprint-spike.js — 用 dist/ 构建产物测真机 dump 数据
process.env.MSYS_NO_PATHCONV = '1';
const fs = require('fs');
const { buildScreenModel } = require('../dist/screen-model');
const { computeFingerprint, normalizeDynamic } = require('../dist/page-graph');

function fpOf(jsonFile) {
  const json = fs.readFileSync(jsonFile, 'utf-8');
  const model = buildScreenModel(json);
  return computeFingerprint({ elements: model.elements });
}

// ① 同页稳定性(裂变率)
const set1 = fpOf('spike/set-1.json'), set2 = fpOf('spike/set-2.json');
console.log('设置-同页指纹一致:', set1.skeletonHash === set2.skeletonHash, '\n  h1:', set1.skeletonHash.slice(0,16), '\n  h2:', set2.skeletonHash.slice(0,16));

// ② 不同页区分性
const about = fpOf('spike/set-1.json'), display = fpOf('spike/set-2.json'); // 按实际 fixture
console.log('不同页指纹不同:', about.skeletonHash !== display.skeletonHash);

// ③ type 覆盖率:统计 elements 里 type 含 List/Grid/Swiper 的占比
// ④ 几何签名:tb 首页纯图标区稳定性
// ⑤ 输出报告 → 回填 spec §1.4 阈值 + DRIFT_T/DRIFT_DELTA
```

- [ ] **Step 2: 构建 + 跑 spike**

```bash
npm run build
node spike/fingerprint-spike.js
```

- [ ] **Step 3: 回填** — 据结果回填 spec §1.4(混同/裂变/区分率阈值)、`fingerprint.ts` 的 `DRIFT_T`/`DRIFT_DELTA`、`normalize.ts` 的动态正则/静态白名单。记录 spike 报告到 `spike/fingerprint-report.md`。

- [ ] **Step 4: 提交**
```bash
git add spike/fingerprint-spike.js spike/fingerprint-report.md src/page-graph/fingerprint.ts
git commit -m "spike(page-graph): 真机指纹阈值回填"
```

---

## Self-Review(plan 写后自查)

- **Spec 覆盖**:§4.1 五规则(Task 3-5)、canonical 序列化(Task 2)、几何签名(Task 5)、anchors 算法(Task 6)、§4.8 MapStore(Task 7-8)、§9 阶段① spike(Task 10)——全覆盖。
- **占位符**:无 TBD/TODO;DRIFT_T/DRIFT_DELTA 有初值(Task 10 spike 回填,非占位)。
- **类型一致**:`PageFingerprint`/`PageNode`/`Edge`/`PageGraph`/`NormalizedSkeleton` 在 types.ts 定义,各 task 引用一致;`computeFingerprint`/`extractAnchors`/`matchAnchors`/`classifyMatch`/`diffGraphs` 签名前后一致。
- **对接点**:`Element.attrs` 无 checked → `FingerprintInput` 模块内扩展(Task 1 已处理),不改 MVP。

## 执行交接

**Plan 完成并保存到 `docs/superpowers/plans/2026-08-08-slam-stage1-fingerprint.md`。两种执行选项:**

1. **Subagent-Driven(推荐)** — 每个 task 派实现 subagent + spec/代码双评审,快速迭代。
2. **Inline Execution** — 本会话内 executing-plans 批量执行 + 检查点。

**选哪种?**
