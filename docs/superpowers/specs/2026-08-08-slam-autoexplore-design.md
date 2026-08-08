# app 自主探索建图(SLAM)设计

- **日期**: 2026-08-08
- **状态**: v2 — 经 4 位专家(架构/算法/鸿蒙实现/安全)评审修订,待用户 review
- **范围**: hos-scrcpy 智能自动化第二阶段 —— 自主探索 + 建图 + 导航 + 改版 diff
- **关联**:
  - MVP 地基(已交付):`2026-08-08-anchored-replay-design.md`、`plans/2026-08-08-screen-model-mvp.md`
  - 终态参考架构:`2026-08-08-screen-model-draft.md`
  - 真机数据:`spike/`
  - 边界 memory:`hos-scrcpy-input-text-limit.md`、`hos-scrcpy-daemon-input-conflict.md`

> **v2 修订要点**(相对 v1):① 范围分两层(MVP 只读/测试账号;真实 app 无人值守推后续);② 指纹算法补全(canonical 序列化、列表 multiset、anchors 算法、几何签名);③ 新增 ActExecutor 横切执行组件;④ 安全范式改白名单为主(FAIL-SAFE);⑤ 新增 DaemonWatchdog + 断点续探;⑥ 弹窗结构性检测 + 指纹前剥离;⑦ 数据模型加 fingerprintVersion/entryPoints/fallbackCoord,opType 扩类;⑧ 阶段顺序调整。

## 0. 方向演变

| 阶段 | 核心 | 状态 |
|---|---|---|
| v1.4 | 坐标录制/回放 | 已有,无脑回放 |
| MVP(第一阶段) | 屏幕模型 + text 定位 + @eN#sN + dump_ui/act/find | **已交付验证** |
| **第二阶段(本 spec)** | **自主探索建图(SLAM)+ 导航 + 改版 diff** | 设计中(v2) |

类比扫地机器人:边走边建图 → 自主规划路径 → 遇与存档不一致时,决策器判断是否更新地图。MVP 提供的 `dump_ui`/`act`/`find` 是 SLAM 的**感知 + 动作原语**,本阶段在其上构建认知层(地图)与决策层(探索/导航/决策器)。

## 1. 目标与范围分层

把"示教回放"升级为"机器自主探索建图、用图导航、感知改版"。**分两阶段交付**:

### 1.1 MVP(本阶段)—— 只读/浏览类 app + 测试账号

验证【指纹 + 建图 + 导航】命门。限定:
- **场景**:只读/浏览类 app(系统设置的查看页、图库、天气等),**禁入危险子树**(系统重置/账号/安全/支付)。
- **账号**:测试账号或无需登录 app。
- **安全范式**:白名单为主(FAIL-SAFE,见 §4.3)。只读场景提交语义控件极少,白名单天然成立。
- **不要求**:沙箱快照、操作审计、急停、提交语义人在环——这些在只读场景下风险极低,推后续。

### 1.2 后续阶段 —— 真实 app 无人值守

解锁真实 app(含登录态/支付/社交)无人值守时,**强制**补齐工程安全基线(§11.2)。

### 1.3 封闭世界假设(显式声明)

**本阶段假设:单次探索内,全局状态(登录/网络/夜间/权限)不变。** 这是 SLAM 类比成立的前提——app 全局状态变化会让同一页呈现不同控件,本阶段不建模该维度(推 §11.1)。Explorer 启动时记录状态标签(时间/网络/登录态)存入 PageGraph 元数据,标注地图适用条件;状态变化即视为"地图作废需重探"。

### 1.4 成功标准(MVP)

> 指纹阈值标 **"待阶段① spike 回填"** —— 在序列化/规范化规则未标定前不作承诺。

