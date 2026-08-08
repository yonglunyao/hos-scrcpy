# SLAM 真机阻塞诊断 + 改进报告(fingerprint v2 + forceStop)

- **日期**: 2026-08-08
- **分支**: `fingerprint-click-fix`

## 诊断:列表项点击 = inline 展开(非 Explorer bug)

`diag-tap.js` 实测:tap "显示和亮度"(center {384,1451})后页面变化(els 111→118,anchors "声音和振动"→"显示和亮度"),**但仍为设置首页** —— inline 展开子项,非跳转到显示页。Explorer 判 `toggle` 正确。**鸿蒙设置列表为 inline 展开式,产不出 navigate 边。**

## 改进①:fingerprint v2(网速漂移解决)

- `normalizeDynamic` 增 SPEED 归一:正则 `/\d*\.?\d*\s*[KMGT]?i?[Bb]?\/s/g`(覆盖 B/s、K/s、KB/s、MB/s、KiB/s)。
- 升 `FINGERPRINT_VERSION` v1→v2(规范化规则变更,旧图失效)+ 更新阶段① fixture/断言。
- **效果**:状态栏网速 `B/s`↔`K/s` 归一为 SPEED → 设置首页 root fingerprint 稳定(探索产出 **1 节点** vs v1 的 3 漂移变体)。网速漂移根因解决。

## 改进②:forceStop 冷启动回 root

- `DevicePrimitives` 增 `forceStop(bundle)`;`mcp-device` 用 `aa force-stop`;`explorer.restartFromRootSense` 改 forceStop+launchApp(冷启动,绕开 launchApp 幂等不重置 toggle/inline 展开状态)。

## 真机结果(v2 + forceStop)

仍 `backtrack-failed` / **0 navigate**。两个残余问题:

1. **inline 点击**:设置列表点击展开非跳页 → 0 navigate 边(Navigator 无边可走)。
2. **设置启动 hash 不稳**:forceStop+launch 后 senseStable 仍 != root(疑设置冷启动恢复态 / 加载过渡未稳定)。

## 结论

- **代码改进有效**:v2 解决网速漂移(root 稳定);forceStop 提供冷启动回 root 机制(单测 266 全绿)。
- **鸿蒙设置 app 不适合 SLAM 探索验证**(inline 点击 + 启动状态不稳)。建议换跳页式只读 app(图库 / 文件管理 / 天气),或 frontier 偏好跳页入口(如"关于本机"进关于页)。

## 单测

266 全绿(含 v2 fixture 更新 + forceStop 接口)。build/lint/tsc 通过。
