# selector 锚点录制回放(MVP)设计

- **日期**: 2026-08-08
- **状态**: 待复审(v2 —— 采纳三方 subagent 自检 findings 修订)
- **范围**: hos-scrcpy 录制/回放能力升级 —— 第一阶段(方案 A,MVP)
- **关联**: v1.4.0 坐标录制回放;`memory/record-socket-not-captured.md` 坐标录制缺陷
- **修订记录**: v2 修正事实性错误(flattenLayout 无 key 字段)、补 dump 时序/Web 集成/安全设计/手势聚合/模块分层等 CRITICAL+HIGH findings。标 `[待确认]` 处为需用户拍板的取舍点(见 §14 汇总)。

## 1. 背景与目标

v1.4.0 录制/回放走系统 `uiRecord` + `uiInput`,**只记坐标、无控件语义**,回放是"无脑坐标回放",且系统 `uiRecord` **不捕获 socket(`UitestServer`)注入的触摸** → 网页/MCP 输入(走 socket)录不准。

目标:升级为 **selector 锚点录制回放** —— 录制记控件锚点,回放按锚点重新定位,抗坐标漂移;应用层录制顺带解决 socket 坐标缺陷。页面脚本库与 agent 编排(方案 B)为后续演进,本 spec 仅概述。

### 成功标准(MVP)

1. 录制产出 `AnchoredAction`(坐标 + 控件锚点),坐标来自应用层输入(准),锚点来自操作时布局。
2. 回放按锚点在当前布局重新定位再点击,抗坐标漂移;失配时坐标兜底且可观测。
3. `anchor.ts` + 手势聚合核心逻辑 100% 单测覆盖(无设备可跑)。
4. 真机验证给出明确结论:`dumpLayout` 锚点稳定性、dump 耗时、命中/回放成功率 —— 结论决定能否进入方案 B。
5. **安全基线**:录制产物默认脱敏,导入脚本有完整性校验,agent 兜底有操作护栏(见 §8)。

## 2. 已锁定决策(澄清结果)

| 决策点 | 选择 | 理由 |
|---|---|---|
| 核心定位 | 外部编排(Claude Code) + 语义工具集 | 复用强 agent,不造 agent runtime;条件判断天然由 agent 做 |
| 运行模型 | 任务驱动 + 脚本优先 + agent 兜底 | 冷启动靠 agent,随使用越来越快 |
| 控件定位 | selector 锚点 | 业界标准,抗漂移,绕开 uiRecord 坐标缺陷 |
| 落地路径 | 分阶段 A → B | 先验证锚点可行性,不返工,YAGNI |

"自主探索器"= Claude Code(智能) + hos-scrcpy(语义工具集),非 hos-scrcpy 单独内置 agent。"条件触发"不需独立机制 —— agent 每步看屏幕即在做条件判断。

### 非目标(YAGNI,本 spec 排除)

- ❌ 方案 C(流程图引擎)—— 编排交 agent。
- ❌ 页面脚本库、查库回放、app 隔离索引 —— 方案 B,本 spec 仅概述。
- ❌ 内置 LLM agent runtime —— 已选外部编排。
- ❌ 录制用户真实手指操作(见 §3)。

## 3. 录制来源(关键取舍)

要拿控件锚点,录制必须在 hos-scrcpy 输入层做(**应用层录制**),而非系统 `uiRecord`。

| | 系统 uiRecord(现状) | 应用层录制(本方案) |
|---|---|---|
| 拿控件锚点 | ❌ 只产坐标 | ✅ 操作时 dump 布局 + 坐标命中控件 |
| socket 操作坐标 | ❌ 录不准(已知缺陷) | ✅ 准 |
| 录真实手指 | ✅ | ❌ 录不到 |
| 录 MCP/agent 注入操作 | 部分 | ✅ |

**取舍**:应用层录制录不到真实手指,但拿到锚点 + 坐标准,且解决 socket 坐标缺陷。对自动化测试场景可接受。

**实例隔离(修正 v1 误导)**:`UitestServer` 在 MCP(`session.ts:connectSession`)与 Web(`DeviceContext`)各创建独立实例。应用层录制 hook 挂在哪个实例,就只能录哪个路径的输入。**MVP 仅在 MCP session 实例挂 hook**,即只录 MCP/agent 注入的操作;Web 投屏路径的处理见 §4.6。`[待确认:Web 是否纳入 MVP,见取舍 C2]`

### 3.1 dump 时机策略 `[待确认:取舍 C1]`

