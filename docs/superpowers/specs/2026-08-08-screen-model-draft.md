# 屏幕统一模型(草案,待审)

- **日期**: 2026-08-08
- **状态**: 草案,待 subagent review → 定稿后并入主 spec(v4)
- **动机**: 不同"理解屏幕"的技术(dumpLayout/图像/OCR/视觉)converge 到一个统一模型,上层(录制/回放/agent)只消费模型,技术可插拔

## 1. 背景与实证依据(spike)

真机 spike(`spike/` 已验证,脚本入库):
- selector id 对动态 app 失效:淘宝可点击控件**稳定 id 4.7%**(NativeNode_ 动态),设置 94%。
- **text 定位(dumpLayout text 字段=系统免费OCR)覆盖率 76–88%**(淘宝88/设置88/首页76),本地毫秒级。
- dump 延迟 1.5–2.2s/次;锚点同 session 稳定,跨 session 动态 id 不稳。
- uitest 命令行无"按属性操作"捷径;Driver API 跨 app 不可行(专家确认);hypium 原生 RPC 也依赖控件属性。

**结论**:单一 selector 路径不行;需要多技术(text/图像/视觉)统一的模型,各技术作 provider。

## 2. 模型定稿

```ts
ScreenModel { ts: number; sources: Source[]; elements: Element[]; deviceSize: {w,h} }

Element {
  ref: string;                         // @eN,模型内唯一(同 snapshot)
  bounds: [l,t,r,b]; center: {x,y};    // 像素精确(内部,触摸用)
  role: 'button'|'text'|'input'|'image'|'link'|'list'|'container'|...;
  texts: string[];                     // 关联文字(子树/重叠)
  attrs: { clickable?; scrollable?; enabled?; checkable?; checked?; uiId?; uiKey?; type? };
  visualSig?: string;                  // 图标特征(image provider)
  provenance: Source[];                // 来源融合 ['dump','image',...]
  confidence: number;                  // 0-1
}

// Provider 接口:各技术实现,产 RawElement[]
interface ScreenProvider { source: Source; capture(ctx): Promise<RawElement[]> }
//  DumpProvider(MVP 主): dumpLayout → flatten → {texts,uiId,uiKey,type,clickable,...,bounds}
//  ImageProvider(后续): 截图+模板库 → {visualSig,bounds,role:'image'}
//  OcrProvider(后续):   截图+OCR → {texts,bounds}
//  VisionProvider(后续): 截图+LLM → {role,texts,bounds}(低频)

// Merger: 多 provider 的 RawElement[] → 按 bounds 重叠/包含融合成 Element,分配 @eN

Locator {                               // 稳定定位描述(跨 snapshot)
  text?: string; textMode?: 'equals'|'contains'|'regex';
  uiId?: string; uiKey?: string; role?: ElementRole;
  within?: Locator; index?: number; isBefore?: Locator; isAfter?: Locator;  // 结构
  anchor?: Locator; offset?: {dx,dy}; region?: 'top-left'|...;               // 空间
  visualSig?: string;                    // 视觉
  state?: { enabled?: boolean; checked?: boolean; checkable?: boolean };    // 状态
}
resolveLocator(model, locator): Element  // 在当前模型按 Locator 解析出元素(精确 bounds,每次现算)

// 布局渲染(给 agent,Claude 看):"@eN [role] text → result"
//   过滤可交互(clickable/scrollable/input)+有 text 的;scrollable 容器浅缩进;省 bounds

// assert: 状态断言 {enabled?/checked?/exists?}
```

## 3. 数据流

```
感知: Providers.capture → Merger(按bounds融合 + 分配@eN) → ScreenModel
渲染: ScreenModel → "@eN [role] text" 紧凑文本 → Claude(低频决策)
操作: snapshot → 用 @eN 或 Locator → resolveLocator 得精确 bounds → touchDown/Up
录制: 操作的元素 → 生成 Locator 存入 AnchoredAction(不存死坐标)
回放: 新 snapshot → resolveLocator(Locator) → 当前 bounds → 操作
```

## 4. 录制/回放(基于模型)

- AnchoredAction = { op, locator: Locator, fallbackCoord: {x,y}, ... };op 支持 click/longClick/swipe/drag/inputText/key。
- 录制:应用层 wrapper 拦截 UitestServer 输入(每手势 down 前 dump 一次,move/up 复用),dump→模型→hitTest 命中元素→生成 Locator。
- 回放:每动作 dump→模型→resolveLocator→bounds→注入;未命中→等待轮询(2s/500ms)→坐标兜底;连续 N 失配→中止交 Claude。
- pressKey uinput 分流在 MCP 工具层,录制 hook 须在那层。

## 5. 关键设计决策(待审重点)

1. **@eN 生命周期**:每次 snapshot 重新分配,跨 snapshot 不保证(操作后须重 snapshot,agent-device 规则)。跨 snapshot 定位靠 Locator,不靠 ref。
2. **多 provider 融合**:按 bounds 重叠/包含合并成一个 Element,provenance 记来源,texts 取并集,role 取最具体。MVP 单 DumpProvider,Merger 退化。
3. **过滤与 token**:给 agent 的渲染只留可交互+有 text 的元素,目标 <50 行;省 bounds(agent 用 @eN)。
4. **state 维度**:enabled/checkable/checked 收入 attrs + Locator.state 筛选 + assert;首页少用,开关页/断言有用。
5. **dump 延迟(1.5–2.2s)**:每手势 dump 一次是主开销;比 LLM 视觉快;优化留 socket getLayout(版本限制)。
6. **Locator 多维度**:内容(text/uiId)+结构(within/index/isBefore)+空间(anchor/region)+视觉(visualSig)+state,组合到唯一即解析出精确 bounds。

## 6. 对接现有代码

- DumpProvider 复用 `session.ts` 的 `dumpLayoutRaw`+`flattenLayout`(需下沉到 `src/layout/`,改 DI 签名避免循环 import)。
- 模型/Merger/Locator 新增 `src/screen-model/`(纯函数为主,TDD)。
- Recorder 应用层录制(改 wrapper,扩构造签名波及 MCP+Web)。
- MCP:dump_ui 升级为返回 ScreenModel 渲染;新增/复用 record/replay;actionSchema 扩 locator 字段(zod passthrough/optional)。

## 7. 非目标(推迟 B)

selector id 跨 session 匹配(降为规范 app 增强);安全设计(用户决定全砍);页面脚本库/查库回放;Image/Ocr/Vision provider(MVP 仅 Dump);原生 findComponents RPC。

## 8. 待审风险

1. Merger 融合策略(bounds 重叠合并)在密集布局误合并/漏合并。
2. @eN 跨 snapshot 不稳定 → Claude 若缓存旧 ref 会操作错元素(须强制重 snapshot 规则)。
3. Locator 解析在无 text 无 id 的纯图标页失效(需 ImageProvider,MVP 靠坐标兜底)。
4. dump 延迟 2s/步对长流程累积慢。
5. role 从 type 推断不准(Stack+clickable→button?)。
