# SLAM 阶段③:探索器(ActExecutor + Explorer + DaemonWatchdog + SafetyFilter)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task. Steps use checkbox (`- [ ]`).

**Goal:** 实现 SLAM 第二阶段阶段③ —— ActExecutor(横切执行原语:dump→stripPopup→指纹→resolveLocator→tap→核验)、SafetyFilter(白名单 FAIL-SAFE 纯函数)、opType 判定(纯)、frontier 优先级抽样(纯)、Explorer(frontier loop + BACK 核验回溯 + 增量落盘/resume + 回 root 重规划)、DaemonWatchdog(act 卡死自动恢复),并真机端到端扫只读 app 建图。

**Architecture:** 新增 `src/explore/` 模块。执行组件通过 **`DevicePrimitives` 接口依赖注入**访问设备(dump/tap/back/launch/shell/recover);生产实现 `createMcpDevice()` 包装 `src/mcp/session.ts`,测试用 Fake 回放录制的 ScreenModel 序列(不依赖真机)。SafetyFilter/opType/frontier 是纯函数;ActExecutor/Explorer/DaemonWatchdog 注入 DevicePrimitives 即可单测。不改 MVP、不改 page-graph 公共 API。

**关键控制流设计(对 spec §4.2 的落地修正):** spec 的 `actByLocator` 若让 Explorer 循环与 ActExecutor 各 senseStable 一次 before,会产生冗余 dump(~2s/步)且测试序列无法精确编排(首循环即"漂移")。本 plan 把它拆为 `ActExecutor.perform(cur, loc, fallback)`:**before 由 Explorer 作为 `cur` 传入**(消除冗余 sense),ActExecutor 只做 resolveLocator→tap→senseStable(after)。Explorer 维护单一 `cur: SenseResult` 流:初始 senseStable → 循环(frontier(cur) → perform(cur) → cur=after)。**toggle/noop/modal 落地不新建节点**,记自环边(`to=current`,spec §3/§4.4 "toggle/noop 自环不裂变节点")。

**Tech Stack:** TypeScript (CJS/ES2020/strict)、vitest。复用 `src/page-graph`、`src/screen-model`、`src/mcp/session`。

**关联 spec:** `docs/hos-scrcpy/docs/superpowers/specs/2026-08-08-slam-autoexplore-design.md` §4.2(ActExecutor)、§4.3(SafetyFilter)、§4.4(Explorer)、§4.7(DaemonWatchdog)、§9 阶段③。

---

## 关键对接点(已核实真实接口,勿改)

**MVP `src/mcp/session.ts`:**
- `captureScreenModel(): Promise<{ model: ScreenModel; render: string }>` — dump + `buildScreenModel`,缓存模块级 `currentModel`,**更新代际**。
- `actByRef(ref, op, durationMs?): Promise<string>`(代隐式校验);`requireSession(): { device; uitest; sn }`;`sleep(ms)`;`connectSession(sn)`;`disconnectSession()`。

**低层(经 requireSession() 取):**
- `device.shell(cmd, timeoutSec?): Promise<string>`;`device.getScreenSize(): Promise<{width;height}>`;`device.getSn(): string`。
- `uitest.pressKey(4)`(BACK,返回 boolean);`uitest.touchDown(x,y)`/`uitest.touchUp(x,y)`。

**page-graph(阶段①② 已交付,纯函数):**
- `computeFingerprint(input, opts?): PageFingerprint`;`normalizeSkeleton(input, wl?): NormalizedSkeleton`。
- `detectPopup(input): PopupInfo|null`;`stripPopup(input): FingerprintInput`;`matchAnchors(a,b): number`。
- `MapStore`(save/appendNode/load/list)、`resolveLocator(model, loc): Element|undefined`。
- 类型:`PageNode/Edge/PageGraph/OpType/FingerprintInput/PageFingerprint/NormalizedSkeleton`。

**screen-model:** `ScreenModel{generation,ts,elements:Element[]}`;`Element{ref,bounds,center,texts,hint?,attrs:{clickable?,scrollable?,enabled?,type?}}`;`Locator{text?,textMode?,hint?,within?,index?,enabled?}`。

---

## File Structure

新增模块 `src/explore/`(代码根 = `docs/hos-scrcpy/`):

| 文件 | 职责 |
|---|---|
| `types.ts` | `DevicePrimitives`(注入接口)、`SenseResult`、`LocatorUnresolved`、`ExplorerConfig`、`ExploreReport`、`CoverageReport` |
| `safety-filter.ts` | `classifySafety(el): SafetyVerdict`(纯;白名单为主 + 黑名单 + 默认拒) |
| `op-type.ts` | `classifyOpType(args): OpType`(纯;spec §4.4.2 表) |
| `frontier.ts` | `locatorSignature(loc)`、`extractFrontier(model, opts): FrontierResult`(纯;优先级 + 抽样) |
| `act-executor.ts` | `ActExecutor`(sense/senseStable/perform,注入 DevicePrimitives) |
| `daemon-watchdog.ts` | `DaemonWatchdog implements DevicePrimitives`(socket 探活 + 超时恢复装饰器) |
| `explorer.ts` | `Explorer`(cur 流 frontier loop + 回溯核验 + 回 root + 增量落盘 + 终止 + 覆盖率) |
| `mcp-device.ts` | `createMcpDevice(): Promise<DevicePrimitives>`(生产实现,包装 session.ts) |
| `index.ts` | 桶导出 |

测试 `test/unit/explore/`:`safety-filter.test.ts`、`op-type.test.ts`、`frontier.test.ts`、`act-executor.test.ts`、`daemon-watchdog.test.ts`、`explorer.test.ts`、`fakes.ts`(`FakeDevice` 回放 ScreenModel 序列 + 记录调用)。

---

## Task 1: types + DevicePrimitives 接口 + LocatorUnresolved

**Files:** Create `src/explore/types.ts`

- [ ] **Step 1: 写 `src/explore/types.ts`**

