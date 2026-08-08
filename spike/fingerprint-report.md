# 指纹 spike 报告(现有真机 dump 数据)

> Task 10 交付物。数据源:`spike/*.json`(之前 MVP 录的真机 dumpLayout,1920×2880)。
> **不连真机**:只用现有 8 个 dump。报告严格区分"已测"vs"需真机补"。
> 指纹版本 `v1`,跑 `node spike/fingerprint-spike.js` 复现。

## 0. 样本说明

| 文件 | 来源 app | 元素 | clickable | hash(前16) |
|---|---|---|---|---|
| set-1 / set-2 | 鸿蒙设置 | 129 | 52 | `7cbf94d7f5fb65c2`(同) |
| tb-1 | 淘宝 | 149 | 58 | `b551766c8344cea4` |
| tb-2 / tb-3 | 淘宝 | 149 | 58 | `eb8ba5e2d08f8787`(同) |
| pg-1 / pg-2 / pg-3 | 某社交 app(消息页) | 142 | 43 | `5128111f4dd5e21f`(同) |

8 个 dump 实际只对应 **4 个不同页面**(set 首页、淘宝页 A=tb-1、淘宝页 B=tb-2/3、pg 消息页)。MD5 全不同(非字节复制),是真实独立 dump。

## 1. 区分性 — PASS

4 个不同页面产出 4 个不同 hash,**区分率 4/4 = 100%**(spec §1.4 目标 ≥95%)。
- 跨 app 的 anchors Jaccard:set↔tb=0.188、set↔pg=0.231、tb↔pg=0.150 —— 不同页 anchors 重叠很低,区分力强。
- 无混同(不同页同指纹)案例。

## 2. 同页稳定性 — 部分测得

| 组 | dump 间 | hash | 结论 |
|---|---|---|---|
| set | set-1 vs set-2 | SAME | 同页同指纹,稳定 ✓ |
| pg | pg-1/2/3 两两 | SAME | 3 次 dump 全同,稳定 ✓ |
| tb | tb-2 vs tb-3 | SAME | 稳定 ✓ |
| **tb** | **tb-1 vs tb-2/3** | **DIFF** | **疑似漂移**(见 §3) |

**已测**:set / pg / tb 的"同状态多次 dump"完美稳定(裂变率 0%)。
**局限**:这些都是**同一静止状态**的重复 dump(可能是录同一瞬或快速连录),未覆盖"滚动/tab 切换后回同页"这一真实裂变诱因。spec §1.4 的 ≤15% 裂变率目标**需真机补**:同页滚动后回弹、tab 切换回切的多次 dump。

## 3. 漂移案例(tb-1 vs tb-2)— 关键发现

`tb-1` 与 `tb-2`:**skeleton hash 不同,但 anchors 完全相同(Jaccard=1.0)**。
- anchors:`[关注, 推荐, 闪购, 国补, 穿搭, 飞猪, 超级NUM, 居家, ...]`(顶部 tab 栏,17 个全一致)
- 元素数/类型分布完全一致(149 元素,Text:81 Stack:46 ...),仅个别 text 内容差异(信息流动态内容)→ 哈希漂移

这正是 spec §4 设计的两级匹配(精确 hash + anchors Jaccard 兜底)的**目标场景**:
- 纯 hash 匹配会把 tb-2 误判为"新页" → 裂变;
- anchors Jaccard=1.0 ≥ DRIFT_T → `classifyMatch` 标 `'drift'`(疑似已知页漂移),软链接待核验,**不自动合并、不参与路径规划**。

**算法行为符合 spec 设计**。是否真为"同页"需人标确认(看像是淘宝首页同一屏的不同推荐内容)。

## 4. type 字段识别能力 — 基本可用,Swiper 有缺口

规则①列表容器识别(`scrollable OR /list|waterflow|grid/i`):

| 页 | 出现的容器 type | scrollable | 命中容器数 |
|---|---|---|---|
| set | `List:1` | 3 | 3 ✓ |
| tb | `Swiper:1 WaterFlow:1 List:1 Scroll:1` | 4 | 4(WaterFlow/List/Scroll 命中,**Swiper 未命中**) |
| pg | `WaterFlow:1` | 2 | 2 ✓ |