1. **指纹**三指标分别设阈(混同率阈值应远严于裂变率,因混同是静默污染):
   - 混同率(不同页同指纹):目标 ≤5%
   - 裂变率(同页多指纹):目标 ≤15%
   - 区分率(不同页不同指纹):目标 ≥95%
   - 按 app 类型分层(静态设置类 vs 动态电商类),不给单一阈值。
   - spike 须先定义"同页" ground truth(固定操作序列的起点终点 / 人标录像回看)。
2. **探索器**:只读 app 无人值守建出 PageGraph,已知可达控件覆盖率 ≥70%(定义见 §1.5)。
3. **决策器**:注入弹窗/改版 fixture,分类正确;不确定一律存疑。
4. **导航器**:给定目标页自主到达,落点核验一致率 ≥90%。
5. **diff**:新旧图对比报告新增/移除/改版。
6. **质量**:核心纯函数(指纹/规范化/图算法/决策分类)100% 单测。

### 1.5 覆盖率定义

`覆盖率 = visitedLocators / (totalLocators - filteredDangerous - sampledOut)`,按 Locator signature 去重;分项报告:已探索 / 危险未探索 / 抽样未探索 / 失败未探索。这是"已知可达控件覆盖率"的下界,非全 app 覆盖率。

## 2. 锁定决策

| 决策 | 选择 | 依据 |
|---|---|---|
| 用途 | 导航 + 覆盖探索 + 改版 diff | 用户多选 |
| 形态 | 全自动无人值守 + 规则决策器(存疑交 review) | 贴扫地机类比 |
| 状态粒度 | 页面骨架(粗):一页一节点,滚动/tab/弹窗为瞬态 | 抗状态爆炸 |
| **安全范式** | **白名单为主(FAIL-SAFE)+ 黑名单辅助** | 专家:黑名单够不着 41% 图标;默认不动才安全 |
| **MVP 范围** | **只读/浏览类 app + 测试账号** | 先验证命门;真实 app 风险推后续 |
| 危险操作 | MVP:白名单(只自动点导航/查看/展示类);真实app阶段:提交语义控件人在环 | §4.3 |
| 登录/状态 | 不做,未来扩展(§11.1) | 避开 input_text 边界 |

### 非目标(YAGNI,推迟)

全局状态建模、自动登录、完整业务弹窗分类、多 Provider(Image/Ocr/Vision)融合、多窗口/分屏、selector id 跨 session 匹配、危险操作自动回滚沙箱、真实账号无人值守安全基线(沙箱快照/操作审计/急停)——均推 §11。

## 3. 数据模型

```ts
// 复用 MVP:ScreenModel / Element / Locator / resolveLocator / @eN#sN

PageFingerprint {
  version: string;       // 规范化算法版本(如 "v1"),变规则必升版本;diff 前校验两侧一致
  skeletonHash: string;  // canonical 序列化骨架的 SHA-256
  anchors: string[];     // 稳定锚点控件 text(已做动态归一),辅助匹配
}

PageNode {
  id: string;            // = skeletonHash 派生
  fingerprint: PageFingerprint;
  skeletonArchive: NormalizedSkeleton;  // 规范化骨架(指纹中间产物),非全量 dump;脱敏
  rawDumpRef?: string;   // 原始 dump 仅调试模式存(外部,默认不入图)
  frontierExplored: Locator[];  // 已探索的 Locator(跨访问持久化,去重)
  frontierPending: Locator[];  // 待探索
  visitedAt: number;
}

Edge {
  from: string;
  locator: Locator;       // 探索期存的;导航时对新 dump 重新解析(见 ActExecutor)
  fallbackCoord?: {x,y};  // 纯图标/locator 解析失败时的坐标兜底
  to: string;             // 目标节点 id;to==from 表示页内状态变化
  opType: 'navigate' | 'toggle' | 'noop' | 'destructive' | 'external' | 'modal' | 'unknown';
  backNavigable: 'confirmed' | 'heuristic' | 'unknown';  // BACK 能否回源(图算法用,实测)
  effectReversible: boolean;  // 业务后果可逆(SafetyFilter 用,默认 false)
  verified: boolean;      // 落点核验是否通过;未通过降权
}

PageGraph {
  appBundle: string;
  appVersion: string;
  fingerprintVersion: string;        // 规范化算法版本(diff 前校验)
  stateLabel?: { ts?: number; network?: string; loggedIn?: boolean };  // 封闭世界假设标签
  nodes: Map<string, PageNode>;
  edges: Edge[];
  entryPoints: { id: string; label: string; origin: 'launcher'|'deeplink'|'notification' }[];
  rootId?: string;
}

NormalizedSkeleton  // canonical 序列化的输入(见 §4.1)
```