```typescript
import type { ScreenModel, Locator } from '../screen-model';
import type {
  PageGraph, PageNode, Edge, OpType,
  PageFingerprint, NormalizedSkeleton,
} from '../page-graph';
import type { PopupInfo } from '../page-graph';

/** 设备原语接口(依赖注入)。生产由 mcp-device 实现,测试由 Fake 实现。 */
export interface DevicePrimitives {
  screenSize: { w: number; h: number };
  /** dump 当前屏 → ScreenModel(实现须更新 MVP 代际,保证后续 tapRef 代际校验通过)。 */
  dump(): Promise<ScreenModel>;
  /** 按 ref 触摸(代际校验由实现保证,MVP actByRef)。 */
  tapRef(ref: string): Promise<void>;
  /** 坐标兜底触摸(fallbackCoord)。 */
  tapCoord(x: number, y: number): Promise<void>;
  pressBack(): Promise<void>;
  launchApp(bundle: string, ability?: string): Promise<void>;
  shell(cmd: string, timeoutSec?: number): Promise<string>;
  /** daemon 卡死/丢失时的恢复(kill + reconnect)。 */
  recover(): Promise<void>;
}

/** 一次感知(dump + 剥离弹窗 + 指纹)。skeleton 供 PageNode.skeletonArchive。 */
export interface SenseResult {
  model: ScreenModel;
  fingerprint: PageFingerprint;
  skeleton: NormalizedSkeleton;
  popup: PopupInfo | null;
}

/** Locator 解析失败且无 fallbackCoord 时抛出。 */
export class LocatorUnresolved extends Error {
  constructor(public locator: Locator) {
    super(`Locator 未解析且无坐标兜底:${JSON.stringify(locator)}`);
    this.name = 'LocatorUnresolved';
  }
}

export interface ExplorerConfig {
  appBundle: string;
  appVersion: string;
  appAbility?: string;            // 回 root 冷启动 ability,默认 EntryAbility
  maxSteps: number;               // 总步数预算
  maxNoNewPage: number;           // 连续无新页 → 终止
  maxBacktrackFail: number;       // 回 root 重规划失败预算
  sampleLimit: number;            // 单节点 frontier 抽样上限 M(spec §4.4.1)
  toggleAnchorThreshold?: number; // toggle/navigate 锚点阈值,默认 0.6
}

export interface CoverageReport {
  visited: number;
  dangerousSkipped: number;
  sampledOut: number;
  failed: number;
  total: number;
  rate: number;                   // visited / (total - dangerous - sampled)
}

export type TerminationReason = 'no-new-page' | 'step-budget' | 'backtrack-failed' | 'manual';

export interface ExploreReport {
  graph: PageGraph;
  steps: number;
  newPages: number;
  terminated: TerminationReason;
  coverage: CoverageReport;
}

export type { PageGraph, PageNode, Edge, OpType };
```

- [ ] **Step 2: 类型检查 + 提交**

```bash
npx tsc --noEmit
git add src/explore/types.ts
git commit -m "feat(explore): DevicePrimitives 接口 + SenseResult/LocatorUnresolved/配置类型"
```

---

## Task 2: SafetyFilter(白名单 FAIL-SAFE,纯函数)

**Files:** Create `src/explore/safety-filter.ts`、`test/unit/explore/safety-filter.test.ts`

**设计(spec §4.3):** 默认不动,显式证明安全才放行。① 黑名单(危险 text/正则)命中即拦;② 白名单 type 导航类 / text 探索目标类放行;③ 其余默认拒。**控制类词(返回/关闭/取消/我知道了)刻意不在白名单** —— 它们不是探索目标:BACK 由 Explorer 按键处理,关弹窗由阶段④ DecisionEngine 处理,故 frontier 不会选回溯/关弹窗按钮。阈值/词表初值来自 spec,待真机 spike 回填。

- [ ] **Step 1: 失败测试**

```typescript
import { describe, it, expect } from 'vitest';
import { classifySafety } from '../../../src/explore/safety-filter';
import type { Element } from '../../../src/screen-model';

function el(text: string, type = 'Button'): Element {
  return { ref: '@e0#s1', bounds: [0,0,100,100], center: {x:50,y:50}, texts: text ? [text] : [], attrs: { clickable: true, type } };
}

describe('classifySafety', () => {
  it('黑名单危险词 → 拦(即便看起来像导航)', () => {
    expect(classifySafety(el('恢复出厂设置', 'Button')).allow).toBe(false);
    expect(classifySafety(el('退出登录', 'Button')).allow).toBe(false);
    expect(classifySafety(el('立即支付', 'Button')).allow).toBe(false);
    expect(classifySafety(el('删除', 'Image')).allow).toBe(false);
  });
  it('白名单:type 导航类(Tab/Navigation/Menu)放行 —— 覆盖纯图标', () => {
    const v = classifySafety(el('', 'Tab'));
    expect(v.allow).toBe(true);
    expect(v.reason).toBe('whitelist-navigate');
  });
  it('白名单:text 探索目标类放行', () => {
    expect(classifySafety(el('设置')).allow).toBe(true);
    expect(classifySafety(el('关于手机')).allow).toBe(true);
    expect(classifySafety(el('更多')).allow).toBe(true);
  });
  it('控制类词(返回/关闭/取消)不在白名单 → 默认拒(回溯由 Explorer BACK 处理)', () => {
    expect(classifySafety(el('返回')).allow).toBe(false);
    expect(classifySafety(el('关闭')).allow).toBe(false);
    expect(classifySafety(el('取消')).allow).toBe(false);
  });
  it('白名单外默认拒(FAIL-SAFE)', () => {
    const v = classifySafety(el('', 'Image'));
    expect(v.allow).toBe(false);
    expect(v.reason).toBe('default-deny');
  });
});
```

- [ ] **Step 2: 验证失败** → `npx vitest run test/unit/explore/safety-filter.test.ts` → FAIL(模块不存在)

- [ ] **Step 3: 实现 `src/explore/safety-filter.ts`**

```typescript
import type { Element } from '../screen-model';

export type SafetyReason = 'whitelist-navigate' | 'whitelist-view' | 'blacklist' | 'default-deny';

export interface SafetyVerdict {
  allow: boolean;
  reason: SafetyReason;
}

// 危险词(提交语义/不可逆)。词表待 spike 回填。
const BLACKLIST = /(支付|付款|删除|清除|清空|退出|注销|登出|拨号|呼叫|发送|发布|提交|确认|开通|绑定|授权|重置|恢复出厂|续费|转账|upgrade|delete|pay|submit|confirm|send|publish|reset|unbind)/i;

// type 导航类(覆盖纯图标页:Tab/导航/菜单)。
const WHITELIST_NAV_TYPE = /(^tab$|navigation|navigator|.*menu.*|bottombar|tabbar|^tabs?$)/i;

// text 探索目标类(只读场景常见入口)。控制类(返回/关闭/取消/我知道了)刻意排除。
const WHITELIST_VIEW_TEXT = /(首页|主页|我的|设置|更多|管理|详情|查看|展开|收起|全部|搜索|筛选|分类|上一页|下一页|关于|声音|显示|电池|存储|应用|通知)/;

/** 白名单为主 + 黑名单 + 默认拒(FAIL-SAFE)。纯函数。 */
export function classifySafety(el: Element): SafetyVerdict {
  const text = el.texts.join(' ');
  const type = el.attrs.type ?? '';
  if (BLACKLIST.test(text)) return { allow: false, reason: 'blacklist' };
  if (WHITELIST_NAV_TYPE.test(type)) return { allow: true, reason: 'whitelist-navigate' };
  if (WHITELIST_VIEW_TEXT.test(text)) return { allow: true, reason: 'whitelist-view' };
  return { allow: false, reason: 'default-deny' };
}
```

- [ ] **Step 4: 验证通过 + 提交**

```bash
npx vitest run test/unit/explore/safety-filter.test.ts   # PASS
git add src/explore/safety-filter.ts test/unit/explore/safety-filter.test.ts
git commit -m "feat(explore): SafetyFilter 白名单 FAIL-SAFE(黑名单+白名单type/text+默认拒)"
```

