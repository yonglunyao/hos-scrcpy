# 屏幕模型 + MCP @eN 操作(第一阶段)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 hos-scrcpy 增加统一的屏幕模型(ScreenModel)+ text 定位 + MCP `act(ref)`/`find(locator)` 工具,让 Claude agent 用 `@eN` 引用高效操作设备(免坐标搬运),普适含淘宝。

**Architecture:** `dumpLayout` → `flatten`(纯函数,下沉 `src/layout/`)→ `DumpProvider` 做 text 关联(`associateText`)→ `ScreenModel`(`Element` 带 `@eN#sN` 代际)→ `resolveLocator` 按 Locator 重定位 → MCP `dump_ui`(双输出)/`act(ref)`/`find(locator)`。核心全为纯函数,TDD 无设备先行。text 定位为主(spike 实证 76–88%),坐标兜底,Claude 视觉低频。

**Tech Stack:** TypeScript(CJS/ES2020/strict)、vitest(`test/unit`)、zod、@modelcontextprotocol/sdk。参考 spec:`docs/superpowers/specs/2026-08-08-anchored-replay-design.md`(v4)。

---

## File Structure

**新建:**
- `src/layout/types.ts` — `UiElement` 类型(扩展 enabled/scrollable/hint,id/key 分开)
- `src/layout/flatten.ts` — `flattenLayout` 纯函数(从 session.ts 迁移 + 扩展)
- `src/layout/dump.ts` — `dumpLayoutRaw`(DI 签名 `(device)=>string`,内存 Buffer 不落盘)
- `src/layout/index.ts` — barrel 导出
- `src/screen-model/types.ts` — `Element`/`ScreenModel`/`Locator`/`Source` 类型
- `src/screen-model/associate.ts` — `associateText`(可点击控件 ← 子树/重叠 text)纯函数
- `src/screen-model/dump-provider.ts` — `DumpProvider.capture()` + `buildScreenModel`(分配 @eN#sN)
- `src/screen-model/render.ts` — `renderModel`(给 agent 的紧凑文本)
- `src/screen-model/locator.ts` — `resolveLocator`(按 Locator 找 Element)纯函数
- `src/screen-model/index.ts` — barrel 导出
- `test/unit/layout/flatten.test.ts`
- `test/unit/screen-model/associate.test.ts`
- `test/unit/screen-model/render.test.ts`
- `test/unit/screen-model/locator.test.ts`

**修改:**
- `src/mcp/session.ts` — `flattenLayout`/`dumpLayoutRaw`/`UiElement` 改为从 `src/layout/` 重导出;增 `captureScreenModel`/`getCurrentModel`/`actByRef`/`findByLocator` + 代际状态
- `src/mcp/index.ts` — `dump_ui` 升级双输出;新增 `act`/`find` 工具
- `src/index.ts` — 导出 screen-model 公共类型/函数

---

## Task 1: 下沉 flattenLayout 到 src/layout/ + 扩展字段

**Files:**
- Create: `src/layout/types.ts`, `src/layout/flatten.ts`, `src/layout/index.ts`
- Test: `test/unit/layout/flatten.test.ts`

- [ ] **Step 1: 写失败测试**

Create `test/unit/layout/flatten.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { flattenLayout } from '../../../src/layout/flatten';

const node = (attrs: Record<string, string>, children: any[] = []) => ({ attributes: attrs, children });
const layout = JSON.stringify(node({ bounds: '[0,0][100,100]' }, [
  node({ id: 'wifi_entry', key: 'wifi_entry', type: 'Row', clickable: 'true', bounds: '[0,0][100,50]', enabled: 'true', scrollable: 'false' }),
  node({ type: 'Text', text: 'WLAN', bounds: '[0,0][40,50]' }),
  node({ type: 'SearchField', hint: '搜索设置项', bounds: '[0,50][100,60]' }),
  node({ type: 'List', scrollable: 'true', bounds: '[0,60][100,100]' }),
]));

describe('flattenLayout', () => {
  it('提取独立 id 与 key', () => {
    const els = flattenLayout(layout);
    const wifi = els.find((e) => e.id === 'wifi_entry');
    expect(wifi?.key).toBe('wifi_entry');
  });
  it('提取 enabled / scrollable / hint', () => {
    const els = flattenLayout(layout);
    expect(els.find((e) => e.type === 'Row')?.enabled).toBe(true);
    expect(els.find((e) => e.type === 'List')?.scrollable).toBe(true);
    expect(els.find((e) => e.type === 'SearchField')?.hint).toBe('搜索设置项');
  });
  it('保留 scrollable 容器(放宽过滤)', () => {
    const els = flattenLayout(layout);
    expect(els.some((e) => e.scrollable && e.type === 'List')).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/unit/layout/flatten.test.ts`
Expected: FAIL — 无法导入 `../../../src/layout/flatten`。

- [ ] **Step 3: 创建 types.ts**

Create `src/layout/types.ts`:
```ts
export interface UiElement {
  bounds: number[]; // [left, top, right, bottom]
  center: { x: number; y: number };
  text?: string;
  originalText?: string;
  hint?: string;
  id?: string;
  key?: string;
  type?: string;
  clickable?: boolean;
  scrollable?: boolean;
  enabled?: boolean;
  checkable?: boolean;
  checked?: boolean;
}
```

- [ ] **Step 4: 创建 flatten.ts(迁移 + 扩展)**

Create `src/layout/flatten.ts`(基于 `src/mcp/session.ts` 现有 flattenLayout,扩展字段 + 放宽 filter):
```ts
import type { UiElement } from './types';

function parseBoundsStr(s: string): number[] | undefined {
  const m = s.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  return m ? [+m[1], +m[2], +m[3], +m[4]] : undefined;
}
function strAttr(attrs: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) { const v = attrs[k]; if (typeof v === 'string' && v.trim() !== '') return v; }
  return undefined;
}
const isTrue = (v: unknown) => v === 'true';

export function flattenLayout(layoutStr: string): UiElement[] {
  let root: unknown;
  try { root = JSON.parse(layoutStr); } catch { return []; }
  const out: UiElement[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    const attrs = obj.attributes && typeof obj.attributes === 'object' ? obj.attributes as Record<string, unknown> : undefined;
    if (attrs) {
      const bounds = typeof attrs.bounds === 'string' ? parseBoundsStr(attrs.bounds) : undefined;
      if (bounds) {
        const text = strAttr(attrs, ['text']);
        const originalText = strAttr(attrs, ['originalText']);
        const id = strAttr(attrs, ['id']);
        const key = strAttr(attrs, ['key']);
        const type = strAttr(attrs, ['type']);
        const hint = strAttr(attrs, ['hint']);
        const clickable = isTrue(attrs.clickable);
        const scrollable = isTrue(attrs.scrollable);
        // 放宽:含 text/id/key/clickable/scrollable/hint 的节点都保留(原 filter 漏 scrollable/hint)
        if (text || originalText || id || key || clickable || scrollable || hint) {
          const el: UiElement = {
            bounds,
            center: { x: Math.round((bounds[0]! + bounds[2]!) / 2), y: Math.round((bounds[1]! + bounds[3]!) / 2) },
          };
          if (text) el.text = text;
          if (originalText) el.originalText = originalText;
          if (id) el.id = id;
          if (key) el.key = key;
          if (type) el.type = type;
          if (hint) el.hint = hint;
          if (clickable) el.clickable = true;
          if (scrollable) el.scrollable = true;
          if (attrs.enabled !== undefined) el.enabled = isTrue(attrs.enabled);
          if (attrs.checkable !== undefined) el.checkable = isTrue(attrs.checkable);
          if (attrs.checked !== undefined) el.checked = isTrue(attrs.checked);
          out.push(el);
        }
      }
    }
    if (Array.isArray(obj.children)) obj.children.forEach(visit);
  };
  visit(root);
  return out;
}
```

- [ ] **Step 5: 创建 index.ts barrel**

Create `src/layout/index.ts`:
```ts
export type { UiElement } from './types';
export { flattenLayout } from './flatten';
export { dumpLayoutRaw } from './dump';
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run test/unit/layout/flatten.test.ts`
Expected: PASS(4 tests)。注:`dump` 尚未创建,index.ts 的 dump 导出会在 Task 2 补;此处先临时把 index.ts 的 dump 行注释,或先创建 dump.ts 空壳。

- [ ] **Step 7: Commit**

```bash
git add src/layout/ test/unit/layout/flatten.test.ts
git commit -m "feat(layout): 下沉 flattenLayout 到 src/layout 并扩展字段(enabled/scrollable/hint/独立id-key)"
```

---

## Task 2: dumpLayoutRaw 下沉(DI 签名,内存 Buffer)

**Files:**
- Create: `src/layout/dump.ts`
- Modify: `src/mcp/session.ts`(flattenLayout/dumpLayoutRaw/UiElement 改重导出)

- [ ] **Step 1: 创建 dump.ts(DI 签名)**

Create `src/layout/dump.ts`:
```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { IDeviceManager } from '../device/interfaces';

const LAYOUT_REMOTE = '/data/local/tmp/mcp_layout.json';
const TIMEOUT_SEC = 5;

/** 通过命令行 uitest dumpLayout 获取布局 JSON。DI 签名(传入 device),避免循环 import;读后清理临时文件。 */
export async function dumpLayoutRaw(device: IDeviceManager): Promise<string> {
  await device.shell(`uitest dumpLayout -p ${LAYOUT_REMOTE}`, TIMEOUT_SEC);
  const local = path.join(os.tmpdir(), `hos-scrcpy-layout-${Date.now()}.json`);
  try {
    await device.getHdc().pullFile(LAYOUT_REMOTE, local);
    return fs.readFileSync(local, 'utf-8');
  } finally {
    fs.promises.unlink(local).catch(() => undefined);
  }
}
```

- [ ] **Step 2: 改 session.ts 重导出(保持向后兼容)**

In `src/mcp/session.ts`:删除原有 `flattenLayout`/`parseBoundsStr`/`strAttr`/`UiElement` 定义,改为:
```ts
import { flattenLayout, dumpLayoutRaw } from '../layout';
export { flattenLayout } from '../layout';
export type { UiElement } from '../layout';
```
`dumpLayoutRaw()` 原内嵌调用改为 `dumpLayoutRaw(requireSession().device)`(传 device)。

- [ ] **Step 3: 跑全量单测确认未破坏**

Run: `npx vitest run --dir test/unit`
Expected: PASS(原有单测不受影响;flattenLayout 行为等价)。

- [ ] **Step 4: Commit**

```bash
git add src/layout/dump.ts src/mcp/session.ts
git commit -m "refactor(layout): dumpLayoutRaw 下沉 src/layout,DI 签名+读后清理"
```

---

## Task 3: screen-model 类型定义

**Files:**
- Create: `src/screen-model/types.ts`, `src/screen-model/index.ts`

- [ ] **Step 1: 创建 types.ts**

Create `src/screen-model/types.ts`:
```ts
export type ElementRole = 'button' | 'text' | 'input' | 'image' | 'link' | 'list' | 'container' | 'unknown';

export interface Element {
  ref: string;            // '@eN#sN' — 元素序号 + snapshot 代际
  bounds: number[];       // [l,t,r,b]
  center: { x: number; y: number };
  texts: string[];        // 关联文字(子树 + 重叠邻近)
  hint?: string;
  attrs: {
    clickable?: boolean;
    scrollable?: boolean;
    enabled?: boolean;
    type?: string;        // 原始 type(role 用 type 代替,不强行推断 role)
  };
}

export interface ScreenModel {
  generation: number;     // snapshot 代际(单调递增)
  ts: number;
  elements: Element[];
}

export type TextMode = 'equals' | 'contains' | 'regex';

export interface Locator {
  text?: string;
  textMode?: TextMode;    // 默认 contains
  hint?: string;
  within?: Locator;       // 几何包含近似父子
  index?: number;         // 多匹配时取第 index 个(0-based)
  enabled?: boolean;
}
```

- [ ] **Step 2: 创建 index.ts(占位,后续 Task 补导出)**

Create `src/screen-model/index.ts`:
```ts
export type { Element, ScreenModel, Locator, ElementRole, TextMode } from './types';
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 0 errors。

- [ ] **Step 4: Commit**

```bash
git add src/screen-model/
git commit -m "feat(screen-model): 定义 Element/ScreenModel/Locator 类型(@eN#sN 代际)"
```

---

## Task 4: associateText(可点击控件 ← 子树/重叠 text)

**Files:**
- Create: `src/screen-model/associate.ts`
- Test: `test/unit/screen-model/associate.test.ts`

- [ ] **Step 1: 写失败测试**

Create `test/unit/screen-model/associate.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { associateText } from '../../../src/screen-model/associate';
import type { UiElement } from '../../../src/layout/types';

const el = (over: Partial<UiElement>): UiElement => ({ bounds: [0,0,100,50], center: {x:50,y:25}, ...over });
const overlap = (a: number[], b: number[]) => !(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]);