`dumpLayoutRaw` 走命令行 `uitest dumpLayout -p <file>` + `pullFile` + 读盘,单次约 1-3 秒。逐 touch 事件 dump 不可行(一次 swipe 含 ~27 次 touch)。

**推荐方案(MVP)**:**按手势单元** dump —— 每个 down→up 手势,仅在 `touchDown` 时 dump 一次布局作为该手势锚点快照,`touchMove/touchUp` 复用。MCP/agent 是非实时驱动(每步操作间本就有思考间隔),down 前同步等 1-3 秒可接受。

**降级与替代(若真机验证延迟不可接受)**:
- (a) `touchDown` 先发(立即注入),dump 异步补(锚点对应操作后布局,接受小误差);
- (b) 用 socket `getLayout`(低延迟)替代命令行 dump —— 需先解决已知 socket 分包 bug(见 session.ts 注释);
- (c) 仅 `touchDown` 同步 dump(本推荐)。

**真机验证必测**:`dumpLayoutRaw` 单次耗时;该延迟下手势(swipe/drag)能否被设备正确识别。结论不达标则切 (a)/(b)。

## 4. 架构与组件

### 4.0 模块重构(前置,H3)

`anchor.ts` 要"纯函数零设备依赖",但 `UiElement`/`flattenLayout`/`dumpLayoutRaw` 现都在 `src/mcp/session.ts`,`recorder.ts`(在 `src/record/`)用它们会反向依赖 mcp 层。**下沉到共享模块**:

- 新增 `src/layout/`:`ui-element.ts`(类型 `UiElement`/`ControlAnchor`)、`flatten.ts`(`flattenLayout`)、`dump.ts`(`dumpLayoutRaw`,改造为不落盘或可清理,见 §8.3)。
- `session.ts`、`recorder.ts`、`anchor.ts` 都从此模块取用,消除反向依赖。

### 4.1 flattenLayout 改造(前置,修正 v1 事实错误,H1)

**v1 错误**:称"flattenLayout 已产出 key?"。实际 `key` 被 `strAttr(attrs, ['id', 'key'])` 消费进了 `id` 字段(取首个非空),`key` 从未单独暴露。

**必做改造**:从 `attributes` **分别提取** `id` 和 `key` 为 `UiElement` 的独立字段,使 `resolveAnchor` 的 `id > key` 优先级可实现。此项是 `anchor.ts` 的 hard dependency,排在编码最前(见 §12)。

### 4.2 `src/record/anchor.ts`(纯函数,零设备依赖)

```ts
export interface ControlAnchor { id?: string; key?: string; text?: string; type?: string; }

export interface AnchoredAction {
  op: 'click' | 'doubleClick' | 'longClick' | 'fling' | 'drag' | 'inputText' | 'key';
  x: number; y: number;        // 原始坐标(兜底 + 多匹配消歧)
  x2?: number; y2?: number; velocity?: number;
  text?: string;               // op=inputText 的文本(默认标 sensitive,见 §8.1)
  keyCode?: number; keyName?: string; keySource?: 'uitest' | 'uinput'; // op=key
  target?: ControlAnchor;      // 命中控件锚点(无锚点时 undefined,纯坐标兜底)
  sensitive?: boolean;         // 脱敏标记
}
```

- **`hitTest(elements, x, y)`**:扁平化布局中找 `bounds` 包含 (x,y) 的元素,按明确排序键选最具体:**先按锚点强度分组(id > key > text > 无锚点),组内按面积升序(更内层优先),取首个**。返回锚点;无带锚点元素则 undefined。
  - 注:`flattenLayout` 现过滤"无 text/id/clickable"的纯容器,被点的纯容器不在列表 → hitTest 可能命中祖先/邻近(已知限制,见 §13)。
- **`resolveAnchor(elements, target, x, y)`**:优先级 `id > key > text(+type 消歧)`:
  1. id 精确匹配 → 唯一则用;多个取离 (x,y) 最近(标 ambiguous)。
  2. key 精确匹配(同规则)。
  3. text + type 辅助 → 唯一或最近。
  4. 全失配 → (x,y) 坐标,matched=false。
  - `[待确认:type 消歧是否纳入 MVP]` —— 不纳入则 MVP 仅 id>key>text,type 留空。

### 4.3 手势聚合与拦截层(H4)

socket 输入是 down/[sleep]/move[]/up 序列,**必须聚合为手势单元**才记一个 `AnchoredAction`。

