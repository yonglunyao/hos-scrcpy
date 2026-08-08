# selector 锚点录制回放(MVP)设计

- **日期**: 2026-08-08
- **状态**: 待复审
- **范围**: hos-scrcpy 录制/回放能力升级 —— 第一阶段(方案 A,MVP)
- **关联**: 接续 v1.4.0 的坐标录制回放;`memory/record-socket-not-captured.md` 记录的坐标录制缺陷

## 1. 背景与目标

v1.4.0 已有脚本录制/回放,但走系统 `uiRecord` + `uiInput`,**只记坐标、无控件语义**,回放是"无脑坐标回放",存在两个问题:

1. 录制产物只有 `op + (x,y)`,坐标一变(分辨率、列表滚动、动态布局)就点错。
2. 已知缺陷:系统 `uiRecord` **不捕获 socket(`UitestServer`)注入的触摸**,而网页/MCP 输入走 socket → 当前录制坐标本就不准。

用户的目标是一个"具备页面/控件理解能力的智能自动点击系统":录制记控件语义,回放按控件重新定位,具备条件触发、归档复用、agent 兜底。

经澄清与方案对比(见 §2),本 spec 聚焦**第一阶段**:把录制/回放从"坐标"升级为 **selector 锚点**,并在真机验证锚点可行性与稳定性。页面脚本库与 agent 编排(方案 B)作为后续演进,本 spec 仅概述方向。

### 成功标准(MVP)

1. 录制产出 `AnchoredAction`(坐标 + 控件锚点),坐标来自应用层输入(准),锚点来自操作时的 `dumpLayout`。
2. 回放按锚点在当前布局重新定位控件再点击,抗坐标漂移;锚点失配时坐标兜底且可观测。
3. `anchor.ts` 核心算法 100% 单测覆盖(无设备可跑)。
4. 真机验证脚本给出明确结论:鸿蒙 `dumpLayout` 的 id/key 是否稳定、命中/回放成功率 —— 结论决定能否进入方案 B。

## 2. 已锁定决策(澄清结果)

| 决策点 | 选择 | 理由 |
|---|---|---|
| 核心定位 | 外部编排(Claude Code 驱动) + 语义工具集 | 复用强 agent,不重复造 agent runtime;条件判断天然由 agent 做 |
| 运行模型 | 任务驱动 + 脚本优先 + agent 兜底 | 冷启动靠 agent,随使用越来越快越省 |
| 控件定位 | selector 锚点 | 业界标准(Appium/Maestro),抗坐标漂移,绕开 uiRecord 坐标缺陷 |
| 落地路径 | 分阶段 A → B | 先验证锚点可行性(真机未知数),不返工,遵循 YAGNI |

**架构定位修正**:"自主探索器"= Claude Code(智能) + hos-scrcpy(语义工具集)的组合,而非 hos-scrcpy 单独内置 agent。因此"条件触发"不需要独立机制 —— Claude Code 每步看屏幕就在做条件判断。

### 非目标(YAGNI,本 spec 明确排除)

- ❌ 方案 C(全流程编排/流程图引擎)—— 编排交 Claude Code,不在 hos-scrcpy 内重复实现。
- ❌ 页面脚本库、查库回放工具、app 隔离索引 —— 属方案 B,本 spec 仅概述。
- ❌ 内置 LLM agent runtime —— 已选外部编排。
- ❌ 录制用户真实手指操作(见 §3 取舍)。

## 3. 录制来源(关键取舍)

要拿到"控件锚点",录制必须在 hos-scrcpy 输入层做(**应用层录制**),而非系统 `uiRecord`。

| | 系统 uiRecord(现状) | 应用层录制(本方案) |
|---|---|---|
| 拿控件锚点 | ❌ 只产坐标 | ✅ 操作时 dump 布局 + 坐标命中控件 |
| socket 操作坐标 | ❌ 录不准(已知缺陷) | ✅ 准(在自己输入层记) |
| 录真实手指操作 | ✅ 能 | ❌ 录不到(手指不经过 hos-scrcpy) |
| 录 agent/脚本/浏览器点击 | 部分 | ✅ 全部 |

**取舍**:应用层录制录不到用户真实手指操作,但能拿到锚点 + 坐标准,且**顺带解决 uiRecord 不录 socket 坐标的旧缺陷**。对"app 自动点击/自动化测试"场景可接受 —— 操作来源本就是 hos-scrcpy。录真实手指本就只有坐标、无锚点,对"控件级"目标无价值。