**结论**:`List` / `WaterFlow` 在真机 dump 中真实存在,规则①正则能命中。**`Swiper`(轮播)此前未被 `/list|waterflow|grid/` 覆盖** —— Swiper 内的子项不会被归一化进列表 multiset。

> **已修复(2026-08-08)**:生产正则改为 `/list|waterflow|grid|swiper/i`(`normalize.ts`),Swiper 现按容器处理,其子项进 `ListSummary.itemSigs`(被裁剪,不进 nodes),由 `normalize.test.ts` 单测覆盖。注:本 spike 脚本的 `listContainers` 诊断计数仍用旧正则(冻结的诊断口径,不改),故表中 `listCt` 数字不变;生产逻辑以 `normalize.ts` 为准。

## 5. 纯图标占比(几何签名必要性)— 17%,低于 spec 引用的 41%

| 页 | 纯图标 clickable / 总 clickable |
|---|---|
| set | 7/52 = 13% |
| tb | 14/58 = **24%** |
| pg | 5/43 = 12% |
| **合计** | **71/407 = 17.4%** |

spec §2 引用"黑名单够不着 41% 图标"作为几何签名动机。本批数据纯图标占比 **17.4%**(电商类 tb 最高 24%)。占比低于 41% 的可能原因:本批页面(设置/消息/淘宝首页)文本较密集;41% 可能来自含更多纯图标入口的页面(启动器/拨号盘/工具栏)。**几何签名仍有必要**(tb 24% 不可忽视),但触发面比预期小。**需真机补**:启动器/拨号/纯图标工具栏页,验证几何签名在纯图标页的稳定性。

## 6. anchors 质量 — 状态栏噪声已清洗(49% → 13%)

### 清洗前(spike 原始发现)

111 个 anchors 中 **54 个(49%)是状态栏噪声**(`NUM`/`:`/`K/s`/电量/时间归一化后的碎片)。
- set anchors:`[设置, 钱包和支付, 关于本机, NUM, :, NUM, NUM, K/s]` —— 前 3 个是有效标题,后 6 个是顶部状态栏(信号/时间/网速)掉进顶 5% 带。
- pg anchors 含乱码(`뉭 뉯 눍 눼` —— 图标字体字形被误识为文本)。

**原因**:`ANCHOR_BAND=5%` × h=2880 → 顶 144px 正好罩住状态栏。

### 清洗后(已实施,2026-08-08 复测)

`extractAnchors` 归一后新增 `hasSemanticContent` 过滤:剥离 `NUM`/`TIME`/`DATE` 占位 token 与数字/符号后,若不剩任何 Unicode 字母/汉字则视为状态栏噪声丢弃(注意 `NUM`/`TIME` 本身是 Latin 字母组成的占位,不能仅用 `\p{L}` 判断,必须先剥离占位 token)。

| 页 | anchors 清洗前 → 后 | 滤掉的噪声 |
|---|---|---|
| set | `[设置, 钱包和支付, 关于本机, NUM, :, NUM, NUM, K/s, +1]`(9)→ `[设置, 钱包和支付, 关于本机, K/s]`(4) | NUM×3、`:`、+1 占位 |
| tb | 17 → 11(顶部 tab 栏全语义词,含 `超级NUM` CJK+占位混合保留) | NUM/符号占位×6 |
| pg | `[消息, (NUM), 뉭, 清除未读, 눼, 뉯, 눍, NUM, +6]`(14)→ `[消息, 뉭, 清除未读, 눼, 뉯, 눍, K/s]`(7) | `(NUM)`、`NUM`、+若干占位 |
| **合计** | **111 → 62** | **状态栏噪声 54(49%)→ 8(13%)** |

> 残余 13%:主要是 `K/s`(网速,剥离符号后剩单字母 `K`,被判语义词保留)与 pg 的 Hangul jamo(`뉭` 等,图标字体字形被误识为文本,属另一类噪声,不在本次清洗范围)。