---

## Task 3: ActExecutor(sense/senseStable/perform)

**Files:** Create `src/explore/act-executor.ts`、`test/unit/explore/fakes.ts`、`test/unit/explore/act-executor.test.ts`

**设计(spec §4.2):** Explorer 与 Navigator 共用的执行原语。`sense()` = dump + stripPopup + computeFingerprint(底层页);`senseStable()` 连续两次指纹一致(防加载过渡态);`perform(cur, loc, fallbackCoord?)` 基于**已知 before(`cur`)** resolveLocator → tapRef/fallbackCoord → senseStable(after),返回 after SenseResult + popup(供 Explorer 判 opType + 推进 cur)。before 由调用方传入,消除冗余 sense。

- [ ] **Step 1: 写 `test/unit/explore/fakes.ts`(FakeDevice,act-executor/explorer 复用)**

```typescript
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
```

- [ ] **Step 2: 失败测试 `test/unit/explore/act-executor.test.ts`**

```typescript
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
      { ref: '@e9#s1', bounds: [0,0,1080,2340], center:{x:540,y:1170}, texts:[], attrs:{clickable:true, type:'Stack'} },     // 遮罩
      { ref: '@e8#s1', bounds: [100,800,980,1500], center:{x:540,y:1150}, texts:['广告'], attrs:{type:'Dialog'} },            // 弹窗
    ]);
    const dev = new FakeDevice([withPopup]);
    const act = new ActExecutor(dev);
    const s = await act.sense();
    expect(s.popup).not.toBeNull();
    expect(s.fingerprint.skeletonHash).toBe(computeFingerprint({ elements: base.elements, screenSize: dev.screenSize }).skeletonHash);
  });

  it('senseStable:连续两次指纹一致才返回(防过渡态)', async () => {
    const a = model([el('设置', 'Text')]);
    const b = model([el('设置', 'Text'), el('加载中', 'Text')]);  // 过渡态
    const dev = new FakeDevice([b, a, a]);                       // b→a→a 稳定
    const act = new ActExecutor(dev, { stallMs: 0 });
    const s = await act.senseStable(3);
    expect(s.fingerprint.skeletonHash).toBe(computeFingerprint({ elements: a.elements, screenSize: dev.screenSize }).skeletonHash);
  });

  it('perform:resolveLocator 命中 → tapRef;返回 after SenseResult', async () => {
    const p1 = model([el('关于手机', 'Button', { bounds: [0, 100, 540, 200] })]);
    const p2 = model([el('设备名称', 'Text', { bounds: [0, 0, 1080, 80] })]);
    const dev = new FakeDevice([p1, p1, p2, p2]);
    const act = new ActExecutor(dev, { stallMs: 0 });
    const cur = await act.senseStable();           // before = p1(dump0,1)
    const r = await act.perform(cur, { text: '关于手机' });   // act + after=p2(dump2,3)
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
```

- [ ] **Step 3: 验证失败** → FAIL(模块不存在)

- [ ] **Step 4: 实现 `src/explore/act-executor.ts`**

```typescript
import type { Locator } from '../screen-model';
import { resolveLocator } from '../screen-model';
import { computeFingerprint, normalizeSkeleton, detectPopup, stripPopup } from '../page-graph';
import type { DevicePrimitives, SenseResult } from './types';
import { LocatorUnresolved } from './types';
import { sleep } from '../mcp/session';

export interface ActExecutorOptions {
  stallMs?: number;          // 稳定检测两次 dump 间隔,默认 150
  maxStallTries?: number;    // senseStable 最大尝试,默认 3
}

export interface PerformResult {
  after: SenseResult;        // 落地页感知(含 model 供 Explorer 提 frontier)
  popup: import('../page-graph').PopupInfo | null;
  usedFallback: boolean;
}

/** 横切执行原语(spec §4.2):dump→stripPopup→指纹→resolveLocator→tap→核验。 */
export class ActExecutor {
  constructor(private dev: DevicePrimitives, private opts: ActExecutorOptions = {}) {}

  /** dump + 弹窗剥离 + 底层页指纹 + 规范化骨架(archive)。 */
  async sense(): Promise<SenseResult> {
    const m = await this.dev.dump();
    const input = { elements: m.elements, screenSize: this.dev.screenSize };
    const popup = detectPopup(input);
    const stripped = stripPopup(input);
    return { model: m, fingerprint: computeFingerprint(stripped), skeleton: normalizeSkeleton(stripped), popup };
  }

  /** 稳定检测:连续两次指纹一致(或耗尽 maxTries),防加载过渡态(spec §4.2)。 */
  async senseStable(maxTries?: number): Promise<SenseResult> {
    const tries = maxTries ?? this.opts.maxStallTries ?? 3;
    const stall = this.opts.stallMs ?? 150;
    let prev = await this.sense();
    for (let i = 1; i < tries; i++) {
      if (stall > 0) await sleep(stall);
      const cur = await this.sense();
      if (cur.fingerprint.skeletonHash === prev.fingerprint.skeletonHash) return cur;
      prev = cur;
    }
    return prev;
  }

  /** 基于已知 before(cur)解析+act+感知 after。before 由调用方传入,消除冗余 sense。 */
  async perform(cur: SenseResult, loc: Locator, fallbackCoord?: { x: number; y: number }): Promise<PerformResult> {
    const target = resolveLocator(cur.model, loc);
    let usedFallback = false;
    if (target) {
      await this.dev.tapRef(target.ref);
    } else if (fallbackCoord) {
      await this.dev.tapCoord(fallbackCoord.x, fallbackCoord.y);
      usedFallback = true;
    } else {
      throw new LocatorUnresolved(loc);
    }
    const after = await this.senseStable();
    return { after, popup: after.popup, usedFallback };
  }
}
```

- [ ] **Step 5: 验证通过 + 提交**

```bash
npx vitest run test/unit/explore/act-executor.test.ts   # PASS
git add src/explore/act-executor.ts test/unit/explore/fakes.ts test/unit/explore/act-executor.test.ts
git commit -m "feat(explore): ActExecutor(sense/senseStable/perform,弹窗剥离+稳定检测,before由调用方传入)"
```

---

## Task 4: opType 判定(纯函数,spec §4.4.2 表)

**Files:** Create `src/explore/op-type.ts`、`test/unit/explore/op-type.test.ts`

- [ ] **Step 1: 失败测试**