**做法**:在 `UitestServer` 的 `touchDown/touchMove/touchUp/inputText/pressKey` 上挂可开关的录制拦截。每次操作**前** dump 当前布局 → 扁平化 → 用动作坐标命中控件 → 累积为 `AnchoredAction`。系统 `uiRecord` 路径保留,降级为"纯坐标录制"备选(给确需录真实手指的场景)。

## 4. 架构与组件

遵循小文件 / 高内聚低耦合,核心算法做**纯函数**便于单测。

### 4.1 `src/record/anchor.ts`(新增,纯函数,零设备依赖)

```ts
export interface ControlAnchor {
  id?: string;
  key?: string;
  text?: string;
  type?: string;
}

export interface AnchoredAction {
  op: 'click' | 'doubleClick' | 'longClick' | 'fling' | 'drag' | 'inputText' | 'key';
  x: number;            // 原始坐标(回放兜底 + 多匹配消歧)
  y: number;
  x2?: number;
  y2?: number;
  velocity?: number;
  text?: string;        // op=inputText 时的文本
  key?: string;         // op=key 时的键名
  target?: ControlAnchor; // 命中控件的锚点(无锚点时为 undefined,纯坐标兜底)
}

export interface ResolveResult {
  x: number;
  y: number;
  matched: boolean;     // 是否成功锚点定位(false = 坐标兜底)
  via?: 'id' | 'key' | 'text'; // 命中用的字段
  ambiguous?: boolean;  // 是否存在多匹配歧义
}
```

- `hitTest(elements, x, y): ControlAnchor | undefined`
  在扁平化布局(复用 `session.ts` 的 `flattenLayout` 产物 `UiElement[]`)中,找 `bounds` 包含 (x,y) 的元素,选**最具体**的:有 id/key/text 优先于纯 clickable;面积更小(更内层)优先。返回该元素锚点;无带锚点的元素则返回 undefined。

- `resolveAnchor(elements, target, x, y): ResolveResult`
  按优先级 `id > key > text(+type 消歧)` 在当前布局里定位控件 center:
  1. id 精确匹配 → 唯一则用;多个取离 (x,y) 最近(标记 ambiguous)。
  2. key 精确匹配(同规则)。
  3. text 匹配 + type 辅助 → 唯一或最近。
  4. 全失配 → 用 (x,y) 坐标,matched=false。

### 4.2 `src/record/recorder.ts`(扩展)

- 新增应用层录制:
  - `startAppRecord()`:在 `UitestServer` 上挂输入拦截(down/move/up/inputText/pressKey),每次操作前 dump 布局 → `flattenLayout` → `hitTest` → 累积 `AnchoredAction`。
  - `stopAppRecord(): AnchoredAction[]`:卸载拦截,返回列表。
- 新增 `replayAnchored(actions, onStep?)`:逐动作 dump 当前布局 → `resolveAnchor` → 按 op 注入(touchDown/Up/Move 或 uiInput 命令);每步回调可观测 matched/ambiguous。
- 现有系统 uiRecord 路径重命名为 `startCoordRecord`/`stopCoordRecord`(纯坐标)作降级备选;现有 `replay`(坐标)保留。
- 拦截实现需注意:`touchDown(x,y)` 与 `touchMove`/`touchUp` 组成一次手势,录制应以**手势单元**累积(避免把一次 swipe 拆成多个零散动作)。输入层需暴露"手势开始/结束"边界,或按 down→up 聚合。

### 4.3 `src/mcp/session.ts` + `src/mcp/index.ts`(改动)

- `session.ts`:新增 `startAppRecord`/`stopAppRecord`/`replayAnchoredActions` 薄封装。
- `index.ts`:
  - `start_record` 默认走应用层录制(产出锚点);保留坐标录制为可选(如 `mode: 'coord'` 参数)。
  - `replay` 自动检测格式:动作含 `target` → 锚点回放;否则 → 原坐标回放。
  - `export_script`/`import_script` 兼容两种格式(AnchoredAction 是 RecordedAction 的超集)。

### 4.4 现有 `UiElement` 复用

`session.ts` 的 `flattenLayout` 已产出 `{ text, id, key?, type, clickable, bounds, center }`(注:当前 `id` 取自 `['id','key']`,需确认是否把 `key` 单独暴露给锚点用 —— 见 §8 风险)。

## 5. 数据流