**节点身份 = skeletonHash**(粗粒度:一页一节点)。滚动/tab/弹窗不单独成节点;toggle/noop 自环边按 locator 去重(补计数),记录"页面内瞬态操作"但不裂变节点。

## 4. 组件设计(都建在 MVP 之上)

### 4.1 PageFingerprint(命门)

从 `ScreenModel` 提取稳定骨架 → 规范化 → canonical 序列化 → 哈希。两路线并用:

- **路线 A(主)结构骨架哈希**:可点控件树(text + type + 父子层级),规范化后哈希。
- **路线 B(辅)锚点集合**:稳定锚点控件 text 集合(标题栏/tab 栏/主导航),指纹漂移时二次确认。**anchor text 也做动态归一**(打破与路线 A 的循环依赖)。

#### 4.1.1 Canonical 序列化规范(钉死,保证图可比/diff 有效)

- 遍历:pre-order DFS;子节点按规范化后 text 字典序稳定排序。
- 字段顺序:字母序固定;未 set 的可选字段**不出现**(不写 null)。
- 编码:UTF-8 无 BOM、Unicode NFC、无尾换行。
- 结构:嵌套 S-expr 或带 depth 的定长格式(**不用 JSON**——key 顺序/空白/数字格式不确定)。
- 哈希输入加版本前缀 `v1:`,规范化规则变更必升版本,旧图不静默碰撞。

#### 4.1.2 规范化规则(五条)

| # | 类别 | 处理 | 示例 |
|---|---|---|---|
| 1 | 列表/信息流 | `List[type, countBucket, itemSigs-multiset]`:记容器类型 + 容量桶(1/2-5/6-20/21-100/100+)+ 项骨架哈希的 **multiset**(顺序无关) | 信息流顺序变也不影响 |
| 2 | 动态值归一 | NUM/TIME/PRICE/ID 正则粗筛 → 占位;**加时序一致性判据**:同位 text 跨 dump 值变而类型不变 = 动态列整列归一;值不变 = 静态保留 | "12 条"→"NUM 条";但"第2屏"(静态)不误伤 |
| 3 | 广告/推荐位 | 优先可识别标识(广告 SDK type/"广告"字样/已知 id);区域用**归一化坐标(0-1)+ 容器 type 双判**;**无条件剥离**(在场/不在场都剥),不"检测到才剥" | 轮播 banner |
| 4 | 稳定骨架保留 | 可点控件规范化后 text + type + 层级 | 导航/按钮/菜单 |
| 5 | checked-state 归一 | 开关旁"已开启/已关闭"、选中"✓"标记 → 占位 | 使 toggle 不污染指纹(opType 判定前提) |

> **为什么列表用 multiset 而非"前 N 项"**:动态列表(信息流/按时间排序)顺序本身是动态的,前 N 项每次不同 → 同页裂变。multiset 顺序无关 + 容量桶抗长度小幅变化;静态列表(设置菜单)顺序固定时 multiset 退化为有序,无信息损失。

#### 4.1.3 纯图标页(41% 无 text)—— 几何布局签名