```typescript
import { describe, it, expect } from 'vitest';
import { classifyOpType } from '../../../src/explore/op-type';
import type { PageFingerprint, PopupInfo } from '../../../src/page-graph';

function fp(hash: string, anchors: string[]): PageFingerprint { return { version: 'v1', skeletonHash: hash, anchors }; }
const popup: PopupInfo = { kind: 'dialog' };

describe('classifyOpType', () => {
  it('落点有遮罩 → modal', () => {
    expect(classifyOpType({ before: fp('a', ['x']), after: fp('b', ['y']), popup })).toBe('modal');
  });
  it('bundle 变 → external', () => {
    expect(classifyOpType({ before: fp('a', ['x']), after: fp('b', ['y']), popup: null, bundleChanged: true })).toBe('external');
  });
  it('指纹同 → noop', () => {
    expect(classifyOpType({ before: fp('h', ['x']), after: fp('h', ['x']), popup: null })).toBe('noop');
  });
  it('指纹变 + 锚点高重叠 → toggle', () => {
    expect(classifyOpType({ before: fp('h1', ['设置','关于','显示','声音','电池']), after: fp('h2', ['设置','关于','显示','声音','网络']), popup: null })).toBe('toggle');
  });
  it('指纹变 + 锚点低重叠 → navigate', () => {
    expect(classifyOpType({ before: fp('h1', ['设置','关于']), after: fp('h2', ['购物','支付']), popup: null })).toBe('navigate');
  });
});
```

- [ ] **Step 2: 验证失败** → FAIL

- [ ] **Step 3: 实现 `src/explore/op-type.ts`**

```typescript
import type { PageFingerprint, OpType, PopupInfo } from '../page-graph';
import { matchAnchors } from '../page-graph';

const TOGGLE_T = 0.6;   // 锚点重叠≥此 → toggle(页内变化);否则 navigate(跳页)。与 PARTIAL_T 一致,待 spike 回填。

/** opType 判定(spec §4.4.2):modal/external 优先,再 noop/toggle/navigate。纯函数。 */
export function classifyOpType(args: {
  before: PageFingerprint;
  after: PageFingerprint;
  popup: PopupInfo | null;
  bundleChanged?: boolean;
}): OpType {
  if (args.popup) return 'modal';
  if (args.bundleChanged) return 'external';
  if (args.before.skeletonHash === args.after.skeletonHash) return 'noop';
  return matchAnchors(args.before.anchors, args.after.anchors) >= TOGGLE_T ? 'toggle' : 'navigate';
}
```

- [ ] **Step 4: 验证通过 + 提交**

```bash
npx vitest run test/unit/explore/op-type.test.ts   # PASS
git add src/explore/op-type.ts test/unit/explore/op-type.test.ts
git commit -m "feat(explore): opType 判定(modal/external/noop/toggle/navigate)"
```

---

## Task 5: frontier 优先级抽样(纯函数,spec §4.4.1)

**Files:** Create `src/explore/frontier.ts`、`test/unit/explore/frontier.test.ts`

**设计:** 从 ScreenModel 提取可点候选 → SafetyFilter 过滤 → Locator signature 去重(已 explored 跳过)→ 优先级排序(type 导航 > navigate 关键词 > 其余)→ 抽样(超 sampleLimit 取前 N,记 sampledOut)。返回 `{selected, totalCandidates, dangerous, sampledOut}`。

- [ ] **Step 1: 失败测试**

```typescript
import { describe, it, expect } from 'vitest';
import { extractFrontier, locatorSignature } from '../../../src/explore/frontier';
import { classifySafety } from '../../../src/explore/safety-filter';
import type { ScreenModel, Element } from '../../../src/screen-model';

function el(text: string, type: string, bounds: number[]): Element {
  return { ref: `@e${text.length}%s1`, bounds, center: { x:(bounds[0]+bounds[2])/2, y:(bounds[1]+bounds[3])/2 }, texts: text?[text]:[], attrs: { clickable: true, type } };
}
function sm(els: Element[]): ScreenModel { return { generation: 1, ts: 1, elements: els }; }

describe('frontier', () => {
  it('locatorSignature 稳定去重', () => {
    expect(locatorSignature({ text: '设置' })).toBe(locatorSignature({ text: '设置' }));
    expect(locatorSignature({ text: '设置' })).not.toBe(locatorSignature({ text: '关于' }));
  });

  it('提取可点候选:白名单放行 / 黑名单危险跳过(记 dangerous)/ 默认拒不计入', () => {
    const m = sm([
      el('设置', 'Text', [0,0,1080,100]),
      el('恢复出厂', 'Button', [0,100,540,200]),
      el('关于手机', 'Button', [0,200,540,300]),
      el('', 'Image', [0,300,540,400]),
    ]);
    const r = extractFrontier(m, { exploredSignatures: new Set(), safety: classifySafety, sampleLimit: 10 });
    expect(r.selected.length).toBe(2);
    expect(r.dangerous).toBe(1);
    expect(r.totalCandidates).toBe(2);
  });

  it('已 explored 的 signature 跳过', () => {
    const m = sm([el('设置', 'Text', [0,0,1080,100]), el('关于手机', 'Button', [0,200,540,300])]);
    const r = extractFrontier(m, { exploredSignatures: new Set([locatorSignature({ text: '设置' })]), safety: classifySafety, sampleLimit: 10 });
    expect(r.selected.map((c) => c.locator.text)).toEqual(['关于手机']);
  });

  it('优先级:navigate 关键词(type Tab)排在前面', () => {
    const m = sm([
      el('关于手机', 'Button', [0,200,540,300]),
      el('显示', 'Tab', [0,2200,540,2340]),
    ]);
    const r = extractFrontier(m, { exploredSignatures: new Set(), safety: classifySafety, sampleLimit: 10 });
    expect(r.selected[0]!.locator.text).toBe('显示');
  });

  it('抽样:超 sampleLimit 取前 N,记 sampledOut', () => {
    const m = sm(Array.from({ length: 5 }, (_, i) => el(`设置${i}`, 'Text', [0, i*100, 540, i*100+100])));
    const r = extractFrontier(m, { exploredSignatures: new Set(), safety: classifySafety, sampleLimit: 2 });
    expect(r.selected.length).toBe(2);
    expect(r.sampledOut).toBe(3);
  });

  it('候选带 fallbackCoord(=元素 center)', () => {
    const m = sm([el('设置', 'Text', [0,0,1080,100])]);
    const r = extractFrontier(m, { exploredSignatures: new Set(), safety: classifySafety, sampleLimit: 10 });
    expect(r.selected[0]!.fallbackCoord).toEqual({ x: 540, y: 50 });
  });
});
```

- [ ] **Step 2: 验证失败** → FAIL

- [ ] **Step 3: 实现 `src/explore/frontier.ts`**

