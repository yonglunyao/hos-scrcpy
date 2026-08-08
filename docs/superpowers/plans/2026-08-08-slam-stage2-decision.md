# SLAM 阶段②:决策器最小版(弹窗检测 + 剥离 + 四分类)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task. Steps use checkbox (`- [ ]`).

**Goal:** 实现 DecisionEngine 最小版 —— 弹窗结构性检测(不靠 text)+ 指纹前剥离(纯函数)+ 不一致四分类(popup/consistent/partial_revision/full_revision)。

**Architecture:** 纯函数,新增 `src/page-graph/popup.ts` + `decision.ts`,建在阶段① 指纹(`computeFingerprint`/`matchAnchors`/`PageFingerprint`)之上。不涉及 act/Explorer(阶段③);剥离函数供阶段③ ActExecutor 调用。

**Tech Stack:** TypeScript (CJS/ES2020/strict)、vitest。复用 `src/page-graph` 阶段① 产出。

**关联 spec:** `docs/superpowers/specs/2026-08-08-slam-autoexplore-design.md` §4.6(DecisionEngine)、§4.2(ActExecutor 内弹窗剥离,本阶段提供函数)、§9 阶段②。

---

## File Structure

| 文件 | 职责 |
|---|---|
| `src/page-graph/popup.ts` | `detectPopup(input): PopupInfo \| null`(顶层 dialog/sheet/popup type + 全屏遮罩)、`stripPopup(input): FingerprintInput`(剥离弹窗控件树,返回底层页) |
| `src/page-graph/decision.ts` | `classifyInconsistency(expected, actual, popup): InconsistencyKind`(四分类) |
| `src/page-graph/index.ts` | 补导出 popup/decision |
| `test/unit/page-graph/popup.test.ts`、`decision.test.ts` | 测试 |

**关键设计(spec §4.6):**
- 弹窗检测用**结构性信号**(type 含 dialog/sheet/popup/modal/menu + 全屏半透明遮罩),**不靠 text**(图标×、业务弹窗都覆盖)。
- 剥离:移除遮罩 + 弹窗控件子树,保留底层页;剥离后用底层页算指纹 → 弹窗出现与否指纹一致。
- 四分类:有弹窗→popup;skeletonHash 同→consistent(动态噪声已吸收);hash 不同 + anchors Jaccard 高→partial_revision;低→full_revision。
- `PARTIAL_T` 阈值初值 0.6(与 diffGraphs anchorThreshold 一致,待真机 spike 回填)。

---

## Task 1: 弹窗结构性检测(detectPopup)

**Files:** Create `src/page-graph/popup.ts`、`test/unit/page-graph/popup.test.ts`

- [ ] **Step 1: 失败测试**

```typescript
import { describe, it, expect } from 'vitest';
import { detectPopup } from '../../../src/page-graph/popup';
import type { FingerprintInput } from '../../../src/page-graph/types';

function el(type: string, bounds: number[], opts: { clickable?: boolean; text?: string } = {}): FingerprintInput['elements'][number] {
  return { ref: '@e0#s1', bounds, center: { x: (bounds[0]+bounds[2])/2, y: (bounds[1]+bounds[3])/2 }, texts: opts.text ? [opts.text] : [], attrs: { clickable: opts.clickable, type } };
}

describe('detectPopup', () => {
  it('无弹窗(普通页)→ null', () => {
    const input: FingerprintInput = { elements: [el('Text', [0,0,400,40]), el('Button', [10,500,200,560], {clickable:true, text:'确定'})], screenSize: { w: 400, h: 800 } };
    expect(detectPopup(input)).toBeNull();
  });
  it('全屏遮罩(归一化面积 ≥0.9 + clickable)→ 检出', () => {
    const input: FingerprintInput = { elements: [el('Text', [0,0,400,40]), el('Stack', [0,0,400,800], {clickable:true})], screenSize: { w: 400, h: 800 } };
    expect(detectPopup(input)).not.toBeNull();
  });
  it('type 含 dialog/sheet/popup/modal → 检出', () => {
    const input: FingerprintInput = { elements: [el('Dialog', [50,200,350,600]), el('Text', [0,0,400,40])], screenSize: { w: 400, h: 800 } };
    const p = detectPopup(input);
    expect(p).not.toBeNull();
    expect(p!.kind).toMatch(/dialog|sheet|popup|modal/);
  });
});
```

- [ ] **Step 2: 验证失败** → FAIL(模块不存在)

- [ ] **Step 3: 实现 `src/page-graph/popup.ts`**