- **模式**:`recorder.ts` 持 `UitestServer` 引用,用 **wrapper/proxy** 包装其 `touchDown/Move/Up/inputText/pressKey`,维护手势状态机。**UitestServer 源码不改**(不侵入基础设施)。
- **聚合规则**(阈值待真机校准):
  - down→无 move→up = `click`
  - down→sleep(>~500ms)→up = `longClick`
  - 两次 click 间隔 <~300ms = `doubleClick`
  - down→move[](位移 >~10px)→up = `swipe`/`drag`(`fling` 按 velocity 阈值)
  - `inputText`/`pressKey` 各自独立动作
- **手势类 op 的 target** `[待确认:H9 相关]`:`fling`/`drag`/`swipe` 双端点,target 取**起点控件**(或可滚动容器,若可识别);MVP 取起点控件 + 标注为手势锚点。
- 聚合逻辑单测纳入 §9.1。

### 4.4 `recorder.ts` 扩展

- `startAppRecord()`/`stopAppRecord()`:挂/卸 wrapper,按 §3.1 dump 时机 + §4.3 聚合,累积 `AnchoredAction`。
- `replayAnchored(actions, opts)`:逐动作 dump 当前布局 → `resolveAnchor`(含等待重试,见 §7)→ 按 op 注入:
  - click/doubleClick/longClick/swipe/drag → touchDown/Move/Up(命中坐标)
  - `inputText` → resolveAnchor 定位输入框 → tap 聚焦 → `uitest.inputText`(两步复合)
  - `key` → 按 `keySource`:uitest 路径调 `uitest.pressKey`,uinput 路径走 `device.shell('uinput ...')`(复用 index.ts 回退逻辑)
- 现有系统 uiRecord 路径保留,重命名 `startCoordRecord`/`stopCoordRecord` 作降级;现有坐标 `replay` 保留。
- **pressKey uinput(H6)**:`uitest.pressKey` 只认 HOME/BACK,其余走 uinput 不经 UitestServer。录制 pressKey 记 `keyCode + keySource`;replayAnchored 按 source 分派,非 HOME/BACK 也走 uinput,避免录制丢失。
- **录制/回放互斥(H7)**:Recorder 增 `isAppRecording` 标志,与 `isReplaying` 互斥;同一 UitestServer 实例单录制源。dump(命令行)与 socket 输入在 MVP 假定串行(agent 逐步操作),并发抢占 daemon 列为风险(§10)。

### 4.5 MCP 接线(`session.ts` + `index.ts`,H2/H5)

- **actionSchema 扩展(H2)**:`z.object` 加 `target`/`text`/`keyCode`/`keyName`/`keySource`/`sensitive` 为 optional,避免 zod strip 掉锚点字段(replay 才能走锚点分支)。
- **replay 格式分派(H5)**:`AnchoredAction.op` 是字面量联合(比 `RecordedAction.op:string` 窄),**非严格超集**。TS 层需 cast;replay 先校验 op 值分派:`inputText`/`key` 走专门路径,**不能复用** `toUiInputCmd`(会落 default 变 click 的 silent bug)。
- **导出格式 envelope(H7-完整)**:加版本标识 `{ version: 2, type: 'anchored'|'coord', actions:[...] }`;`importScript` 按版本分派,旧裸数组当 v1。避免"target=undefined 的锚点脚本"与"纯坐标脚本"不可区分(单动作级检测不可靠)。
- `export_script`/`import_script` 默认脱敏 + HMAC(见 §8)。

### 4.6 Web 投屏路径 `[待确认:取舍 C2]`

`recorder.ts` 被 MCP + Web(`DeviceContext`)共用。

**推荐(MVP)**:应用层锚点录制**仅 MCP**;Web 投屏**保留现有坐标录制**(不阻塞实时输入,教学录制可用)。`DeviceContext` 的录制方法对接坐标录制路径;应用层录制后续再同步到 Web。

理由:Web 实时投屏每次 down 触发 1-3 秒 dump 会严重阻塞交互;MVP 聚焦 MCP/agent 自动化场景。

## 5. 数据流

```
录制(MCP 实例): wrapper 拦截 touchDown/Move/Up/inputText/pressKey
  → 每手势 down 时 dump 布局(§3.1)→ flatten → hitTest 命中控件
  → down..up 聚合为 AnchoredAction { 坐标 + target 锚点 }
回放: 读 AnchoredAction[]
  → 每动作 dump 当前布局 → resolveAnchor(失配则等待重试 §7)→ 取命中坐标注入
  → inputText: 定位输入框→tap→inputText; key: 按 source 注入
  → 失配重试耗尽 → 坐标兜底 + warning;连续失配 → 中止交回 agent
```