```typescript
import type { ScreenModel, Element, Locator } from '../screen-model';
import { classifySafety, type SafetyVerdict } from './safety-filter';

export interface FrontierCandidate {
  locator: Locator;
  fallbackCoord: { x: number; y: number };
  priority: number;
}

export interface FrontierResult {
  selected: FrontierCandidate[];
  totalCandidates: number;   // 通过白名单的候选数(抽样前)
  dangerous: number;         // 黑名单命中数
  sampledOut: number;        // 因抽样丢弃数
}

/** Locator 稳定 signature(去重 key)。扁平判定,忽略 within 递归。 */
export function locatorSignature(loc: Locator): string {
  return JSON.stringify({ t: loc.text, m: loc.textMode ?? 'contains', h: loc.hint, i: loc.index ?? 0, e: loc.enabled });
}

const NAV_PRIORITY_TEXT = /(设置|更多|管理|查看|详情|首页|主页|我的|分类|搜索|关于|显示|声音|应用|通知|存储|电池)/;
const CONTAINER_TYPE = /list|waterflow|grid|swiper|scroll/i;

/** frontier 提取 + 优先级 + 抽样(spec §4.4.1)。纯函数。 */
export function extractFrontier(
  m: ScreenModel,
  opts: { exploredSignatures: Set<string>; safety: (el: Element) => SafetyVerdict; sampleLimit: number },
): FrontierResult {
  const candidates: FrontierCandidate[] = [];
  let dangerous = 0;
  const containers = m.elements.filter((e) => CONTAINER_TYPE.test(e.attrs.type ?? '') || e.attrs.scrollable);
  const seenContainerChildren = new Set<Element>();

  for (const e of m.elements) {
    if (e.attrs.clickable === false) continue;
    if (e.attrs.enabled === false) continue;
    const v = opts.safety(e);
    if (v.reason === 'blacklist') { dangerous++; continue; }
    if (!v.allow) continue;   // default-deny 不计入候选
    const loc: Locator = e.texts[0] ? { text: e.texts[0] } : { hint: e.hint };
    if (opts.exploredSignatures.has(locatorSignature(loc))) continue;

    // 列表项去重:同容器内只取首项代表(spec §4.4.1 同 signature 列表项只抽 1)
    const parent = containers.find((c) => c !== e && isInside(e, c));
    if (parent) { if (seenContainerChildren.has(parent)) continue; seenContainerChildren.add(parent); }

    candidates.push({ locator: loc, fallbackCoord: { x: e.center.x, y: e.center.y }, priority: scorePriority(e, v) });
  }

  candidates.sort((a, b) => b.priority - a.priority);
  const limit = opts.sampleLimit;
  return {
    selected: candidates.slice(0, limit),
    totalCandidates: candidates.length,
    dangerous,
    sampledOut: Math.max(0, candidates.length - limit),
  };
}

function scorePriority(e: Element, v: SafetyVerdict): number {
  let p = 0;
  if (v.reason === 'whitelist-navigate') p += 100;
  if (NAV_PRIORITY_TEXT.test(e.texts.join(' '))) p += 50;
  return p;
}

function isInside(child: Element, parent: Element): boolean {
  const [cl, ct, cr, cb] = child.bounds;
  const [pl, pt, pr, pb] = parent.bounds;
  return cl >= pl && ct >= pt && cr <= pr && cb <= pb;
}
```

- [ ] **Step 4: 验证通过 + 提交**

```bash
npx vitest run test/unit/explore/frontier.test.ts   # PASS
git add src/explore/frontier.ts test/unit/explore/frontier.test.ts
git commit -m "feat(explore): frontier 提取+优先级排序+抽样(列表项去重)"
```

---

## Task 6: Explorer 协调器(cur 流 frontier loop + 回溯核验 + 回 root + 增量落盘 + 终止)

**Files:** Create `src/explore/explorer.ts`、`test/unit/explore/explorer.test.ts`

**设计(spec §4.4):** load 已有图 resume / 否则从 root。维护单一 `cur: SenseResult` 流:初始 `senseStable` → 循环 = 漂移核验(cur==栈顶?) → 提取 frontier(cur.model)(空则 noNewStreak++ + 回溯) → perform(cur) → 判 opType → navigate 压栈建节点 / toggle·noop·modal 记自环(不裂变) → `cur=after`。BACK 核验落点==父指纹,连续 2 次失败冷启动回 root。每 navigate 新节点 appendNode 增量落盘。终止 = 连续无新页/步数/回溯失败。

> **测试 dump 序列已逐例核对**(senseStable 在 stallMs=0 下连续两同 model 即稳定,耗 2 dump):implementer 勿改 FakeDevice 序列顺序。

- [ ] **Step 1: 失败测试 `test/unit/explore/explorer.test.ts`**

```typescript
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
    // senseStable(root)×2 → perform → after=about×2 → frontier 空 → BACK→root×2 → frontier 空 → restart→root×2
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
    // senseStable(p1)×2 → perform 更多 → after=p2×2(toggle 自环)→ 漂移→restart→p1×2 → frontier 空(更多已explore)→ no-new-page
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
    // root×2 → perform→about×2 → frontier 空 → BACK→stray×2 → BACK→stray×2 → restart→root×2
    const dev = new FakeDevice([root, root, about, about, stray, stray, stray, stray, root, root]);
    const exp = new Explorer(new ActExecutor(dev, { stallMs: 0 }), dev, cfg({ maxSteps: 30 }), new MapStore(dir));
    await exp.explore();
    expect(dev.calls.launch.length).toBeGreaterThanOrEqual(1);
  });

  it('终止:连续无新页达阈值 → terminated=no-new-page', async () => {
    // root×2 → perform→about×2 → frontier 空 → BACK→root×2 → frontier 空(关于手机已explore)→ no-new-page(maxNoNewPage=2)
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
```

- [ ] **Step 2: 验证失败** → FAIL(Explorer 不存在)

- [ ] **Step 3: 实现 `src/explore/explorer.ts`**

