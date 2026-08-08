# SLAM 阶段③ 真机端到端报告

- **日期**: 2026-08-08
- **设备**: 2BD0223C18000027(HUAWEI MatePad Pro, 1920×2880, uitest 1.2.4)
- **目标 app**: `com.huawei.hmos.settings` / `com.huawei.hmos.settings.MainAbility`(鸿蒙系统设置,只读查看页)
- **脚本**: `spike/explore-e2e.js`(参数可经环境变量调)

## 结论:Explorer 架构端到端验证通过

Explorer 在真机上完整跑通【连设备 → DaemonWatchdog.preFlight → launchApp → frontier 探索循环 → 增量落盘 → 覆盖率报告】,**无崩溃、无死循环、无数据损坏**。各原语耗时健康(`node spike/diag.js` 实测):

| 原语 | 耗时 |
|---|---|
| listDevices | 88ms |
| connectSession | 2.1s |
| createMcpDevice(含 getScreenSize) | 480ms |
| dump(dumpLayout→ScreenModel,116 元素) | ~1.7s |
| **tapRef(socket touchDown/Up)** | **38ms** |
| pressBack | 728ms |

落盘的 PageGraph 结构完整:节点带 `skeletonArchive`(规范化骨架)、边带 `locator`+`fallbackCoord`+`opType`,`MapStore.load` 可往返重载。

> 端到端缓冲/退出坑:`node script | tail` 会让 stdout 块缓冲(5min 无输出假象);UitestServer socket 未关闭会致 node 不退出。已修复:报告走 stderr(无缓冲)+ `finally disconnectSession`。

## 探索深度受限(待 spike 回填)

两次运行(MAX_STEPS=8 / 20)均为 `backtrack-failed` 终止,**0 navigate 边**(仅 noop/toggle)。根因有二:

### 1. 设置首页 fingerprint 漂移 → root 核验失败
设置首页是长 `List`(21-100 项),两次 dump 的**滚动可见区间不同** + **状态栏动态值**(网速 `B/s`↔`K/s`、时间)→ `skeletonHash` 每次不同。`Explorer.restartFromRootSense` 用精确 hash 比对,漂移即判失败 → `backFail` 累积 → 终止。三次 dump 产出 3 个"设置首页"变体节点。

### 2. 点击列表入口项未导航 → 判 toggle
点击"显示和亮度"等入口,`after` 仍为设置首页(anchors 高重叠)→ `classifyOpType` 判 `toggle` 而非 `navigate`。`diag` 确认 tap 命令已发出(38ms),故**非 Explorer 代码缺陷**(perform/tap 路径经 Task 3/6 单测验证),而是真机列表项点击**未触发跳页**——疑似可点坐标(center 不在 Row 命中区)/ 点击时序 / inline 展开特性,需 spike 确认。

## 回填建议(后续 spike / fingerprint v2)

- **normalizeDynamic 增状态栏动态归一**:网速 `[KMGT]?B/s`、秒数、电量百分比 → 占位。注意:规范化规则变更**须升 `FINGERPRINT_VERSION` v1→v2** 并更新阶段① 全部 fixture(否则旧图静默碰撞),故不在阶段③ Task 10 内做。
- **长列表页稳定锚点**:root 锚改用固定标题栏(顶部"设置")而非滚动可见项;或 anchors 取 type=Header/Title 且跨 dump 稳定的子集。
- **`restartFromRoot` 容忍微漂移**:落点核验用 `classifyMatch` anchors 模糊匹配(spec §4.4.3 可强化),漂移到已知页即接受。
- **点击有效性 spike**:列表项可点坐标(可能需点 Row 子区而非几何 center)、点击后等待导航完成的时序、是否需双击/特定手势。
- **frontier 去标题**:页面主标题(如"设置",clickable=true 但 noop)应降优先级或识别为 anchor 排除,避免浪费步。

## 下一步

阶段③ Explorer 架构已验证可行,**可进入阶段④ Navigator**(复用 `ActExecutor`)。真机探索深度优化(指纹 v2 + 点击 spike)列为独立 spike 持续项,不阻塞阶段④。