text 缺失时,骨架退化为 type+层级,不同纯图标页可能撞哈希(假合并)。补**几何布局签名**:可点控件的相对位置网格(归一化坐标分桶),作为 text 缺失时的指纹维度。spike 标定纯图标页指纹稳定性。

#### 4.1.4 anchors 提取 + 匹配算法(补全,打破循环)

- **提取**:优先 type 标记(header/tabbar/navigation);fallback 归一化坐标(top/bottom 5% 带)+ 可点控件密度;多候选取跨 dump 最稳定的。anchor text 做动态归一。
- **匹配**:`anchor 集合 Jaccard 相似度` + `top1 与 top2 的 margin`。
- **处置表**:
  - skeletonHash 精确命中 → 确认同页。
  - miss 但 Jaccard ≥ T 且 margin ≥ Δ → 标"疑似已知页 P 的漂移",**软链接但不自动合并**,落点核验时作候选;软链接**不参与 Navigator 路径规划**(只读参考),除非人 review 转正。
  - 低于阈值 → 新页。

### 4.2 ActExecutor(横切执行原语)★ v2 新增

Explorer 与 Navigator **共用**的执行原语,封装 MVP 的 `act(ref)` 代际约束与核验:

```
actByLocator(locator, fallbackCoord?):
  dump_ui → ScreenModel(代际 N)
  稳定检测:连续两次 dump 指纹一致(或 debounce),过滤加载过渡态
  弹窗剥离:识别顶层遮罩/dialog,剥离后用底层页算指纹
  ref = find(locator) on 当前模型   // 拿到 @eN#sN(其中 sN=N)
  if ref 未找到:
    if fallbackCoord: tap(fallbackCoord) 标"坐标兜底"
    else: 抛 LocatorUnresolved
  act(ref)                          // 代际校验由 MVP 保证
  dump_ui → 指纹 → 返回 {落点指纹, 是否弹窗, ...}
```

- 解决 Navigator `act(edge.locator)` 与 MVP `act(ref)` API 不匹配:locator 必须对**新 dump** 重新解析。
- 内置稳定检测 + 弹窗剥离(Explorer/Navigator 都需要,不各自实现)。
- Locator 解析失败 → fallbackCoord 兜底,无兜底则抛异常(上游决定重试/中止)。

### 4.3 SafetyFilter(白名单为主,FAIL-SAFE)

挂在 ActExecutor 的 `act` 前。**范式反转:默认不动,显式证明安全才放行。**

- **白名单(主防线)**:只自动点证明安全的类——导航类(返回/主页/tab/菜单项)、查看类(展开折叠/详情/列表项)、纯展示类。白名单判定靠 opType 预判 + 控件 type/结构(不仅靠 text,覆盖图标)。
- **黑名单(辅助)**:危险 text/正则(支付/删除/退出/清空/拨号/发布...),命中即拦,记"危险未探索"。支持正则 + type/区域(右上角红色按钮)。
- **白名单外的一切控件,无论有无 text、黑名单是否命中,默认不自动点**(进存疑/人在环队列)。
- **MVP 只读场景**:提交语义控件本就少,白名单天然成立。**真实 app 阶段**:提交语义控件(确认/支付/发送/删除/保存/发布/开通/绑定)一律人在环。
- `Edge.effectReversible`(业务后果可逆,默认 false)与 `backNavigable`(页面能否 BACK 回源)分离;SafetyFilter 只认 effectReversible,不依赖 backNavigable。

> **为什么白名单为主**:spike 实证纯图标无 text 41%,黑名单 text 匹配够不着图标危险按钮(🗑 删除/✈ 发送)。FAIL-SAFE(默认不动)是自动化安全的基本范式。

### 4.4 Explorer(探索器,无人值守建图)

frontier-based,基于 ActExecutor:

```
load 已有图(若有)→ resume;else 从 root 开始
loop:
  (root 探索起步时记录 stateLabel,见 §1.3)
  指纹 = ActExecutor 当前页指纹(含弹窗剥离)
  节点 = 图中 skeletonHash 命中? 无则建节点(skeletonArchive 入库,脱敏)
  frontierPending = SafetyFilter 过滤后未探索的可点控件
  if frontierPending 非空:
    按优先级抽样(见 §4.4.1)选 locator
    {落点指纹, 弹窗} = ActExecutor.actByLocator(locator, fallbackCoord)
    判 opType(before/after 指纹 diff + 遮罩检测,见 §4.4.2)
    记边(from, locator, fallbackCoord, to, opType, backNavigable, effectReversible, verified)
    若 to 是新页 → 压栈,深度继续
    若 to==from(toggle/noop/modal)→ 记自环边(locator 去重+计数),继续本节点 frontier
  else:
    回溯:BACK → ActExecutor 强制核验落点指纹 == 预期父;不符 → 回 root 重规划(§4.4.3)
  增量落盘:每发现新节点 append(checkpoint)
  终止:连续 N 步无新页 / 总步数 / 时间 / 单节点 frontier 超 M 抽样
```

- **去重**:skeletonHash 命中已知节点不重复展开;Edge 级去重(同 from+locator 不重复 act)。
- **回溯核验**:每次 BACK 后强制 dump 核验(逻辑栈与系统返回栈会发散,不能盲信)。
- **增量落盘 + resume**:每新节点 append(JSONL/分块),中断后加载图从 root 重新定位已建节点续探。

#### 4.4.1 frontier 优先级抽样

超阈值 M 时按代价差异抽样(漏 navigate 边 = 漏一片子图,漏 noop 代价为 0,不等概率):
- 预期 opType:navigate > toggle > noop。
- text 关键词:"设置/更多/管理/查看" > "分享/点赞/收藏"。
- 结构层级:顶层 > 嵌套;同 Locator signature 的列表项只抽 1 代表。
- 抽样状态持久化在 PageNode.frontierExplored(跨访问复用,不重置)。

#### 4.4.2 opType 判定表(形式化)

基于 ActExecutor 返回的 before/after 指纹 diff + 结构信号:

| 条件 | opType |
|---|---|
| 指纹同(含 checked 归一后) | noop |
| 指纹变 + 锚点同 + 无遮罩 | toggle |
| 指纹变 + 锚点变 + 落点在本图 | navigate |
| 落点含全屏遮罩/dialog | modal |
| 落点跳出本 app(bundle 变) | external |
| 被 SafetyFilter 拦(不记执行边,记"危险未探索") | destructive |

#### 4.4.3 回 root 机制(BACK 不可靠时的兜底)

优先级链:① BACK(最多 N 次,每次 ActExecutor 核验);② 连续 2 次 BACK 未回已知节点 → `launch_app` 冷启动回 root(接受状态丢失 + 开屏广告处理);③ 判探索失败,落盘当前图,交 review。重规划设预算(最大次数/累计耗时),超限中止。

### 4.5 Navigator(导航器,用图)

```
输入: 目标(指纹 或 locator 描述)
规划: PageGraph 上 BFS(边权=1)+ visited set(同节点不二次入队)+ 路径上限 K 步
      // 软链接/verified=false 的边降权或排除
执行(逐步,用 ActExecutor):
  for edge in 路径:
    {落点指纹, 弹窗} = ActExecutor.actByLocator(edge.locator, edge.fallbackCoord)
    if 弹窗: DecisionEngine 处理(关弹窗走白名单)→ 重验落点 → continue
    if 落点指纹 == edge.to: continue
    else:
      重验 N 次(防 dump 抖动)→ 仍不符 → DecisionEngine 分类:
        动态噪声 → 视为一致继续
        改版 → 回退上一已知正确节点,标该边 verified=false,重新规划
      连续 M 条边不可用 → 中止该导航,交 review
到达目标 → 成功
```