```typescript
import { MapStore, FINGERPRINT_VERSION } from '../page-graph';
import type { PageGraph, PageNode, Edge, OpType } from '../page-graph';
import { ActExecutor } from './act-executor';
import { classifySafety } from './safety-filter';
import { classifyOpType } from './op-type';
import { extractFrontier, locatorSignature, type FrontierCandidate } from './frontier';
import type { DevicePrimitives, ExplorerConfig, ExploreReport, CoverageReport, SenseResult } from './types';

function freshGraph(cfg: ExplorerConfig): PageGraph {
  return { appBundle: cfg.appBundle, appVersion: cfg.appVersion, fingerprintVersion: FINGERPRINT_VERSION, nodes: new Map(), edges: [], entryPoints: [] };
}

export class Explorer {
  private graph: PageGraph;
  private stack: string[] = [];
  private steps = 0;
  private newPages = 0;
  private noNewStreak = 0;
  private backFail = 0;
  private edgeSigs = new Set<string>();
  private cov: CoverageReport = { visited: 0, dangerousSkipped: 0, sampledOut: 0, failed: 0, total: 0 };

  constructor(
    private act: ActExecutor,
    private dev: DevicePrimitives,
    private cfg: ExplorerConfig,
    private store: MapStore,
  ) {
    this.graph = this.store.load(cfg.appBundle, cfg.appVersion) ?? freshGraph(cfg);
  }

  async explore(): Promise<ExploreReport> {
    let cur = await this.act.senseStable();          // 初始感知 = root
    const root = this.upsertNode(cur);
    this.graph.rootId = root.id;
    if (this.graph.entryPoints.length === 0) {
      this.graph.entryPoints = [{ id: root.id, label: 'root', origin: 'launcher' }];
    }
    this.stack = [root.id];
    this.store.save(this.graph);

    let term: ExploreReport['terminated'] = 'step-budget';
    while (this.steps < this.cfg.maxSteps) {
      if (this.noNewStreak >= this.cfg.maxNoNewPage) { term = 'no-new-page'; break; }
      if (this.backFail >= this.cfg.maxBacktrackFail) { term = 'backtrack-failed'; break; }

      const current = this.graph.nodes.get(this.stack[this.stack.length - 1]!)!;

      // 漂移核验:cur 与栈顶一致?
      if (cur.fingerprint.skeletonHash !== current.fingerprint.skeletonHash) {
        const relocated = this.graph.nodes.get(cur.fingerprint.skeletonHash);
        if (relocated) {
          this.stack[this.stack.length - 1] = relocated.id;
        } else {
          this.noNewStreak++;
          const next = await this.backtrackSense();
          if (!next) { term = 'backtrack-failed'; break; }
          cur = next;
          continue;
        }
      }

      const fr = extractFrontier(cur.model, {
        exploredSignatures: new Set(current.frontierExplored.map(locatorSignature)),
        safety: classifySafety,
        sampleLimit: this.cfg.sampleLimit,
      });
      this.cov.total += fr.totalCandidates + fr.dangerous;
      this.cov.dangerousSkipped += fr.dangerous;
      this.cov.sampledOut += fr.sampledOut;

      if (fr.selected.length === 0) {
        this.noNewStreak++;
        if (this.noNewStreak >= this.cfg.maxNoNewPage) { term = 'no-new-page'; break; }
        const next = await this.backtrackSense();
        if (!next) { term = 'backtrack-failed'; break; }
        cur = next;
        continue;
      }

      const cand = fr.selected[0]!;
      current.frontierExplored.push(cand.locator);
      this.cov.visited++;
      this.steps++;

      let result;
      try {
        result = await this.act.perform(cur, cand.locator, cand.fallbackCoord);
      } catch {
        this.cov.failed++;
        continue;   // cur 不变,下轮重提 frontier(该 locator 已记 explored)
      }

      const opType = classifyOpType({ before: cur.fingerprint, after: result.after.fingerprint, popup: result.popup });
      if (opType === 'navigate') {
        const landing = this.upsertNode(result.after);
        this.recordEdge(current, cand, landing, opType);
        if (landing.id !== current.id) {
          this.stack.push(landing.id);
          this.newPages++;
          this.noNewStreak = 0;
          this.store.appendNode(this.graph, landing);
        } else {
          this.noNewStreak++;
        }
      } else {
        // toggle/noop/modal → 自环(to=current),不裂变节点(spec §3/§4.4)
        this.recordEdge(current, cand, current, opType);
        this.noNewStreak++;
        this.store.save(this.graph);
      }
      cur = result.after;   // 推进 cur 到落地页
    }

    const denom = this.cov.total - this.cov.dangerousSkipped - this.cov.sampledOut;
    this.cov.rate = denom > 0 ? this.cov.visited / denom : 0;
    this.store.save(this.graph);
    return { graph: this.graph, steps: this.steps, newPages: this.newPages, terminated: term, coverage: this.cov };
  }

  private upsertNode(sense: SenseResult): PageNode {
    const existing = this.graph.nodes.get(sense.fingerprint.skeletonHash);
    if (existing) { existing.visitedAt = sense.model.ts; return existing; }
    const node: PageNode = {
      id: sense.fingerprint.skeletonHash,
      fingerprint: sense.fingerprint,
      skeletonArchive: sense.skeleton,
      frontierExplored: [],
      frontierPending: [],
      visitedAt: sense.model.ts,
    };
    this.graph.nodes.set(node.id, node);
    return node;
  }

  private recordEdge(from: PageNode, cand: FrontierCandidate, landing: PageNode, opType: OpType): void {
    const sig = `${from.id}|${locatorSignature(cand.locator)}`;
    if (this.edgeSigs.has(sig)) return;
    this.edgeSigs.add(sig);
    const edge: Edge = {
      from: from.id, locator: cand.locator, fallbackCoord: cand.fallbackCoord,
      to: landing.id, opType, backNavigable: 'unknown', effectReversible: false, verified: opType === 'navigate',
    };
    this.graph.edges.push(edge);
  }

  /** 回溯:BACK 核验落点==父;连续 2 次失败 → 冷启动回 root(spec §4.4.3)。返回新 cur 或 null。 */
  private async backtrackSense(): Promise<SenseResult | null> {
    if (this.stack.length <= 1) return this.restartFromRootSense();
    const parent = this.graph.nodes.get(this.stack[this.stack.length - 2]!)!;
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.dev.pressBack();
      const s = await this.act.senseStable();
      if (s.fingerprint.skeletonHash === parent.fingerprint.skeletonHash) {
        this.stack.pop();
        return s;
      }
    }
    return this.restartFromRootSense();
  }

  private async restartFromRootSense(): Promise<SenseResult | null> {
    const root = this.graph.nodes.get(this.graph.rootId!);
    if (!root) { this.backFail++; return null; }
    await this.dev.launchApp(this.cfg.appBundle, this.cfg.appAbility ?? 'EntryAbility');
    const s = await this.act.senseStable();
    if (s.fingerprint.skeletonHash === root.fingerprint.skeletonHash) {
      this.stack = [this.graph.rootId!];
      return s;
    }
    this.backFail++;
    this.store.save(this.graph);
    return null;
  }
}
```

- [ ] **Step 4: 验证通过 + 全量回归**

```bash
npx vitest run test/unit/explore/explorer.test.ts   # PASS
npm run test:unit                                   # 含阶段①② 全绿
git add src/explore/explorer.ts test/unit/explore/explorer.test.ts
git commit -m "feat(explore): Explorer cur 流 frontier loop+BACK 核验回溯+回 root+增量落盘+覆盖率"
```

---

## Task 7: DaemonWatchdog(socket 探活 + 超时恢复装饰器)

**Files:** Create `src/explore/daemon-watchdog.ts`、`test/unit/explore/daemon-watchdog.test.ts`

**设计(spec §4.7):** 实现 `DevicePrimitives`,包装内层设备。每次 act 前 `shell` 查 `/proc/net/unix` 的 `uitest_socket`;不存在 → `recover()`。操作超时(10–15s)→ recover → 重试一次。`shell` 本身不探活(避免递归)。`preFlight` 供 Explorer 启动前确认 daemon 独占。

- [ ] **Step 1: 失败测试**