**区分力提升(清洗的正面副作用)**:跨页 anchors Jaccard 因去除了各页高度同质化的 NUM/`:` 噪声而**全面下降**,区分力增强:

| 页对 | 清洗前 Jaccard | 清洗后 Jaccard |
|---|---|---|
| set↔tb | 0.188 | **0.071** |
| set↔pg | 0.231 | **0.100** |
| tb↔pg | 0.150 | **0.059** |

隔离带由 0.23↔1.0 扩展到约 0.10↔1.0,`DRIFT_T=0.6` 阈值更安全。同组稳定性(hash SAME、anchors Jaccard=1.0)不受影响——清洗是确定性的,同页重复 dump 仍产出相同 anchors。

## 7. 阈值建议

| 阈值 | 当前值 | 数据支撑 | 建议 |
|---|---|---|---|
| `DRIFT_T`(Jaccard) | 0.6 | 同页/漂移 Jaccard=1.0;跨页 Jaccard=0.15-0.23。0.6 居中,距两边各 ≥2.6×/≥0.37 | **维持 0.6**。分隔带清晰(0.23 ↔ 1.0),无样本落入灰区 |
| `DRIFT_DELTA`(margin) | 0.2 | margin = top1 与 top2 anchors Jaccard 差。仅 4 页,样本不足;唯一漂移案例(tb-1 vs tb-2)的 top1 Jaccard=1.0 远超任何跨页候选(≤0.23),margin 远 >0.2 | **维持 0.2 作初值**。精确标定**需真机**:扩到 ≥20 页后看 top1-top2 分布 |
| `anchorThreshold`(diffGraphs) | 0.6 | 同 DRIFT_T 依据 | **维持 0.6**(diff 用同源依据) |

**回填结论**:`fingerprint.ts` 的 `DRIFT_T=0.6` / `DRIFT_DELTA=0.2` 与 `diffGraphs` 默认 `anchorThreshold=0.6` **保留不变**——本批数据显示在 0.23 与 1.0 之间存在宽隔离带,当前阈值落在安全侧。spec §1.4 的混同/裂变/区分率**正式标定延后**(样本仅 4 页,统计功效不足)。

## 8. 明确待真机补(不连真机无法测)

1. **同页滚动/tab 切换裂变率**:现有 dump 都是静止同状态重复,未覆盖"信息流滚动 N 屏后回顶部""tab 切走再切回"。spec §1.4 ≤15% 裂变率目标的核心测量项。
2. **更多不同页(扩到 ≥20 页)**:现仅 4 页,混同率/区分率的统计功效不足,margin(top1-top2)分布无法标定。
3. **动态列表滚动指纹稳定性**:multiset+容量桶归一(规则①)在真实长列表滚动下是否扛住,需连真机滚动同一列表录多 dump。
4. **纯图标页几何签名稳定性**:需录启动器/拨号盘/纯图标工具栏(本批最低 12%,不足)。
5. **状态栏噪声清洗效果验证**:实现 anchors 清洗后,真机重测区分力是否进一步提升。

## 9. 结论

- 指纹 v1 算法在现有 4 页真机数据上**区分性 100%、静止同页稳定性 100%**,核心机制(hash + anchors Jaccard 兜底)在 tb-1/tb-2 漂移案例上**行为符合 spec 设计**。
- 阈值 `DRIFT_T=0.6` / `DRIFT_DELTA=0.2` / `anchorThreshold=0.6` **维持现状**,数据支撑充足(隔离带 0.23↔1.0)。
- 原发现的两项待改进项**已修复(2026-08-08)**:① anchors 状态栏噪声 49%→13%(`extractAnchors` 加 `hasSemanticContent` 清洗,跨页 Jaccard 进一步降至 0.06-0.10,区分力增强);② Swiper 轮播容器纳入规则①正则(`/list|waterflow|grid|swiper/i`),子项不再错误进入 nodes。两项均由 `test/unit/page-graph/` 单测覆盖。
- spec §1.4 正式阈值标定**延后到真机阶段**(需 ≥20 页 + 同页滚动 dump)。

## 复现

```
npm run build
node spike/fingerprint-spike.js
```
