# 屏幕模型 + text 定位录制回放(MVP)设计

- **日期**: 2026-08-08
- **状态**: 待复审(v4 —— 经 6 轮 subagent review + 真机 spike 修订;精简屏幕模型为核心)
- **范围**: hos-scrcpy 录制/回放能力升级 第一阶段(方案 A,MVP)
- **关联**: v1.4.0 坐标录制;`memory/record-socket-not-captured.md`;`spike/` 真机数据;`2026-08-08-screen-model-draft.md`(终态参考架构)

## 0. 方向演变(实证驱动)

| 版本 | 核心 | 实证结果 |
|---|---|---|
| v1/v2 | selector id 跨 session 匹配 | ❌ 淘宝可点击控件稳定 id **4.7%**(NativeNode_ 动态) |
| v3 | text 定位(dumpLayout text) | ✅ 覆盖率 76–88% |
| **v4** | **精简屏幕模型 + text 定位 + @eN + MCP act 工具** | 三方 review 后精简,修正实证 |

**spike 实证(已入库 `spike/`)**:
- text 定位覆盖率:**淘宝首页 76% / 设置 88% / 淘宝消息流 88%**(系统免费 OCR,本地毫秒)。淘宝首页(图标密集)76% 是最弱场景。
- selector 稳定 id:淘宝 4.7% / 设置 94%(动态 app 失效)。
- `enabled` 有值(淘宝 88.8%/设置 99.8%);`checkable/checked` **实证全 false**(开关状态在兄弟节点 result text,不在这些字段)。
- 纯图标无子树 text:淘宝 **41%**,其中约 17% 靠"重叠邻近标签"救场(依赖关联)。
- dump 延迟 1.5–2.2s/次;锚点同 session 稳定,跨 session 动态 id 不稳。
- 命令行无"按属性操作"捷径;Driver API 跨 app 不可行;hypium 原生 RPC 也依赖控件属性。

## 1. 目标

把坐标录制回放升级为**屏幕模型 + text 锚点录制回放**:统一模型描述屏幕,text 定位为主(普适含淘宝),@eN 引用 + MCP act 工具让 Claude 低频高效编排;应用层录制解决 socket 坐标缺陷。

### 成功标准

1. `dump_ui` 输出屏幕模型(紧凑渲染 + 结构化 json 双输出)。
2. text 定位覆盖率 ≥76%(spike 已证),失配坐标兜底且可观测。
3. `act(ref)`/`find(locator)` MCP 工具可用,Claude 用 @eN 操作(免坐标搬运)。
4. 录制产 `AnchoredAction`(Locator + 兜底坐标);回放按 Locator 重定位,抗漂移。
5. 核心纯函数 100% 单测;真机验证 text 回放抗漂移率 + 非空 btn 占比。

## 2. 锁定决策

| 决策 | 选择 |
|---|---|
| 编排 | 外部编排(Claude Code) |
| 定位主路径 | text(dumpLayout text 字段) |
| 模型 | **精简 MVP**:Merger 留空 / Element 精简 / Locator 精简 |
| 引用 | **@eN 带 snapshot 代际 + 操作校验** |
| 录制 | 应用层 wrapper + 系统 uiRecord **并存** |
| 安全 | 全砍,推迟 B |

### 非目标(YAGNI,推迟 B;详见 screen-model-draft 终态参考)

多 Provider(Image/Ocr/Vision)、Merger 跨源融合、`checkable/checked`(实证空,改 text 断言)、`visualSig/provenance/confidence`、Locator 的 uiId/anchor/isBefore/role 筛选、弹窗/dialog 语义、scrollIntoView/waitFor、多窗口/分屏、页面脚本库、selector id 跨 session 匹配、安全设计、原生 findComponents RPC。

## 3. 精简 MVP 模型

```ts
ScreenModel { ts: number; elements: Element[] }

Element {
  ref: string;                 // '@eN#sN' — 元素序号 + snapshot 代际
  bounds: [l,t,r,b]; center: {x,y};
  texts: string[];             // 关联文字(子树 + 重叠邻近标签)
  hint?: string;               // 输入框 placeholder(空态定位用)
  attrs: { clickable?; scrollable?; enabled?; type? };  // 原始属性(role 用 type 代替)
}

// DumpProvider(MVP 唯一 provider):capture() 内部完成关联
//   dumpLayout → flatten → associateText(可点击控件 ← 子树/重叠邻近 text → texts[]) → Element[]
//   分配 @eN#sN
// Merger: MVP 留空(identity)——关联已在 DumpProvider 内完成,跨源融合推迟 B

Locator {                       // MVP 子集
  text?: string; textMode?: 'equals'|'contains'|'regex';
  hint?: string;
  within?: Locator; index?: number;   // 结构(几何包含近似父子)
  enabled?: boolean;
}
resolveLocator(model, locator): Element   // 按 Locator 在当前模型解析(精确 bounds,每次现算)

// 渲染给 Claude: "@eN [type] text → result" (过滤可交互+text, scrollable 容器浅缩进, 省 bounds)
```