```typescript
import { describe, it, expect } from 'vitest';
import { DaemonWatchdog } from '../../../src/explore/daemon-watchdog';
import { FakeDevice, model, el } from './fakes';

describe('DaemonWatchdog', () => {
  it('socket 存在 → 正常 dump,不 recover', async () => {
    const inner = new FakeDevice([model([el('A', 'Text')])]);
    inner.shell = async () => '1';
    const wd = new DaemonWatchdog(inner, { actTimeoutMs: 5000 });
    await wd.dump();
    expect(inner.calls.recover).toBe(0);
  });
  it('socket 不存在 → recover 后再 dump', async () => {
    const inner = new FakeDevice([model([el('A', 'Text')])]);
    inner.shell = async () => '0';
    const wd = new DaemonWatchdog(inner, { actTimeoutMs: 5000 });
    await wd.dump();
    expect(inner.calls.recover).toBe(1);
  });
  it('操作超时 → recover → 重试一次', async () => {
    const inner = new FakeDevice([model([el('A', 'Text')])]);
    inner.shell = async () => '1';
    let calls = 0;
    inner.tapRef = async () => { calls++; if (calls === 1) await new Promise((_, r) => setTimeout(() => r(new Error('hang')), 50)); };
    const wd = new DaemonWatchdog(inner, { actTimeoutMs: 20 });
    await wd.tapRef('x');
    expect(inner.calls.recover).toBe(1);
    expect(calls).toBe(2);
  });
  it('preFlight:socket 存在 → true;不存在 → false', async () => {
    const ok = new FakeDevice([]); ok.shell = async () => '1';
    const bad = new FakeDevice([]); bad.shell = async () => '0';
    expect(await new DaemonWatchdog(ok).preFlight()).toBe(true);
    expect(await new DaemonWatchdog(bad).preFlight()).toBe(false);
  });
});
```

- [ ] **Step 2: 验证失败** → FAIL

- [ ] **Step 3: 实现 `src/explore/daemon-watchdog.ts`**

```typescript
import type { ScreenModel } from '../screen-model';
import type { DevicePrimitives } from './types';

export interface WatchdogOptions {
  actTimeoutMs?: number;   // 操作超时,默认 12000(spec §4.7:正常<1s,降到 10–15s)
}

const DEFAULT_TIMEOUT = 12000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`operation timed out after ${ms}ms`)), ms)),
  ]);
}

/** Daemon 看门狗(spec §4.7):socket 探活 + 超时恢复。装饰 DevicePrimitives。 */
export class DaemonWatchdog implements DevicePrimitives {
  constructor(private inner: DevicePrimitives, private opts: WatchdogOptions = {}) {}

  get screenSize() { return this.inner.screenSize; }
  get actTimeoutMs() { return this.opts.actTimeoutMs ?? DEFAULT_TIMEOUT; }

  /** pre-flight:daemon socket 是否存在(spec §4.7)。 */
  async preFlight(): Promise<boolean> {
    try {
      const out = await this.inner.shell('cat /proc/net/unix 2>/dev/null | grep -c uitest_socket');
      return /[1-9]/.test(out.trim());
    } catch {
      return false;
    }
  }

  private async ensureAlive(): Promise<void> {
    const out = await this.inner.shell('cat /proc/net/unix 2>/dev/null | grep -c uitest_socket');
    if (!/[1-9]/.test(out.trim())) await this.inner.recover();
  }

  /** 探活 → 操作 → 超时则 recover → 重试一次。 */
  private async guarded<T>(op: () => Promise<T>): Promise<T> {
    await this.ensureAlive();
    try {
      return await withTimeout(op(), this.actTimeoutMs);
    } catch {
      await this.inner.recover();
      return await withTimeout(op(), this.actTimeoutMs);
    }
  }

  async dump(): Promise<ScreenModel> { return this.guarded(() => this.inner.dump()); }
  async tapRef(ref: string): Promise<void> { return this.guarded(() => this.inner.tapRef(ref)); }
  async tapCoord(x: number, y: number): Promise<void> { return this.guarded(() => this.inner.tapCoord(x, y)); }
  async pressBack(): Promise<void> { return this.guarded(() => this.inner.pressBack()); }
  launchApp(bundle: string, ability?: string): Promise<void> { return this.inner.launchApp(bundle, ability); }  // aa start 走 hdc
  shell(cmd: string, timeoutSec?: number): Promise<string> { return this.inner.shell(cmd, timeoutSec); }          // 不探活(避免递归)
  recover(): Promise<void> { return this.inner.recover(); }
}
```

- [ ] **Step 4: 验证通过 + 提交**

```bash
npx vitest run test/unit/explore/daemon-watchdog.test.ts   # PASS
git add src/explore/daemon-watchdog.ts test/unit/explore/daemon-watchdog.test.ts
git commit -m "feat(explore): DaemonWatchdog socket 探活+超时恢复(preFlight + guarded 重试)"
```

---

## Task 8: 生产 DevicePrimitives(createMcpDevice 包装 session.ts)

**Files:** Create `src/explore/mcp-device.ts`

**设计:** 闭包每次 `requireSession()` 现取 device/uitest(保证 recover 重连后拿到新对象);screenSize 创建时填一次(同设备不变);recover = disconnectSession + connectSession(sn)。

- [ ] **Step 1: 实现 `src/explore/mcp-device.ts`**

```typescript
import type { DevicePrimitives } from './types';
import {
  requireSession, connectSession, disconnectSession,
  captureScreenModel, actByRef,
} from '../mcp/session';

/** 生产 DevicePrimitives:包装 MVP session.ts。recover 重连后所有方法取新 session。 */
export async function createMcpDevice(): Promise<DevicePrimitives> {
  const { device } = requireSession();
  const sn = device.getSn();
  const size = await device.getScreenSize().catch(() => ({ width: 1080, height: 2340 }));

  return {
    screenSize: { w: size.width, h: size.height },
    dump: async () => (await captureScreenModel()).model,
    tapRef: async (ref) => { await actByRef(ref, 'click', 800); },
    tapCoord: async (x, y) => {
      const { uitest } = requireSession();
      await uitest.touchDown(x, y);
      await uitest.touchUp(x, y);
    },
    pressBack: async () => { await requireSession().uitest.pressKey(4); },
    launchApp: async (bundle, ability) => {
      await requireSession().device.shell(`aa start -a ${ability ?? 'EntryAbility'} -b ${bundle}`);
    },
    shell: (cmd, timeoutSec) => requireSession().device.shell(cmd, timeoutSec),
    recover: async () => { await disconnectSession(); await connectSession(sn); },
  };
}
```

- [ ] **Step 2: 类型检查 + 提交**

```bash
npx tsc --noEmit
git add src/explore/mcp-device.ts
git commit -m "feat(explore): 生产 DevicePrimitives(createMcpDevice 包装 session.ts)"
```

---

## Task 9: 桶导出 + 全量回归

**Files:** Create `src/explore/index.ts`、Modify `src/index.ts`

- [ ] **Step 1: 写 `src/explore/index.ts`**

```typescript
export type {
  DevicePrimitives, SenseResult, ExplorerConfig, ExploreReport, CoverageReport, TerminationReason,
} from './types';
export { LocatorUnresolved } from './types';
export { classifySafety } from './safety-filter';
export type { SafetyVerdict, SafetyReason } from './safety-filter';
export { classifyOpType } from './op-type';
export { extractFrontier, locatorSignature } from './frontier';
export type { FrontierCandidate, FrontierResult } from './frontier';
export { ActExecutor } from './act-executor';
export type { ActExecutorOptions, PerformResult } from './act-executor';
export { DaemonWatchdog } from './daemon-watchdog';
export type { WatchdogOptions } from './daemon-watchdog';
export { Explorer } from './explorer';
export { createMcpDevice } from './mcp-device';
```

