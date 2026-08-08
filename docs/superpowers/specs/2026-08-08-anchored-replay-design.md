# text 定位录制回放(MVP)设计

- **日期**: 2026-08-08
- **状态**: 待复审(v3 —— 基于真机 spike + uitest 文档 + hypium 调研,方向从 selector id 转为 text 定位)
- **范围**: hos-scrcpy 录制/回放能力升级 —— 第一阶段(方案 A,MVP)
- **关联**: v1.4.0 坐标录制回放;`memory/record-socket-not-captured.md`;`spike/` 真机验证数据

## 0. 方向演变(实证驱动,关键)

| 版本 | 核心定位假设 | 实证结果 |
|---|---|---|
| v1/v2 | selector id 跨 session 匹配 | ❌ spike:淘宝可点击控件**稳定 id 仅 4.7%**(`NativeNode_` 动态 id),设置 94%。id 对动态渲染 app 失效 |
| **v3** | **text 定位为主**(系统免费 OCR) | ✅ spike:**text 定位覆盖率淘宝 88% / 设置 88% / 首页 76%**,本地毫秒级,零成本 |

**调研佐证**:uitest 命令行无"按属性操作"捷径;Driver API 跨 app 不可行(专家确认);hypium 原生 RPC 也依赖控件属性,救不了无锚点 app。**唯一对动态 app 普适的轻量定位 = 屏幕渲染出来的文字(text)**,而 dumpLayout 的 text 字段是系统直接给的(比像素 OCR 更准、毫秒级)。

## 1. 目标

把坐标录制回放升级为 **text 锚点录制回放**:录制记控件关联 text,回放按 text 重新定位,抗坐标漂移;应用层录制顺带解决 socket 坐标缺陷。普适所有 app(含淘宝)。

### 成功标准(MVP)

1. 录制产出 `AnchoredAction`(坐标 + **text 锚点**),坐标来自应用层输入(准),text 来自 dumpLayout。
2. 回放按 text 在当前布局重新定位再点击,**text 定位覆盖率 ≥80%**(spike 已证),失配时坐标兜底且可观测。
3. `anchor.ts` 核心纯函数 100% 单测(无设备)。
4. 录制/回放走本地 dumpLayout 解析(毫秒级),**不依赖每步 LLM 视觉**;Claude 仅低频决策。
5. 真机验证 text 定位回放的抗漂移成功率 + 效率。

## 2. 锁定决策

| 决策点 | 选择 | 依据 |
|---|---|---|
| 编排 | 外部编排(Claude Code) | 复用强 agent,不造 agent runtime |
| **定位主路径** | **text(dumpLayout text 字段)** | spike 88% 普适,本地高效 |
| 定位补充 | 图像模板(图标)+ Claude 视觉(低频) | text 缺失时兜底 |
| 录制来源 | 应用层(输入层拦截) | 拿 text 锚点 + 坐准,解决 socket 缺陷 |
| 落地 | 分阶段 A→B | 先验证 text 定位可行性 |

### 非目标(YAGNI,本 spec 排除,推迟到 B)

- ❌ selector id 跨 session 匹配(spike 证动态 app 4.7% 失效)—— 降为规范 app 可选增强。
- ❌ 安全设计(脱敏/HMAC/护栏)—— 用户决定全砍,推迟到 B 脚本持久化/共享时。
- ❌ 页面脚本库、查库回放、app 隔离索引 —— 方案 B。
- ❌ 原生 `UiDriver.findComponents` RPC(hypium 协议)—— 可选增强,非必需。
- ❌ 内置 LLM agent runtime —— 已选外部编排。

## 3. 定位策略(三层,快→慢)

| 层 | 方法 | 覆盖(spike) | 速度 | 何时用 |
|---|---|---|---|---|
| **1. text 定位**(主) | dumpLayout text 字段 + 关联可点击控件 | 76–88% | 毫秒(本地) | 默认每步操作 |
| **2. 图像模板**(补) | opencv 模板匹配(预存图标) | ~12–24%(纯图标) | 快(本地) | text 缺失的图标按钮 |
| **3. Claude 视觉**(兜底) | 截图 + LLM 理解 | 边缘 | 慢 | 页面级决策/全新场景,低频 |