```typescript
import type { FingerprintInput } from './types';

export interface PopupInfo {
  kind: string;            // dialog/sheet/popup/modal/mask
  maskBounds?: number[];
}

const POPUP_TYPE = /dialog|sheet|popup|modal|menu/i;
const MASK_AREA_RATIO = 0.9;   // 全屏遮罩:归一化面积 ≥0.9

/** 弹窗结构性检测:顶层 dialog/sheet/popup type 或全屏半透明遮罩。不靠 text。 */
export function detectPopup(input: FingerprintInput): PopupInfo | null {
  const { w, h } = input.screenSize ?? deriveSize(input);
  const screenArea = w * h;

  const mask = input.elements.find((e) => {
    const a = area(e.bounds);
    return e.attrs.clickable && a / screenArea >= MASK_AREA_RATIO;
  });
  if (mask) return { kind: 'mask', maskBounds: mask.bounds };

  const popup = input.elements.find((e) => POPUP_TYPE.test(e.attrs.type ?? ''));
  if (popup) return { kind: (popup.attrs.type ?? 'popup').toLowerCase() };

  return null;
}

function area(b: number[]): number {
  return Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
}

function deriveSize(input: FingerprintInput): { w: number; h: number } {
  let maxR = 1, maxB = 1;
  for (const e of input.elements) { maxR = Math.max(maxR, e.bounds[2]); maxB = Math.max(maxB, e.bounds[3]); }
  return { w: maxR, h: maxB };
}
```

- [ ] **Step 4: 验证通过 + 提交**
```bash
npx vitest run test/unit/page-graph/popup.test.ts   # PASS
git add src/page-graph/popup.ts test/unit/page-graph/popup.test.ts
git commit -m "feat(page-graph): 弹窗结构性检测(全屏遮罩 + dialog/sheet/popup type)"
```

---

## Task 2: 弹窗剥离(stripPopup)

**Files:** Modify `src/page-graph/popup.ts`、`test/unit/page-graph/popup.test.ts`(追加)

- [ ] **Step 1: 失败测试**

```typescript
import { stripPopup } from '../../../src/page-graph/popup';

describe('stripPopup', () => {
  it('剥离弹窗控件树 + 遮罩,保留底层页', () => {
    const input: FingerprintInput = {
      elements: [
        el('Text', [0,0,400,40], {text:'底层标题'}),
        el('Button', [10,500,200,560], {clickable:true, text:'底层按钮'}),
        el('Stack', [0,0,400,800], {clickable:true}),          // 遮罩
        el('Dialog', [50,200,350,600]),                          // 弹窗容器
        el('Text', [60,220,340,260], {text:'弹窗内容'}),        // 弹窗子项
      ],
      screenSize: { w: 400, h: 800 },
    };
    const stripped = stripPopup(input);
    const texts = stripped.elements.flatMap((e) => e.texts);
    expect(texts).toContain('底层标题');
    expect(texts).toContain('底层按钮');
    expect(texts).not.toContain('弹窗内容');   // 弹窗子项剥离
  });

  it('无弹窗 → 原样返回(底层页指纹不变)', () => {
    const input: FingerprintInput = { elements: [el('Text', [0,0,400,40], {text:'页'})], screenSize: { w: 400, h: 800 } };
    expect(stripPopup(input).elements).toEqual(input.elements);
  });

  it('剥离后 computeFingerprint 与无弹窗同页一致(指纹不随弹窗变化)', () => {
    const { computeFingerprint } = require('../../../src/page-graph/fingerprint');
    const base: FingerprintInput = { elements: [el('Text',[0,0,400,40],{text:'页'}), el('Button',[10,500,200,560],{clickable:true,text:'确定'})], screenSize:{w:400,h:800} };
    const withPopup: FingerprintInput = { ...base, elements: [...base.elements, el('Stack',[0,0,400,800],{clickable:true}), el('Dialog',[50,200,350,600]), el('Text',[60,220,340,260],{text:'弹窗'})] };
    expect(computeFingerprint(stripPopup(withPopup)).skeletonHash).toBe(computeFingerprint(base).skeletonHash);
  });
});
```

- [ ] **Step 2: 验证失败** → stripPopup 未实现

- [ ] **Step 3: 实现** —— 移除遮罩 + 弹窗容器及其几何包含的子项:

```typescript
/** 弹窗剥离:移除遮罩 + 弹窗控件子树,返回底层页 input。 */
export function stripPopup(input: FingerprintInput): FingerprintInput {
  const popup = detectPopup(input);
  if (!popup) return input;

  // 要移除的区域:遮罩 bounds + 所有弹窗类型容器的 bounds
  const removeBounds: number[][] = [];
  if (popup.maskBounds) removeBounds.push(popup.maskBounds);
  for (const e of input.elements) {
    if (POPUP_TYPE.test(e.attrs.type ?? '')) removeBounds.push(e.bounds);
  }

  const elements = input.elements.filter((e) => {
    // 遮罩自身或弹窗容器自身
    if (removeBounds.some((rb) => sameBounds(e.bounds, rb))) return false;
    // 被任一移除区域几何包含的子项
    if (removeBounds.some((rb) => isInside(e.bounds, rb))) return false;
    return true;
  });

  return { ...input, elements };
}

function sameBounds(a: number[], b: number[]): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}
function isInside(child: number[], parent: number[]): boolean {
  return child[0] >= parent[0] && child[1] >= parent[1] && child[2] <= parent[2] && child[3] <= parent[3];
}
```

- [ ] **Step 4: 验证通过(含 computeFingerprint 一致性测试) + 提交**
```bash
npm run test:unit   # 全绿(204 + 新增)
git add src/page-graph/popup.ts test/unit/page-graph/popup.test.ts
git commit -m "feat(page-graph): 弹窗剥离(stripPopup,指纹不随弹窗变化)"
```

---

## Task 3: 不一致四分类(classifyInconsistency)

**Files:** Create `src/page-graph/decision.ts`、`test/unit/page-graph/decision.test.ts`

- [ ] **Step 1: 失败测试**

```typescript
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
    expect(classifyInconsistency(fp('h1', ['设置','关于','显示','声音','电池']), fp('h2', ['设置','关于','显示','声音','网络']), null))
      .toBe('partial_revision');   // Jaccard 4/6 ≈ 0.67 ≥ 0.6
  });
  it('hash 不同 + anchors 低重叠 → full_revision(整体改版)', () => {
    expect(classifyInconsistency(fp('h1', ['设置','关于']), fp('h2', ['购物','支付']), null)).toBe('full_revision');
  });
});
```

- [ ] **Step 2: 验证失败** → FAIL

- [ ] **Step 3: 实现 `src/page-graph/decision.ts`**

```typescript
import type { PageFingerprint } from './types';
import type { PopupInfo } from './popup';
import { matchAnchors } from './fingerprint';

export type InconsistencyKind = 'popup' | 'consistent' | 'partial_revision' | 'full_revision';

const PARTIAL_T = 0.6;   // 局部改版 anchors 重叠阈值(待真机 spike 回填)

/** 不一致四分类:弹窗/一致(动态噪声吸收)/局部改版/整体改版。 */
export function classifyInconsistency(
  expected: PageFingerprint,
  actual: PageFingerprint,
  popup: PopupInfo | null,
): InconsistencyKind {
  if (popup) return 'popup';
  if (expected.skeletonHash === actual.skeletonHash) return 'consistent';
  const j = matchAnchors(expected.anchors, actual.anchors);
  return j >= PARTIAL_T ? 'partial_revision' : 'full_revision';
}
```

- [ ] **Step 4: 验证通过 + 提交**
```bash
npx vitest run test/unit/page-graph/decision.test.ts
git add src/page-graph/decision.ts test/unit/page-graph/decision.test.ts
git commit -m "feat(page-graph): 不一致四分类(弹窗/一致/局部改版/整体改版)"
```

---

## Task 4: 桶导出 + 全量回归

- [ ] **Step 1: `src/page-graph/index.ts` 补导出**

```typescript
export { detectPopup, stripPopup } from './popup';
export type { PopupInfo } from './popup';
export { classifyInconsistency } from './decision';
export type { InconsistencyKind } from './decision';
```

- [ ] **Step 2: 全量验证**
```bash
npm run build && npm run lint && npm run test:unit   # 全绿
```

- [ ] **Step 3: 提交**
```bash
git add src/page-graph/index.ts
git commit -m "feat(page-graph): 导出 popup/decision API + 阶段②回归"
```

---

## Self-Review

- **Spec 覆盖**:§4.6 弹窗结构性检测(Task 1)+ 指纹前剥离(Task 2)+ 四分类(Task 3)全覆盖;§9 阶段②交付物达成。
- **占位符**:PARTIAL_T=0.6 初值(待 spike),非占位。
- **类型一致**:PopupInfo/InconsistencyKind 定义一致;classifyInconsistency 用 matchAnchors(阶段①)。
- **纯函数**:detectPopup/stripPopup/classifyInconsistency 无副作用,不依赖 act(阶段③ ActExecutor 调用它们)。
- **关键不变量**:stripPopup 后 computeFingerprint 与无弹窗同页一致(Task 2 测试固化)——弹窗不污染指纹。

## 执行交接

Plan 完成。沿用 subagent-driven(阶段① 模式):每 task implementer + controller review。从 Task 1 开始。