describe('associateText', () => {
  it('可点击控件本身有 text 时收入 texts', () => {
    const click = el({ clickable: true, text: '登录', bounds: [0,0,100,50] });
    const result = associateText([click]);
    expect(result[0].texts).toContain('登录');
  });
  it('可点击控件无 text 时,纳入 bounds 重叠的邻近 text 节点', () => {
    const click = el({ clickable: true, type: 'Stack', bounds: [0,0,100,50] });
    const label = el({ type: 'Text', text: 'WLAN', bounds: [0,0,40,50] }); // 重叠
    const far = el({ type: 'Text', text: 'other', bounds: [200,200,240,240] }); // 不重叠
    const result = associateText([click, label, far]);
    const c = result.find((e) => e.attrs.clickable);
    expect(c?.texts).toContain('WLAN');
    expect(c?.texts).not.toContain('other');
  });
  it('非可点击、无 text 的元素不出现在结果中(过滤纯容器)', () => {
    const container = el({ type: 'Stack', bounds: [0,0,100,100] });
    expect(associateText([container]).length).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/unit/screen-model/associate.test.ts`
Expected: FAIL — 无法导入 associate。

- [ ] **Step 3: 实现 associateText**

Create `src/screen-model/associate.ts`:
```ts
import type { UiElement } from '../layout/types';
import type { Element } from './types';

const overlap = (a: number[], b: number[]) =>
  !(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]);

/** 把 UiElement[] 关联成 Element[]:可点击控件收入自身 text + 重叠邻近 text;过滤无 text 的纯容器。 */
export function associateText(els: UiElement[]): Element[] {
  const textNodes = els.filter((e) => (e.text && e.text.trim()) || (e.originalText && e.originalText.trim()));
  return els
    .filter((e) => e.clickable || e.scrollable || (e.text && e.text.trim()) || (e.hint && e.hint.trim()))
    .map((e): Element => {
      const texts: string[] = [];
      const self = e.text?.trim() || e.originalText?.trim();
      if (self) texts.push(self);
      if (!self && (e.clickable || e.scrollable)) {
        // 无自身 text 的可交互控件:纳入 bounds 重叠的邻近 text
        for (const t of textNodes) {
          const tt = t.text?.trim() || t.originalText?.trim();
          if (tt && overlap(e.bounds, t.bounds) && !texts.includes(tt)) texts.push(tt);
        }
      }
      return {
        ref: '', // 由 buildScreenModel 分配
        bounds: e.bounds,
        center: e.center,
        texts,
        ...(e.hint ? { hint: e.hint } : {}),
        attrs: {
          ...(e.clickable ? { clickable: true } : {}),
          ...(e.scrollable ? { scrollable: true } : {}),
          ...(e.enabled !== undefined ? { enabled: e.enabled } : {}),
          ...(e.type ? { type: e.type } : {}),
        },
      };
    });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/unit/screen-model/associate.test.ts`
Expected: PASS(3 tests)。

- [ ] **Step 5: Commit**

```bash
git add src/screen-model/associate.ts test/unit/screen-model/associate.test.ts
git commit -m "feat(screen-model): associateText 把可点击控件关联子树/重叠 text"
```

---

## Task 5: buildScreenModel(DumpProvider + @eN#sN 分配)

**Files:**
- Create: `src/screen-model/dump-provider.ts`
- Modify: `src/screen-model/index.ts`

- [ ] **Step 1: 实现 buildScreenModel**

Create `src/screen-model/dump-provider.ts`:
```ts
import { flattenLayout } from '../layout';
import { associateText } from './associate';
import type { ScreenModel, Element } from './types';

let generation = 0;

/** 从 dumpLayout JSON 构建 ScreenModel:flatten → associateText → 分配 @eN#sN。 */
export function buildScreenModel(layoutJson: string): ScreenModel {
  const gen = ++generation;
  const elements = associateText(flattenLayout(layoutJson)).map((e, i): Element => ({
    ...e,
    ref: `@e${i}#s${gen}`,
  }));
  return { generation: gen, ts: Date.now(), elements };
}

/** 解析 ref 字符串为 { idx, gen }(用于 act 校验)。 */
export function parseRef(ref: string): { idx: number; gen: number } | undefined {
  const m = ref.match(/^@e(\d+)#s(\d+)$/);
  return m ? { idx: +m[1], gen: +m[2] } : undefined;
}

/** 仅用于测试:重置代际计数器。 */
export function _resetGenerationForTest(): void { generation = 0; }
```

- [ ] **Step 2: index.ts 补导出**

Update `src/screen-model/index.ts`:
```ts
export type { Element, ScreenModel, Locator, ElementRole, TextMode } from './types';
export { associateText } from './associate';
export { buildScreenModel, parseRef } from './dump-provider';
export { resolveLocator } from './locator';
export { renderModel } from './render';
```

- [ ] **Step 3: 类型检查 + 现有测试不破**

Run: `npx tsc --noEmit && npx vitest run --dir test/unit`
Expected: 0 errors + all PASS(locator/render 尚未创建,先在 index.ts 注释掉未建导出)。

- [ ] **Step 4: Commit**

```bash
git add src/screen-model/dump-provider.ts src/screen-model/index.ts
git commit -m "feat(screen-model): buildScreenModel 分配 @eN#sN 代际引用"
```

---

## Task 6: renderModel(给 agent 的紧凑文本)

**Files:**
- Create: `src/screen-model/render.ts`
- Test: `test/unit/screen-model/render.test.ts`

- [ ] **Step 1: 写失败测试**

Create `test/unit/screen-model/render.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { renderModel } from '../../../src/screen-model/render';
import type { ScreenModel, Element } from '../../../src/screen-model/types';

const mk = (over: Partial<Element>): Element => ({
  ref: '@e0#s1', bounds: [0,0,100,50], center: {x:50,y:25}, texts: [], attrs: {}, ...over,
});
const model = (els: Element[]): ScreenModel => ({ generation: 1, ts: 0, elements: els });

describe('renderModel', () => {
  it('渲染 @eN [type] text', () => {
    const out = renderModel(model([mk({ ref: '@e1#s1', attrs: { type: 'Row', clickable: true }, texts: ['WLAN', '已连接'] })]));
    expect(out).toContain('@e1 [Row] WLAN');
    expect(out).toContain('已连接');
  });
  it('scrollable 容器浅缩进子元素', () => {
    const out = renderModel(model([
      mk({ ref: '@e1#s1', attrs: { type: 'List', scrollable: true }, texts: [] }),
      mk({ ref: '@e2#s1', attrs: { type: 'Row', clickable: true }, texts: ['蓝牙'], bounds: [0,0,100,20] }),
    ]));
    // 容器在前,其内被包含元素缩进(几何包含判定)
    expect(out).toMatch(/@e1.*\n\s+@e2/);
  });
  it('省略 bounds', () => {
    const out = renderModel(model([mk({ ref: '@e1#s1', bounds: [10,20,30,40], texts: ['x'] })]));
    expect(out).not.toContain('10,20');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/unit/screen-model/render.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 renderModel**

Create `src/screen-model/render.ts`:
```ts
import type { ScreenModel, Element } from './types';

const contains = (outer: number[], inner: number[]) =>
  inner[0]! >= outer[0]! && inner[1]! >= outer[1]! && inner[2]! <= outer[2]! && inner[3]! <= outer[3]!;

/** 渲染给 agent 的紧凑文本:@eN [type] text → result;scrollable 容器浅缩进;省 bounds。 */
export function renderModel(model: ScreenModel): string {
  const lines: string[] = [`=== screen gen=${model.generation} (${model.elements.length} elements) ===`];
  const containers = model.elements.filter((e) => e.attrs.scrollable);
  const childOf: Record<number, number | undefined> = {};
  model.elements.forEach((e, i) => {
    const parent = containers.findIndex((c) => c !== e && contains(c.bounds, e.bounds));
    if (parent >= 0) childOf[i] = parent;
  });
  model.elements.forEach((e, i) => {
    const indent = childOf[i] !== undefined ? '  ' : '';
    const role = e.attrs.type ?? '?';
    const main = e.texts[0] ?? (e.hint ? `(${e.hint})` : '');
    const rest = e.texts.slice(1).join(' / ');
    const tail = rest ? ` → ${rest}` : '';
    lines.push(`${indent}${e.ref} [${role}] ${main}${tail}`);
  });
  return lines.join('\n');
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/unit/screen-model/render.test.ts`
Expected: PASS(3 tests)。

- [ ] **Step 5: Commit**

```bash
git add src/screen-model/render.ts test/unit/screen-model/render.test.ts
git commit -m "feat(screen-model): renderModel 紧凑渲染(@eN [type] text,浅分组,省 bounds)"
```

---

## Task 7: resolveLocator(按 Locator 找 Element)

**Files:**
- Create: `src/screen-model/locator.ts`
- Test: `test/unit/screen-model/locator.test.ts`

- [ ] **Step 1: 写失败测试**

Create `test/unit/screen-model/locator.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { resolveLocator } from '../../../src/screen-model/locator';
import type { ScreenModel, Element, Locator } from '../../../src/screen-model/types';

const mk = (over: Partial<Element>): Element => ({ ref: '@e0#s1', bounds: [0,0,100,50], center: {x:50,y:25}, texts: [], attrs: {}, ...over });
const model = (els: Element[]): ScreenModel => ({ generation: 1, ts: 0, elements: els });

describe('resolveLocator', () => {
  it('按 text contains 匹配(默认)', () => {
    const m = model([mk({ texts: ['WLAN'] }), mk({ texts: ['蓝牙'] })]);
    expect(resolveLocator(m, { text: 'WL' })?.texts[0]).toBe('WLAN');
  });
  it('text equals 精确匹配', () => {
    const m = model([mk({ texts: ['WLAN'] }), mk({ texts: ['WLAN已连接'] })]);
    expect(resolveLocator(m, { text: 'WLAN', textMode: 'equals' })?.texts[0]).toBe('WLAN');
  });
  it('多匹配时 index 取第 N 个', () => {
    const m = model([mk({ texts: ['商品'] }), mk({ texts: ['商品'] }), mk({ texts: ['商品'] })]);
    expect(resolveLocator(m, { text: '商品', index: 1 })?.ref).toBe(m.elements[1]!.ref);
  });
  it('未匹配返回 undefined(走坐标兜底)', () => {
    const m = model([mk({ texts: ['WLAN'] })]);
    expect(resolveLocator(m, { text: '不存在' })).toBeUndefined();
  });
  it('hint 匹配输入框空态', () => {
    const m = model([mk({ hint: '搜索设置项', attrs: { type: 'SearchField' } })]);
    expect(resolveLocator(m, { hint: '搜索' })?.hint).toBe('搜索设置项');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/unit/screen-model/locator.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 resolveLocator**

Create `src/screen-model/locator.ts`:
```ts
import type { ScreenModel, Element, Locator } from './types';

function matchText(target: string | undefined, query: string, mode: Locator['textMode']): boolean {
  if (!target) return false;
  if (mode === 'equals') return target === query;
  if (mode === 'regex') { try { return new RegExp(query).test(target); } catch { return false; } }
  return target.includes(query); // 默认 contains
}

/** 按 Locator 在当前 ScreenModel 解析元素(精确 bounds,每次现算)。未匹配返回 undefined。 */
export function resolveLocator(model: ScreenModel, loc: Locator): Element | undefined {
  let cands = model.elements.filter((e) => {
    if (loc.text && !matchText(e.texts[0], loc.text, loc.textMode) && !e.texts.some((t) => matchText(t, loc.text, loc.textMode))) return false;
    if (loc.hint && !(e.hint && e.hint.includes(loc.hint))) return false;
    if (loc.enabled !== undefined && e.attrs.enabled !== loc.enabled) return false;
    return true;
  });
  if (loc.within) {
    const parent = resolveLocator(model, loc.within);
    if (!parent) return undefined;
    const pb = parent.bounds;
    cands = cands.filter((e) => e !== parent && e.bounds[0]! >= pb[0]! && e.bounds[1]! >= pb[1]! && e.bounds[2]! <= pb[2]! && e.bounds[3]! <= pb[3]!);
  }
  if (cands.length === 0) return undefined;
  const idx = loc.index ?? 0;
  return cands[Math.min(idx, cands.length - 1)];
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/unit/screen-model/locator.test.ts`
Expected: PASS(5 tests)。

- [ ] **Step 5: Commit**

```bash
git add src/screen-model/locator.ts test/unit/screen-model/locator.test.ts
git commit -m "feat(screen-model): resolveLocator 按 text/hint/within/index/enabled 解析元素"
```

---

## Task 8: MCP dump_ui 双输出 + session 模型状态

**Files:**
- Modify: `src/mcp/session.ts`, `src/mcp/index.ts`

- [ ] **Step 1: session.ts 增 captureScreenModel + 状态**

In `src/mcp/session.ts`,加入(保留现有 captureScreenshot 等):
```ts
import { buildScreenModel, renderModel } from '../screen-model';
import type { ScreenModel } from '../screen-model';

let currentModel: ScreenModel | null = null;

/** dump 当前屏幕,构建并缓存 ScreenModel(更新代际)。返回紧凑渲染文本。 */
export async function captureScreenModel(): Promise<{ model: ScreenModel; render: string }> {
  const device = requireSession().device;
  const json = await dumpLayoutRaw(device);
  const model = buildScreenModel(json);
  currentModel = model;
  return { model, render: renderModel(model) };
}

export function getCurrentModel(): ScreenModel | null { return currentModel; }
export function requireModel(): ScreenModel {
  if (!currentModel) throw new Error('No screen model. Call dump_ui first to capture one.');
  return currentModel;
}
```
在 `disconnectSession` 内加 `currentModel = null;` 重置。

- [ ] **Step 2: index.ts 升级 dump_ui 工具(双输出)**

In `src/mcp/index.ts`,替换现有 `dump_ui` 工具的 handler:
```ts
server.registerTool(
  'dump_ui',
  {
    description:
      '【感知·快照】dump 当前屏幕为统一模型,返回 @eN 引用的元素列表(可点击控件+text,省坐标)。' +
      '每行格式 @eN [type] text → 相关text。用 act("@eN","click") 操作引用,find 查找特定元素。' +
      'format=compact(默认,给agent看)/json(结构化,含 bounds)。@eN 跨 dump 失效,操作后需重新 dump_ui。',
    inputSchema: {
      format: z.enum(['compact', 'json']).default('compact').describe('输出格式'),
    },
    annotations: READ_ONLY,
  },
  async ({ format }) => {
    const { model, render } = await captureScreenModel();
    if (format === 'json') {
      return text(JSON.stringify({ generation: model.generation, count: model.elements.length, elements: model.elements }, null, 2));
    }
    return text(render);
  },
);
```

- [ ] **Step 3: 构建 + 类型检查**

Run: `npx tsc --noEmit && npm run build`
Expected: 0 errors,build 成功。

- [ ] **Step 4: Commit**

```bash
git add src/mcp/session.ts src/mcp/index.ts
git commit -m "feat(mcp): dump_ui 升级为屏幕模型双输出(compact/json)+ 缓存当前模型"
```

---

## Task 9: MCP act(ref) + find(locator) 工具

**Files:**
- Modify: `src/mcp/session.ts`, `src/mcp/index.ts`

- [ ] **Step 1: session.ts 增 actByRef + findByLocator**

In `src/mcp/session.ts`:
```ts
import { parseRef, resolveLocator } from '../screen-model';
import type { Locator } from '../screen-model';

/** 按 @eN#sN 引用操作。校验代际,过期拒绝;op 映射到 touchDown/Up。 */
export async function actByRef(ref: string, op: 'click' | 'longClick' | 'doubleClick', durationMs = 800): Promise<string> {
  const model = requireModel();
  const parsed = parseRef(ref);
  if (!parsed || parsed.gen !== model.generation) {
    throw new Error(`ref ${ref} 已过期(当前代际 s${model.generation})。请重新调用 dump_ui 获取新 @eN。`);
  }
  const el = model.elements[parsed.idx];
  if (!el) throw new Error(`ref ${ref} 无对应元素。请重新 dump_ui。`);
  const { uitest } = requireSession();
  const { x, y } = el.center;
  if (op === 'click' || op === 'doubleClick') {
    await uitest.touchDown(x, y);
    await uitest.touchUp(x, y);
    if (op === 'doubleClick') { await uitest.touchDown(x, y); await uitest.touchUp(x, y); }
  } else { // longClick
    await uitest.touchDown(x, y);
    await sleep(durationMs);
    await uitest.touchUp(x, y);
  }
  return `已对 ${ref}(${el.texts[0] ?? el.attrs.type}) 执行 ${op} @(${x},${y})`;
}

/** 按 Locator 查找元素,返回其 ref(供 act 使用)。 */
export function findByLocator(loc: Locator): string {
  const model = requireModel();
  const el = resolveLocator(model, loc);
  if (!el) throw new Error(`未找到匹配 Locator 的元素:${JSON.stringify(loc)}。可换坐标 tap 兜底。`);
  return el.ref;
}
```

- [ ] **Step 2: index.ts 新增 act / find 工具**

In `src/mcp/index.ts`,加入(actionSchema 已存在,act/find 用独立 schema):
```ts
const locatorSchema = z.object({
  text: z.string().optional(),
  textMode: z.enum(['equals', 'contains', 'regex']).optional(),
  hint: z.string().optional(),
  index: z.number().int().optional(),
  enabled: z.boolean().optional(),
});

server.registerTool(
  'act',
  {
    description:
      '【操作·引用】用 dump_ui 返回的 @eN 引用操作元素(免坐标)。op:click/longClick/doubleClick。' +
      'ref 必须来自最近一次 dump_ui(跨 dump 失效,过期会报错提示重 dump)。',
    inputSchema: {
      ref: z.string().describe('dump_ui 返回的 @eN#sN 引用'),
      op: z.enum(['click', 'longClick', 'doubleClick']).describe('操作类型'),
      duration_ms: z.number().int().min(50).max(10000).default(800).describe('longClick 时长(毫秒)'),
    },
    annotations: DESTRUCTIVE,
  },
  async ({ ref, op, duration_ms }) => text(await actByRef(ref, op, duration_ms)),
);

server.registerTool(
  'find',
  {
    description:
      '【查找】按 Locator(text/hint/index/enabled)在当前屏幕模型查找元素,返回其 @eN 引用(供 act 使用)。' +
      '用于 dump_ui 渲染被截断/视口外的元素。需先 dump_ui 建立模型。',
    inputSchema: { locator: locatorSchema },
    annotations: READ_ONLY,
  },
  async ({ locator }) => text(`找到:${findByLocator(locator)}`),
);
```

- [ ] **Step 3: 构建 + 类型检查 + 全量单测**

Run: `npx tsc --noEmit && npm run build && npx vitest run --dir test/unit`
Expected: 0 errors,build 成功,所有单测 PASS。

- [ ] **Step 4: Commit**

```bash
git add src/mcp/session.ts src/mcp/index.ts
git commit -m "feat(mcp): 新增 act(@eN 引用操作)+ find(Locator 查找)工具"
```

---

## Task 10: 导出 + README 更新

**Files:**
- Modify: `src/index.ts`, `README.md`

- [ ] **Step 1: src/index.ts 导出 screen-model 公共 API**

In `src/index.ts`,加:
```ts
export type { Element, ScreenModel, Locator } from './screen-model';
export { buildScreenModel, renderModel, resolveLocator, associateText } from './screen-model';
```

- [ ] **Step 2: README 加屏幕模型 + act/find 工具说明**

In `README.md`,在 MCP 工具表追加 `dump_ui`(模型双输出)/`act(ref)`/`find(locator)`,加一段 "@eN 工作流:dump_ui → act(@eN) → 重 dump_ui"。

- [ ] **Step 3: 最终验证**

Run: `npm run build && npm run lint && npx vitest run --dir test/unit`
Expected: 全绿。

- [ ] **Step 4: Commit**

```bash
git add src/index.ts README.md
git commit -m "docs: 导出 screen-model API + README 补 @eN 工作流"
```

---

## 下一阶段(第二计划,本计划之后)

- **应用层录制 wrapper**(spec §10 step 4):Recorder 加 wrapper/proxy 拦截 UitestServer(touchDown/Up/Move/inputText)+ MCP 工具层 pressKey hook;手势聚合(down/up→click/longClick/swipe/drag);每手势 down 前 dump 一次;记 AnchoredAction{locator, fallbackCoord}。
- **锚点回放**(spec §10 step 5):replayAnchored = dump→resolveLocator→注入 + 等待轮询 + 坐标兜底 + 连续失配中止。
- **真机 spike 补充**(spec §10 step 6):淘宝首页"非空 btn 占比"(associateText 关联后)、动态列表滚动后 text/index 漂移率、type→role 映射。

---

## Self-Review

**1. Spec 覆盖**:spec v4 §3 模型 → Task 3-7;§4 MCP 工具 → Task 8-9;§10 step 0(flattenLayout 扩展下沉)→ Task 1-2;step 1(screen-model)→ Task 3-7;step 3(MCP)→ Task 8-9。step 4-5(录制/回放)显式列为下一阶段计划,step 6(spike)同样。✓ 无遗漏(本计划范围 = step 0-3)。

**2. Placeholder 扫描**:无 TBD/TODO;每步含完整代码或精确命令。Task 5 Step 3 注明 locator/render 未建时 index.ts 先注释 —— 这是执行注意,非占位。✓

**3. 类型一致性**:`Element.ref`(@eN#sN)、`buildScreenModel`/`parseRef`/`resolveLocator`/`renderModel`/`associateText`/`actByRef`/`findByLocator`/`captureScreenModel` 跨任务命名一致;`Locator` 字段(text/textMode/hint/within/index/enabled)跨 Task 3/7/9 一致;`UiElement`(layout)与 `Element`(screen-model)分离清晰。✓

(执行中如发现 Task 5 index.ts 引用未建模块,按其 Step 3 注释临时处理。)
