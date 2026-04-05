# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - 2026-04-05

### 新增功能 (Added)

#### 编程式 API
新增 5 个编程式 API 方法，支持事件驱动的设备投屏管理：

- **`startDevice(sn: string)`** - 编程式启动设备投屏，无需 WebSocket 客户端触发
- **`stopDevice(sn: string)`** - 停止指定设备投屏
- **`stopAll()`** - 停止所有设备投屏
- **`isCasting(sn: string): boolean`** - 检查设备是否正在投屏
- **`getPort(): number`** - 获取实际监听端口（支持动态端口分配）

#### HTTP 端点
- **`GET /api/status[?sn=xxx]`** - 查询投屏状态
  - 带参数查询指定设备状态
  - 不带参数返回所有设备状态
- **`GET /webview/*`** - 静态文件服务（用于插件 webview）

#### 行为改进
- **动态端口分配**：支持 `port: 0`，由 OS 分配可用端口
- **持久化投屏**：通过 `startDevice()` 启动的设备，即使无 WS 客户端也保持流活跃
- **late-join 客户端支持**：后连接的 WS 客户端能正确接收 `screenConfig` 消息

#### 文档
- 新增 `README.md` - 项目说明文档
- 新增 `CHANGELOG.md` - 版本变更记录
- 新增 `docs/integration-tests.md` - 集成测试文档
- 新增 `docs/resource-exhaustion-analysis.md` - 资源耗尽问题分析
- 更新 `docs/sdk-api.md` - 添加编程式 API 文档和 7 个集成案例

#### 测试
- 新增 `test/api-verification.ts` - API 验证脚本
- 新增 `test/integration/server-api.test.ts` - 17 个编程式 API 直接测试
- 新增 `test/integration/programmatic-api.test.ts` - 8 个 HTTP API 测试
- 总计 **36 个集成测试用例**

#### 构建
- 新增 `npm run pack` 命令，输出到 `package/` 目录

### Bug 修复
- 修复 WS 客户端在流就绪后连接时收不到 `screenConfig` 消息的问题

## [1.0.0] - 2026-03-XX

### 初始发布
- 完整的 HarmonyOS 投屏服务器实现
- WebSocket 协议兼容 `demoWithoutRecord.jar`
- HTTP/2 gRPC 视频流接收
- 触摸、键盘、鼠标输入控制
- 122 个单元测试 + 11 个集成测试