录制与回放同输入通道(socket touchDown/Up),坐标系一致,无缩放。

## 6. 降级与错误处理

**回放侧**:
| 情形 | 处理 |
|---|---|
| 锚点未命中但预期出现 | **等待重试**:默认 2s 内每 500ms 重 dump + resolve(H10),再走兜底 |
| 重试后仍失配 | 坐标兜底 + warning(matched=false) |
| 连续 N 步失配 | 中止 + 报告,交回 agent(N 可配,默认 3) |
| dump 布局失败 | 该步坐标兜底 |
| 多匹配歧义 | 取离原坐标最近 + 标 ambiguous(供 review) |
| target=undefined | 直接坐标回放 |

**录制侧(v2 补)**:
| 情形 | 处理 |
|---|---|
| dump 失败 / hitTest 无命中 | 记 `{op,x,y,...}` 不带 target(纯坐标) |
| 录制中设备断连 | 抛错并返回已累积动作 |
| pressKey 经 uinput | 记 op=key + keySource,不丢 |

**失配兜底的破坏性风险(M2)** `[待确认]`:坐标兜底可能点中删除/支付按钮。MVP 推荐默认坐标兜底(保持简单)+ 连续失配中止;未来增强"破坏性操作识别 + 该类操作禁用兜底/强制确认"(见 §8.2)。

## 7. 回放等待与页面跳转(H10/L1)

- **等待控件出现**:见 §6 回放侧首行(implicit wait 风格)。
- **页面跳转检测**:MVP 不做自动检测(连续失配中止已能兜住);列为已知限制(§13)。未来可加"布局剧变启发式"(本步与上步元素集 Jaccard < 阈值则暂停)。

## 8. 安全与隐私设计(新增,v2)

作为能自主操作设备的工具,安全为硬需求。

### 8.1 录制产物脱敏(C3)

- `AnchoredAction` 增 `sensitive?:boolean`;`inputText` 默认 `sensitive=true`。
- `export_script` **默认脱敏导出**:sensitive 字段值替换为 `<REDACTED:n>`(n=长度)或 HMAC 摘要;原文导出需显式 `raw:true`。
- 方案 B 的 `pageSnapshot` 只存锚点指纹(id/key 哈希),不存原始 text。
- `[待确认:脱敏默认开关 —— 推荐默认开,raw 显式]`

### 8.2 agent 兜底护栏 + 不可逆操作(C4/H8)

- **工具降权(推荐)**:agent 兜底路径下 `run_shell` 走白名单(仅允许只读/日志类命令),禁危险命令;或提供"危险操作确认 hook"。`[待确认:护栏严格度]`
- **操作审计日志**:每次 tap/input/key/run_shell 落审计行(时间、坐标、inputText 摘要、命令),便于事后追责。
- **不可逆操作**:MVP 不做自动识别(已知限制 §13);定义清单(支付/授权/删除/安装/发送/账户),未来回放或兜底命中时强制人工确认。
- **威胁模型**:信任边界 = 脚本文件来源;攻击面 = 被篡改脚本诱导 agent 执行高危操作。

### 8.3 脚本完整性(H8)

- `export_script` 附加 HMAC 签名(设备绑定密钥或对称密钥);`import/replay` 校验签名。
- 未签名/签名不符 → 标 `untrusted`,强制人工 review 或限制可用 op 集合。
- `[待确认:是否 MVP 做 HMAC —— 推荐做,成本低]`

### 8.4 数据残留(C6)

- `dumpLayoutRaw` 当前写 `os.tmpdir()` 可预测文件名、无权限、不清理。改为:`mode: 0o600` + 读后 `unlink`;或直接内存 Buffer 不落盘(`flattenLayout` 只需字符串,无需磁盘 I/O)。

### 8.5 dumpLayout 信息泄露(F5)

`dumpLayout` 返回完整 UI 树 + 内部 id 命名/type/description,辅助逆向、降低攻击门槛。**产物(脚本/快照)按敏感数据处理**;真机验证阶段同步评估是否暴露调试字段。

## 9. 测试与验证

### 9.1 单测(无设备,TDD)

- `anchor.ts`:`hitTest`(嵌套选最深、无锚点跳过、边界、组合排序)、`resolveAnchor`(id/key/text 优先级、唯一/多匹配/全失配/兜底、type 消歧)。
- `recorder.ts` **手势聚合**(v2 补):down/up 配对、click vs doubleClick vs longClick vs swipe/drag 判定、fling velocity 边界。

### 9.2 真机验证(M4 量化)