```
录制: 输入层拦截(touchDown/Move/Up/inputText/pressKey)
        → 操作前 dump 布局 → flattenLayout → hitTest 命中控件
        → 累积 AnchoredAction { 坐标 + target 锚点 }
        → (down..up 聚合为一个手势动作)

回放: 读 AnchoredAction[]
        → 每动作 dump 当前布局 → resolveAnchor 定位控件
        → 取命中坐标 注入 touchDown/Up(或 uiInput 命令)
        → 失配 → 坐标兜底 + warning;连续失配 → 中止 + 报告
```

录制与回放**同一输入通道**(socket touchDown/Up),坐标系一致,无缩放。

## 6. 降级与错误处理

| 情形 | 处理 |
|---|---|
| 锚点失配(单步) | 坐标兜底 + warning(matched=false) |
| 连续 N 步失配 | 中止回放 + 报告,交回 agent(N 可配,默认 3) |
| dump 布局失败 | 该步坐标兜底 |
| 多匹配歧义 | 取离原坐标最近 + 标记 ambiguous(供 review) |
| 操作无锚点(target=undefined) | 直接坐标回放 |

原则:回放"尽力而为 + 可观测",失败交回 Claude Code(agent 兜底)。

## 7. 测试与验证

### 7.1 单测(`anchor.ts` 纯函数,无设备,TDD)

- `hitTest`:嵌套元素选最深、无锚点元素跳过、坐标在边界、多候选选最具体。
- `resolveAnchor`:id/key/text 各优先级、唯一匹配、多匹配取最近、全失配坐标兜底、type 消歧。

### 7.2 真机验证脚本(可行性结论,A 阶段核心交付)

- **锚点稳定性**:同一 app 同一页面多次进入,`dumpLayout` 的 id/key 是否一致(决定 B 的页面指纹可行性)。
- **命中准确性**:点已知控件 → `hitTest` 是否命中正确控件。
- **回放抗漂移**:录流程 → 改列表滚动位置 / 重进页面 → 锚点回放是否仍命中。
- **对比坐标回放**:同一流程,坐标回放 vs 锚点回放成功率。

结论:**锚点稳定 → 可进入 B**;**锚点不稳定 → B 需降级方案**(如 ability 名为主指纹,锚点为辅,或引入视觉兜底)。

## 8. 已知风险

1. **鸿蒙 `dumpLayout` 锚点质量未验证**:id/key 是否稳定、是否被混淆/动态生成、非原生(自绘)控件是否无锚点。这是 A 阶段首要验证项;若大量控件无稳定锚点,需评估视觉兜底(推迟到结论后)。
2. **`flattenLayout` 的 id/key 字段**:当前 `id` 取自 `['id','key']` 合并,锚点需要 id 与 key 分别可用以支持优先级。需在真机确认 dumpLayout 实际字段,可能需调整 `flattenLayout` 把 `key` 单独暴露。
3. **手势单元聚合**:socket 输入是 down/move/up 序列,录制须聚合为一次手势动作,不能拆零散。需在输入层确立手势边界。
4. **inputText / pressKey 的锚点**:inputText 先 tap 聚焦输入框,锚点取输入框;pressKey 无坐标,target 留空(按键回放不需要定位控件)。

## 9. 方案 B 演进方向(概述,本 spec 不细化)

A 验证通过后演进:

- `AnchoredAction` 增 `pageSnapshot`(页面锚点集合,用于页面指纹)。
- 页面脚本库:按 **app bundle + 页面标识**(ability/window 名粗筛 + 锚点集合指纹精匹配)归档"页面局部脚本"。
- 新增 MCP 工具:`save_page_script` / `find_page_script` / `replay_page`。
- 编排(Claude Code):到页面 → `find_page_script` → 命中 `replay_page` / 未命中 agent 操作 → 操作完 `save_page_script`。
- 前置依赖:A 阶段锚点稳定性结论。

## 10. 落地顺序(供 writing-plans 参考)

1. `anchor.ts` 类型 + `hitTest`/`resolveAnchor` + 单测(TDD,无设备先行)。
2. 真机确认 `dumpLayout` 字段 → 必要时调整 `flattenLayout`(暴露 key)。
3. `recorder.ts` 应用层录制(输入拦截 + 手势聚合)。
4. `recorder.ts` `replayAnchored` + 降级。
5. MCP 工具接线(`start_record`/`replay` 格式自适应)。
6. 真机验证脚本 + 得出可行性结论。