- [ ] **Step 2: `src/index.ts` 追加导出**

```typescript
export * from './explore';
```

- [ ] **Step 3: 全量验证**

```bash
npm run build && npm run lint && npm run test:unit   # 全绿(阶段①② + 阶段③ explore)
```

- [ ] **Step 4: 提交**

```bash
git add src/explore/index.ts src/index.ts
git commit -m "feat(explore): 导出 explore 公共 API + 阶段③ 全量回归"
```

---

## Task 10: 真机端到端(扫只读 app 建图)

**Files:** Create `spike/explore-e2e.js`

**场景(spec §7/§9 阶段③):** 系统设置的只读查看页(显示/声音/关于手机),**禁入危险子树**(系统重置/账号/安全——SafetyFilter 黑名单已拦)。无人值守扫 → 产出 PageGraph + 覆盖率报告。

- [ ] **Step 1: 写 `spike/explore-e2e.js`**

```javascript
// 真机端到端:连设备 → DaemonWatchdog preFlight → Explorer 扫只读 app → 输出覆盖率 + 图。
// 注意 memory hos-scrcpy-daemon-input-conflict:探索用 MCP 截图模式,勿开投屏(避免占 daemon)。
process.env.MSYS_NO_PATHCONV = '1';
const path = require('path');
const { createMcpDevice, DaemonWatchdog, Explorer, ActExecutor } = require('../dist/explore');
const { MapStore } = require('../dist/page-graph');
const { connectSession, listDevices } = require('../dist/mcp/session');

const BUNDLE = process.env.EXPLORE_BUNDLE || 'com.android.settings';
const VERSION = process.env.EXPLORE_VERSION || '1.0';

async function main() {
  const devices = await listDevices();
  if (!devices.length) throw new Error('无设备,先 hdc connect');
  await connectSession(devices[0]);

  const raw = await createMcpDevice();
  const watchdog = new DaemonWatchdog(raw, { actTimeoutMs: 12000 });
  if (!(await watchdog.preFlight())) {
    console.error('preFlight 失败:uitest_socket 不存在,daemon 未独占。停投屏后重试。');
    process.exit(1);
  }

  const store = new MapStore(path.join(__dirname, 'maps'));
  const act = new ActExecutor(watchdog, { stallMs: 200 });
  const exp = new Explorer(act, watchdog, {
    appBundle: BUNDLE, appVersion: VERSION,
    maxSteps: Number(process.env.MAX_STEPS || 60),
    maxNoNewPage: 6, maxBacktrackFail: 3, sampleLimit: 8,
  }, store);

  const report = await exp.explore();
  console.log('=== 探索报告 ===');
  console.log('终止原因:', report.terminated);
  console.log('步数:', report.steps, ' 新页:', report.newPages);
  console.log('覆盖率:', JSON.stringify(report.coverage, null, 2));
  console.log('节点数:', report.graph.nodes.size, ' 边数:', report.graph.edges.length);
  console.log('图已落盘:', path.join(__dirname, 'maps', `${BUNDLE}-${VERSION}.json`));
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 构建 + 连真机 + 跑**

```bash
npm run build
# 确认设备在线:hdc list targets;勿开 Web 投屏(占 daemon)
EXPLORE_BUNDLE=<只读 app 包名> node spike/explore-e2e.js
```

- [ ] **Step 3: 记录结果 → 回填**
  - 核验:节点/边合理;SafetyFilter 拦住危险子树(dangerousSkipped > 0 且未误入重置/账号页);回溯/回 root 正常;覆盖率 visited/(total−dangerous−sampled) 合理。
  - spike 回填:`safety-filter.ts` 白/黑名单词表、`op-type.ts` 的 TOGGLE_T、`frontier.ts` 优先级权重。
  - 写 `spike/explore-report.md`。

- [ ] **Step 4: 提交**

```bash
git add spike/explore-e2e.js spike/explore-report.md
git commit -m "spike(explore): 真机端到端扫只读 app 建图 + 阈值回填"
```

---

## Self-Review

- **Spec 覆盖**:§4.2 ActExecutor(Task 3)、§4.3 SafetyFilter 白名单 FAIL-SAFE(Task 2)、§4.4 Explorer frontier+回溯+增量落盘+回 root(Task 6)+ 优先级抽样(Task 5)+ opType 判定表(Task 4)、§4.7 DaemonWatchdog(Task 7)、§9 阶段③ 全覆盖;MVP 范围只读 app 端到端(Task 10)。
- **控制流修正**:`perform(cur,...)` 消除 before 冗余 sense(对 spec §4.2 actByLocator 字面的落地优化,语义不变);Explorer cur 流 + toggle/noop/modal 自环不裂变节点(spec §3/§4.4);测试 dump 序列逐例核对(senseStable stallMs=0 下 2 dump 稳定)。
- **占位符**:无 TBD/TODO;阈值(TOGGLE_T=0.6、safety 词表、watchdog 12000ms)有初值,Task 10 spike 回填。
- **类型一致**:`DevicePrimitives`/`SenseResult`/`PerformResult`/`FrontierResult`/`ExploreReport` 在 types.ts/各模块定义,引用一致;`classifySafety→SafetyVerdict`、`classifyOpType→OpType`、`extractFrontier→FrontierResult`、`ActExecutor.perform→PerformResult` 签名前后一致。
- **对接真实接口**:createMcpDevice 包装 captureScreenModel/actByRef/requireSession().uitest.pressKey(4)/device.shell(aa start/getScreenSize);recover=disconnectSession+connectSession;resolveLocator/computeFingerprint/stripPopup/detectPopup/normalizeSkeleton/MapStore 用阶段①② 真实导出。
- **可测性**:SafetyFilter/opType/frontier 纯函数;ActExecutor/Explorer/DaemonWatchdog 经 DevicePrimitives 注入,FakeDevice 回放 ScreenModel 序列驱动。关键不变量:sense 弹窗剥离后指纹==无弹窗同页(Task 3);toggle 不裂变节点(Task 6)。

## 执行交接

Plan 完成并保存到 `docs/hos-scrcpy/docs/superpowers/plans/2026-08-08-slam-stage3-explorer.md`。沿用 subagent-driven(阶段①② 模式):每 task implementer + controller review。依赖顺序:types(Task 1)→ SafetyFilter(Task 2)→ ActExecutor(Task 3,依赖 DevicePrimitives + page-graph)→ opType/frontier(Task 4/5)→ Explorer(Task 6,依赖 2/3/4/5)→ DaemonWatchdog(Task 7)→ mcp-device(Task 8)→ 导出(Task 9)→ 真机(Task 10)。Task 1–9 纯单测不依赖设备;Task 10 需连真机。