**text 定位的关联规则**(spike 验证):可点击控件本身的 text 常为空(text 在子节点),按"**可点击控件子树内的 text**"(主,如按钮内文字)或"**bounds 重叠的 text**"(邻近标签)关联。spike 数据:子树 text 覆盖 59–88%,加邻近重叠达 76–88%。

## 4. 架构与组件

### 4.0 模块重构(前置)

`UiElement`/`flattenLayout`/`dumpLayoutRaw` 现在 `src/mcp/session.ts`,`recorder.ts` 用会反向依赖。下沉到共享模块 `src/layout/`(`ui-element.ts`/`flatten.ts`/`dump.ts`),消除反向依赖。`dumpLayoutRaw` 改 DI 签名 `(device) => string` 避免循环 import;改内存 Buffer 不落盘(或 0600+unlink)。

### 4.1 flattenLayout 增强

当前只收 `{text,id,type,clickable,bounds,center}`。增强:保留完整 text 节点(text+bounds)用于 text 定位;`id`/`key` 仍收(规范 app 增强用),但**不作为主路径**。

### 4.2 `src/record/anchor.ts`(纯函数,零设备依赖,TDD 核心)

```ts
export interface TextAnchor {
  text: string;              // 关联的文字内容
  pattern?: 'equals' | 'contains' | 'regex'; // 匹配模式,默认 contains
  relation: 'subtree' | 'overlap'; // text 与控件的关联方式
}
export interface IdAnchor { id?: string; key?: string; } // 规范 app 可选增强

export interface AnchoredAction {
  op: 'click' | 'longClick' | 'swipe' | 'drag' | 'fling' | 'inputText' | 'key';
  x: number; y: number; x2?: number; y2?: number; velocity?: number;
  text?: string; keyCode?: number; keySource?: 'uitest' | 'uinput';
  textAnchor?: TextAnchor;   // 主锚点(spike 88% 覆盖)
  idAnchor?: IdAnchor;       // 规范 app 可选辅助
}
```

纯函数:
- `associateText(clickable, textNodes)`:给可点击控件关联 TextAnchor(子树优先,否则重叠)。
- `hitTest(elements, x, y)`:录制时坐标→控件(选 bounds 含坐标、最具体的)。
- `locateByText(elements, anchor)`:回放时按 TextAnchor 在当前布局找控件 center(支持 within/位置消歧)。
- `resolveAnchor(elements, action)`:回放定位,优先 textAnchor → idAnchor → 坐标兜底。

### 4.3 录制(应用层,wrapper/proxy)

`recorder.ts` 持 `UitestServer` 引用,用 wrapper/proxy 包装 `touchDown/Move/Up/inputText/pressKey`(UitestServer 源码不改),维护手势状态机聚合为手势单元(down/up 配对 → click/longClick/swipe/drag,阈值真机校准)。

- **dump 时机**(spike A2:dumpLayout ~1.5–2.2s/次):每手势单元的 `touchDown` 前 dump 一次,move/up 复用。MCP/agent 非实时驱动,该延迟可接受;真机验证若不可接受则降级(down 先发 + dump 异步补,或 socket getLayout 快路径)。
- 每次 dump → flatten → hitTest 命中控件 → associateText 生成 TextAnchor → 累积 AnchoredAction。
- **pressKey uinput**(H6):uinput 分流在 MCP 工具层(index.ts)不经 UitestServer,pressKey 录制 hook 须在 MCP 工具层,记 keyCode+keySource。
- 现有系统 uiRecord 路径保留为"纯坐标录制"降级。

### 4.4 回放

`replayAnchored(actions)`:
- 逐动作 dump 当前布局 → `resolveAnchor`(textAnchor 优先)→ 取命中 center 注入(touchDown/Up 或 inputText 两步)。
- **等待控件**:text 未命中 → 短轮询(默认 2s/500ms 重 dump + locate),再坐标兜底。
- 连续 N 步失配 → 中止 + 报告,交回 Claude(低频决策兜底)。
- inputText:text 定位输入框 → tap 聚焦 → inputText;key:按 keySource 注入。

### 4.5 MCP 接线