- BFS(非 Dijkstra,边权=1,简单可靠);若需 Dijkstra 先定义边权模型。
- 落点核验是导航鲁棒性关键;落点失败控制流闭合(重验→分类→回退标边→重规划→连续失败中止)。

### 4.6 DecisionEngine(决策器,不一致分类)

ActExecutor 检测到弹窗,或 Navigator 落点≠预期时,四分类:

| 实际情况 | 识别信号(结构性优先,不靠 text) | 处置 | 更新图 |
|---|---|---|---|
| 弹窗/广告(临时) | 顶层 dialog/sheet/popup type + 全屏半透明遮罩(归一化坐标覆盖视口且 clickable 透明层) | 关弹窗(**关的动作走 SafetyFilter 白名单**,只点 text 明确"关闭/取消/我知道了/×"且 dialog 类按钮)→ 重验落点 | 否 |
| 动态内容(噪声) | skeletonHash 同(规范化已吸收) | 视为一致 | 否 |
| 局部改版 | skeletonHash 不同但 anchors 高重叠 | 标记存疑,交 review | 暂不自动 |
| 整体改版 | 锚点都变、skeletonHash 大变 | 标记存疑,中止该路径,交 review | 暂不自动 |

- **业务弹窗**(支付确认/实名/人脸/转账确认)本阶段不自动处置(只读 MVP 鲜见),归"存疑交 review";完整分类推后续。
- **存疑触发该节点 frontier 冻结**(只允许 BACK 回溯,不允许新 act)+ 通知人 review;存疑节点不计入覆盖率。
- 原则:规则决策器只处理高置信情形;不确定一律存疑,绝不静默误更新地图。

### 4.7 DaemonWatchdog ★ v2 新增

无人值守期间 act 卡死的大概率事件(memory:daemon 单例被投屏占用致 act 挂起 >120s)需自动恢复:

- 每次 act 前查 `@uitest_socket` 存在性(`run_shell` 查 `/proc/net/unix`);不存在 → 自动执行 memory 恢复流程(kill daemon + reconnect)→ 重试。
- act 超时从 120s 降到 10-15s(正常响应 <1s),快速触发看门狗。
- 探索启动 pre-flight check:确认 daemon 独占 + socket 存在,否则拒绝启动。

### 4.8 MapStore(存储/归档/diff)

- PageGraph 持久化,按 `appBundle + appVersion` 归档;**增量 append**(新节点追加,write-to-temp + rename 原子替换)。
- **skeletonArchive 存规范化骨架**(指纹中间产物,已裁剪动态内容),**不存全量 dump**(隐私 + 规模 + ts 污染)。原始 dump 仅调试模式外部存。
- **脱敏**:skeletonArchive 入库前正则抹手机号/身份证/银行卡/金额/验证码;地图文件默认强制写入 `.gitignore`。
- **diff**:先按 skeletonHash 精确匹配,未命中的用 anchors 二次模糊匹配(命中标"改版"而非"移除+新增");diff 前校验两侧 fingerprintVersion 一致,不一致拒绝(或用旧版算法重算)。dumpArchive/ts 不参与结构 diff。
- 图结构(轻)与 archive(重)可分文件,加载按需读。

## 5. 数据流总览

**探索**:`dump_ui` → ActExecutor(稳定检测+弹窗剥离)→ 指纹 →(图已知?)→ Explorer 选 frontier → SafetyFilter → ActExecutor.actByLocator → 指纹 → 判 opType → 记边 → BACK 核验回溯 → 增量落盘 → 循环。

**导航**:目标 → BFS(+visited)→ 逐步 ActExecutor(dump→find→act→核验)→ 一致继续 / 弹窗 DecisionEngine 关 / 不一致 DecisionEngine 分类 → 到达。

**diff**:新旧 MapStore 图对比(skeletonHash + anchors 二次匹配)→ 改版报告。

## 6. 降级与错误处理