## 4. MCP 工具

| 工具 | 用途 |
|---|---|
| `dump_ui` | 返回屏幕模型(**双输出**:compact 文本 + 结构化 json);format 参数切换 |
| `act(ref, op, ...)` | **用 @eN 操作**(click/longClick/inputText...);校验 ref 代际,过期则拒绝"请重新 dump_ui" |
| `find(locator) → ref` | 按 Locator 查元素返回 ref(找被渲染截断/视口外元素) |
| `tap/swipe/input_text(x,y)` | 现有坐标工具,降级为兜底 |
| `assert(ref, textContains)` | 文本断言(开关状态等,因 checked 无用走 text 旁路) |

## 5. 录制 / 回放

**录制(wrapper + uiRecord 并存)**:
- wrapper 拦截 `UitestServer`(touchDown/Move/Up/inputText)+ MCP 工具层 pressKey(uinput 分流在那);每手势 `touchDown` 前 dump 一次,move/up 复用;dump→模型→hitTest 命中元素→生成 Locator。
- 系统 uiRecord 保留(录真实物理触摸,与 wrapper 捕获集不重叠)。
- `AnchoredAction = { op, locator: Locator, fallbackCoord:{x,y}, ... }`。

**回放**:每动作 dump→模型→`resolveLocator`(text/hint/within/index/enabled)→bounds→注入;未命中→等待轮询(2s/500ms)→坐标兜底;连续 N 失配→中止交 Claude。

## 6. 关键设计(经 review 修正)

1. **Merger 留空,关联下沉 DumpProvider**:associateText(子树优先 + 重叠邻近 text)在 DumpProvider.capture() 内,MVP 不实现跨源 Merger。
2. **@eN 带代际 + act 校验**:ref=`@e3#s7`,act 收到 ref 校验 `#sN`==当前代际,不符拒绝。结构性消除 Claude 缓存旧 ref。
3. **开关断言走 text 旁路**:`checkable/checked` 实证全 false,断言改为 `assert(ref, textContains '已开启')`。
4. **hint 定位输入框**:输入框空态 text="",用 hint 匹配。
5. **flattenLayout 扩展**:提取 enabled/scrollable/hint;放宽 filter 收 scrollable 容器(role 容器);下沉 `src/layout/`(纯函数,DI 签名避循环 import)。
6. **录制模型并存**:wrapper(捕获 MCP/socket 注入)+ uiRecord(物理触摸)两套互补。

## 7. 降级与错误

| 情形 | 处理 |
|---|---|
| text 未命中但预期出现 | 等待轮询(2s/500ms),再坐标兜底 |
| 多个同 text | within/index 消歧;动态列表 index 漂移则坐标兜底 |
| 纯图标无 text | 坐标兜底 / Claude 低频视觉 |
| 连续 N 步失配 | 中止,交回 Claude |
| ref 代际过期 | act 拒绝,提示重新 dump_ui |
| dump 失败 | 该步坐标兜底 |

## 8. 测试与验证

**单测**:`associateText`(子树/重叠)、`hitTest`、`resolveLocator`(text/hint/within/index/enabled、多匹配消歧、兜底)、`render`(@eN 格式/过滤/分组)、@eN 代际校验;手势聚合。

**真机**(spike 已部分 + 待补):已证 text 76–88%、dump 延迟、字段实证;**待补**:① 淘宝首页"非空 btn"占比(associateText 关联后,验证纯图标 41% 能救多少);② 动态列表滚动后 text/index 漂移率;③ type→role 映射表。

## 9. 风险

1. **Merger/关联漏合并**:纯图标 41%,关联判据(子树+重叠邻近)待 spike 验证非空 btn 占比;救不回的靠坐标兜底/低频视觉。
2. **dump 延迟 2s/步**:回放长流程累积慢;优化 socket getLayout(版本限制)。
3. **动态内容 text 漂移**:信息流刷新 text 变,Locator textMode=regex 缓解 + 坐标兜底。
4. **within 几何重建误判**:flattenLayout 压平,within 靠 bounds 包含近似父子,密集布局可能误判 → 必要时 flattenLayout 输出 parent 引用。
5. **@eN 代际需 agent 遵守**:有 act 校验结构性保障,但 Claude 需养成"操作前 dump"习惯(prompt 约定)。

## 10. 落地顺序

0. `flattenLayout` 扩展(下沉 `src/layout/` 纯函数,+enabled/scrollable/hint,放宽 filter)+ fixture 入 `test/fixtures/`。
1. `src/screen-model/`:Element 类型 + DumpProvider(含 associateText)+ render + @eN 代际 + 单测(TDD)。
2. `resolveLocator`(text/hint/within/index/enabled)+ 单测。
3. MCP 工具:dump_ui 双输出 + act(ref)+ find(locator)+ assert。
4. 录制 wrapper(手势聚合)+ MCP 工具层 pressKey hook。
5. 回放(resolveLocator + 等待 + 坐标兜底)。
6. spike 补充(非空 btn 占比 / 动态漂移)+ Claude 编排闭环验证。