- `actionSchema` 扩展 optional `textAnchor`/`idAnchor`/`text`/`keyCode`(避免 zod strip 锚点字段)。
- `replay` 检测格式(有 textAnchor → text 回放;纯坐标 → 原回放)。
- 导出 envelope `{version, type, actions}` 区分格式。
- 录制工具走应用层;`dump_ui`(已有)+ `screenshot`(已有,供 Claude 低频视觉)。

### 4.6 Web 路径

MVP 仅 MCP 应用层录制;Web 保留现有坐标录制(不阻塞实时输入),后续同步。

## 5. 数据流

```
录制(MCP): wrapper 拦截 down/move/up/input/pressKey
  → 每手势 down 前 dump → flatten → hitTest 命中控件 → associateText
  → 累积 AnchoredAction {textAnchor + 坐标}
回放: 读 action → dump 当前布局 → locateByText(textAnchor)
  → 取 center 注入;未命中→等待轮询→坐标兜底;连续失配→中止交 Claude
Claude 编排: dump_ui/screenshot(低频看)→ 录制/回放/坐标操作 → 决策下一步
```

## 6. 降级与错误处理

| 情形 | 处理 |
|---|---|
| text 未命中但预期出现 | 等待轮询(2s/500ms),再坐标兜底 |
| 轮询后仍失配 | 坐标兜底 + warning |
| 多个同 text | 按 within/离原坐标最近消歧;歧义标记 |
| 连续 N 步失配 | 中止,交回 Claude |
| dump 失败/纯图标无 text | 坐标兜底;图标场景后续接图像模板 |
| 录制中 dump 失败 | 记坐标不带 textAnchor |

## 7. 测试与验证

### 7.1 单测(anchor.ts 纯函数)
`associateText`(子树/重叠)、`hitTest`、`locateByText`(equals/contains/regex、多匹配消歧)、`resolveAnchor`(优先级+兜底);手势聚合判定(click/longClick/swipe/drag)。

### 7.2 真机验证(spike 已部分完成 + 补充)
- **已证(spike)**:text 定位覆盖率 76–88%(淘宝/设置/首页);dump 延迟 1.5–2.2s;锚点同 session 稳定。**fixture 已在 `spike/` 入库**。
- **待证**:text 定位回放的抗漂移成功率(改列表滚动/重进页面后仍命中);录制/回放端到端延迟;手势聚合阈值校准。

## 8. 风险

1. **dump 延迟(1.5–2.2s/次)**:每手势 dump 一次 → 每步 ~2s。比 LLM 视觉快,但仍是主开销。优化:socket getLayout(版本限制 6.0.2.x)+ 缓存。
2. **纯图标控件无 text(~12–24%)**:需图像模板(后续)或坐标兜底/低频视觉。
3. **dump-操作时间差**:dump 时与 touch 时 UI 可能漂移(动画/异步)。限定稳定态 dump。
4. **同 text 歧义**(列表项同名):within/位置消歧,极端情况兜底。
5. **手势聚合状态机复杂度**:阈值真机校准。
6. **跨 session text 稳定性**:text(文字内容)通常比 id 稳定,但动态内容(商品名)会变 —— 录制复用以"确定性坐标序列 + text 校验"为主,跨 session text 匹配为辅。

## 9. 方案 B 演进方向(概述)

- 页面脚本库:按 app + 页面标识(ability 名 + text 集合指纹)归档"text 锚点局部脚本"。
- 图像定位:opencv 模板匹配补纯图标控件。
- 原生 RPC:借鉴 hypium 协议扩展 socket 发 `UiDriver.findComponents`(规范 app 原生查找增强)。
- 安全设计:脚本持久化/共享时补脱敏/HMAC/护栏。
- 前置依赖:v3 的 text 定位可行性结论。

## 10. 落地顺序

0. 模块重构(§4.0)+ flattenLayout text 收集 + spike fixture 入 `test/fixtures/`。
1. `anchor.ts` 类型 + `associateText`/`hitTest`/`locateByText`/`resolveAnchor` + 单测(TDD,基于 fixture)。
2. 真机校准 dump 时机/手势聚合阈值。
3. `recorder.ts` 应用层录制(text 锚点)+ 手势聚合。
4. `replayAnchored`(text 定位 + 等待 + 坐标兜底)。
5. MCP 接线(actionSchema/envelope/格式分派)。
6. 真机验证 text 定位回放抗漂移 + 效率;Claude 编排闭环。