| 情形 | 处理 |
|---|---|
| dump 失败/超时 | 重试 N 次 → 跳过该步 / 坐标兜底 |
| act 无响应 | DaemonWatchdog:缩短超时→查 socket→自动恢复→重试;持续失败中止 |
| Locator 解析失败 | Edge.fallbackCoord 坐标兜底;无兜底抛 LocatorUnresolved(上游重试/中止) |
| SafetyFilter 拦截 | 跳过,记"危险未探索",不中止 |
| 决策器不确定 | 存疑交 review,冻结该节点 frontier,不自动改图 |
| 连续 N 步无新页 | 探索终止(覆盖饱和) |
| 单节点可点控件爆炸 | 优先级抽样(§4.4.1),记 sampledOut |
| BACK 回溯失灵 | ActExecutor 核验→冷启动回 root→判失败(§4.4.3) |
| **探索中断** | 增量落盘已保留部分图;resume 从 root 重新定位已建节点续探 |
| daemon 被占 | DaemonWatchdog 自动恢复(§4.7) |

## 7. 测试与验证

**单测(纯函数,100%)**:
- `PageFingerprint`:canonical 序列化稳定性(同输入同字节串)、规范化五规则(列表 multiset/动态归一时序/广告无条件剥/checked 归一/几何签名)、anchors 提取+Jaccard 匹配+处置表、纯图标页几何签名。
- `SafetyFilter`:白名单放行、黑名单命中、白名单外默认拦。
- `ActExecutor`:稳定检测、弹窗剥离、locator→ref 解析、fallbackCoord 兜底(用录制的 dump 序列 fixture 驱动,不依赖真机)。
- `Explorer`:frontier 优先级抽样、去重、BACK 核验、增量落盘/resume、终止条件。
- `Navigator`:BFS+visited、落点核验、不一致闭合控制流。
- `DecisionEngine`:四分类、关弹窗走白名单、存疑冻结。
- `MapStore`:序列化/增量 append/原子性/diff(skeletonHash+anchors 二次匹配)/fingerprintVersion 校验。

**真机(spike + 端到端)**:
- **阶段① spike(先于实现,回填 §1.4 阈值)**:指纹稳定性/区分性(定义同页 ground truth)、type 字段对容器类型识别覆盖率、规范化规则正则、几何签名稳定性、白名单/黑名单初值。
- 验证场景:系统设置的**只读查看页**(显示/声音/关于手机),显式禁入危险子树(系统重置/账号/安全)。
- 端到端:无人值守扫只读 app 建图 → 导航到目标 → 注入弹窗验证绕过 → 改版 diff。

## 8. 风险

1. **指纹稳定性是整个系统的前置假设**(未证):探索完备性/覆盖率/opType 判定都依赖它。阶段① spike 必须先验证,不达标则覆盖率/完备性指标无效。Explorer 加"指纹漂移探针"(同物理页多 dump 统计一致率)实时上报。
2. **纯图标页 41% 盲区**:指纹几何签名 + Edge.fallbackCoord 缓解;spike 标定几何签名稳定性;覆盖率按页面类型分层。
3. **状态爆炸**:粗粒度 + 优先级抽样 + 覆盖率终止;接受"部分覆盖"。
4. **dump 延迟 ~2s/步**:中等 app 数百步 = 十几分钟到小时级。增量落盘 + resume 缓解中断;量化预期时长供判断。
5. **daemon 单例冲突**:DaemonWatchdog 自动恢复。
6. **BACK 回溯不可靠**:ActExecutor 核验 + 冷启动回 root + 重规划预算。
7. **决策器误分类**:不确定一律存疑交 review;关弹窗走白名单防点到真实功能按钮。
8. **MVP 只读假设被破坏**(误入含提交语义的只读页):白名单默认不动兜底;真实 app 风险推后续阶段强制安全基线。

## 9. MVP 分阶段(每阶段独立可验证)

