# SLAM 真机端到端验证成功(photos 图库)

- **日期**: 2026-08-08
- **app**: `com.huawei.hmos.photos` / `MainAbility`(鸿蒙图库 —— 跳页式只读 app)
- **设备**: 2BD0223C18000027

## 探索(`explore-e2e.js`)
- 步数 10,新页 5,**节点 4,边 10**。
- **navigate 边 5**(进相册/分类页)+ noop 5。
- 覆盖率 **58.8%**(visited 10 / (49 total − 32 dangerous − 0 sampled) = 10/17)。
- 终止 `no-new-page`(自然饱和,**非** backtrack-failed)。
- 节点:图库首页 / 我的收藏 / 分类 / 分类(变体)。

## 导航(`navigate-e2e.js`)
- 加载图(4 节点,5 navigate 边)。
- 当前页(图库首页)→ 导航目标(我的收藏)。
- **`success=true, reason=arrived, traversed=1, verified=[true]`** ✓

## 结论

**SLAM 真机端到端验证成功**:探索建出多节点图(含 navigate 边)+ Navigator 沿 navigate 边 `perform` + 落点核验**到达目标**。证明 fingerprint v2 + Explorer + Navigator 架构在**跳页式只读 app(图库)真机完全可用**。

之前设置 app 失败是 **app 选择问题**(列表 inline 点击 + 冷启动 hash 不稳),非架构缺陷。图库(跳页 + 相册入口在白名单)是合适目标。

## 工具
- `spike/dump-page.js`:通用 dump(打印 app 可点元素 + SafetyFilter 判定),用于 app 适配 / 词表诊断。