形态:`test/integration/anchor-stability.spec.ts`,纳入 `npm run test:integration`。量化判据:
- **锚点稳定性**:同 app 同页多次进入(≥5 次),id/key 一致率 **≥95%** 才算稳定。
- **dump 耗时**:单次 `dumpLayoutRaw` p95 上限(纳入 §3.1 决策)。
- **命中准确率**:点已知控件,hitTest 命中正确控件率 **≥90%**。
- **回放抗漂移**:录流程 → 改列表滚动/重进页面 → 锚点回放成功率,对比坐标回放。
- **手势时序**:down 前 dump 延迟下,swipe/drag 能否被设备正确识别(决定 §3.1 方案)。

结论:**锚点稳定 + dump 延迟可接受 → 进 B**;否则 B 需降级(ability 名主指纹、socket getLayout、视觉兜底等)。

## 10. 风险(v2 重构为三类)

**可行性风险**:
1. dump 延迟破坏手势时序(§3.1)—— 首要验证项。
2. dump-操作时间差致 hitTest 静默错命中(动画/异步加载/列表惯性)。
3. uitest daemon 单实例:录制+回放+dump 并发抢占 socket/daemon(MVP 假定串行)。
4. `dumpLayout` 锚点质量(id/key 是否稳定/混淆;纯容器无锚点)。
5. 手势聚合状态机复杂度(阈值需真机校准)。

**安全风险**:
6. 录制明文落盘(§8.1 缓解)。
7. 脚本篡改/完整性(§8.3 缓解)。
8. `dumpLayout` 信息泄露(§8.5)。

**操作风险**:
9. 不可逆操作无确认(§8.2,MVP 限制)。
10. agent 兜底 + run_shell(§8.2 护栏)。
11. 列表项同结构多实例滚动后点错(§13 限制)。

## 11. 方案 B 演进方向(概述)

A 验证通过后:`AnchoredAction` 加 `pageSnapshot`(锚点哈希);页面脚本库按 **app bundle + 页面标识**(ability 名 + 锚点集合指纹)归档;新增 `save_page_script`/`find_page_script`/`replay_page`;编排(到页→查库→命中回放/未命中 agent 操作→存档)。前置依赖:A 锚点稳定性结论。

## 12. 落地顺序(v2 修正依赖)

0. 模块重构(§4.0)+ flattenLayout 暴露独立 id/key(§4.1)—— **anchor.ts 前置**。
1. `anchor.ts` 类型 + `hitTest`/`resolveAnchor` + 单测(TDD,基于改后的 UiElement)。
2. `recorder.ts` 手势聚合(wrapper/proxy)+ 单测。
3. 真机确认 dump 耗时/锚点字段 → 定 §3.1 dump 策略 + 校准聚合阈值。
4. `recorder.ts` 应用层录制 + `replayAnchored`(含等待重试/降级)。
5. MCP 接线(actionSchema 扩展、replay 分派、envelope、脱敏、HMAC)。
6. 真机验证脚本 + 可行性结论。

## 13. 已知限制(MVP)

- 列表项同结构多实例滚动后不保证命中正确项(H9)—— 支持需"父容器锚点 + 项内序号"(方案 B)。`[待确认:MVP 是否列为限制,推荐:是]`
- 纯容器(无 text/id/clickable)被点时 hitTest 命中祖先/邻近。
- 不做页面跳转自动检测(连续失配中止兜底)。
- 不做不可逆操作自动识别(§8.2)。
- 应用层录制仅 MCP;Web 保留坐标录制(§4.6)。

## 14. 关键取舍点汇总 `[待你确认]`

| # | 取舍点 | 推荐方案 | 章节 |
|---|---|---|---|
| C1 | dump 时机策略 | 每手势 down 同步 dump 一次;延迟不可接受则降级 (a)/(b) | §3.1 |
| C2 | Web 是否纳入 MVP | 仅 MCP;Web 保留坐标录制 | §4.6 |
| C3 | 脱敏默认开关 | 默认脱敏,raw 显式 | §8.1 |
| C4 | agent 护栏严格度 | run_shell 白名单 + 审计日志;不可逆操作 MVP 不识别 | §8.2 |
| C5 | 脚本 HMAC | MVP 做 | §8.3 |
| C6 | 列表项消歧 | MVP 列为已知限制 | §13 |
| C7 | type 消歧 | MVP 可选(不纳入则仅 id>key>text) | §4.2 |
| C8 | 失配兜底破坏性 | MVP 默认坐标兜底 + 连续失配中止 | §6 |