| 阶段 | 交付 | 验证 |
|---|---|---|
| **① 指纹 + 图存储 + spike** | spike 回填阈值 → PageFingerprint(canonical 序列化+五规则+几何签名+anchors)+ PageGraph + MapStore | 同页多 dump 指纹一致、不同页不同、列表/纯图标稳定;只读 app 手动 dump 建出图骨架 |
| **② 决策器(最小版)** | DecisionEngine 弹窗结构性检测 + 指纹前剥离(ActExecutor 内)+ 四分类雏形 | 注入弹窗 fixture,检测+剥离正确 |
| **③ 探索器** | ActExecutor + Explorer(frontier 优先级抽样 + BACK 核验 + 增量落盘/resume + SafetyFilter 白名单)+ DaemonWatchdog | 无人值守扫只读 app,产出覆盖率 + 完整图 |
| **④ 导航器** | Navigator(BFS+visited + 落点核验 + 不一致闭合控制流) | 给目标自主到达,遇弹窗绕过 |
| **⑤ diff** | 新旧图对比(skeletonHash+anchors)+ 改版报告 | 版本变化 diff 出新增/移除/改版 |

> 顺序:① → ②(最小弹窗检测,③依赖)→ ③ → ④ → ⑤。ActExecutor 在③随 Explorer 引入,④复用。

## 10. 与 MVP 地基的对接

| 本阶段组件 | 依赖 MVP |
|---|---|
| PageFingerprint | `ScreenModel`、`Element`、`associateText` |
| ActExecutor | `dump_ui`、`act(@eN#sN)`、`find(Locator)`、`resolveLocator`、`tap(x,y)`(fallbackCoord) |
| Edge.locator | MVP `Locator`(text/hint/within/index/enabled)+ 新增 fallbackCoord |
| SafetyFilter | ActExecutor 内 `act` 前置拦截 |

@eN#sN 代际校验继续保障 act 安全(过期 ref 拒绝);ActExecutor 封装"每次 dump→find→act"使代际约束对 Explorer/Navigator 透明。

## 11. 未来扩展(不做,仅记设计)

### 11.1 全局状态维度 + 自动登录

app 同一页在不同全局状态(登录/夜间/网络/权限/VIP)下观感不同——app-SLAM 比物理 SLAM 多的维度。接入:
- `PageNode` 增 `stateReqs?`、`Edge` 增 `stateEffect?`(状态位可插拔)、`GlobalStateProbe`(从 dump 推断状态位)。
- Navigator 路径规划纳入状态前置;DecisionEngine 把状态引起的变化判为预期(非改版)。
- **登录自动化**:`CredentialStore`(加密,绝不进仓库)+ `LoginExecutor` 多策略(token_inject > ui_form > pre_authenticated);前置依赖=根治 [[hos-scrcpy-input-text-limit]](文本输入可插拔:input_text → 输入法逐字 → 剪贴板)。

### 11.2 真实 app 无人值守安全基线(解锁真实 app 时强制)

- **沙箱账号强制**:无人值守只允许测试/沙箱账号,真账号人在环。
- **探索前快照**:记录余额/绑定/安全开关,探索后 diff 异常即停。
- **操作审计**:每次 act 记 {ts, ref, locator, bounds, act 前后 dump hash},哈希链防篡改。
- **kill switch / 心跳**:超 N 秒未续期立即停并回 root。
- **费用/发送类硬熔断**:支付/短信/电话零阈值,命中即停。
- **提交语义控件人在环**:确认/支付/发送/删除/发布/开通/绑定 一律不自动点。
- **敏感 app 黑名单 + 速率限制**(防风控)+ **完整业务弹窗分类**(支付确认/实名/人脸独立类)。

### 11.3 其他

多 Provider(Image/Ocr/Vision)融合、多窗口/分屏、地图合并(多入口/多设备,节点按 skeletonHash 幂等合并)、探索并发。
