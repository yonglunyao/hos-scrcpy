# Changelog

All notable changes to this project will be documented in this file.

## [1.2.0] - 2026-04-06

### 新增功能 (Added)

#### 录屏和截屏功能
- **截屏功能**: 一键捕获当前视频帧并保存为 PNG 图片
  - 使用 Canvas API 绘制视频帧
  - 自动下载到本地，文件名包含设备名和时间戳
  - 格式: `screenshot_{设备SN}_{时间戳}.png`

- **录屏功能**: 实时录制视频流
  - 使用 MediaRecorder API 捕获视频流
  - 支持 VP9/VP8/WebM 格式（自动选择浏览器支持的最佳格式）
  - 输出格式: WebM
  - 实时显示录制时长在按钮上
  - 自动下载，文件名包含设备名、时间戳和时长
  - 格式: `recording_{设备SN}_{时间戳}_{分秒}.webm`

#### UI 改进
- 新增"录屏截屏"控制面板
- 录屏中按钮变红色，显示 `⏹ 停止 (MM:SS)`
- 投屏停止时自动停止录屏并禁用按钮

### 技术实现
- 截屏: `canvas.toBlob()` 转换为 PNG
- 录屏: `video.captureStream()` + `MediaRecorder`
- 浏览器兼容性检测和降级处理

## [1.1.2] - 2026-04-06

## [1.1.2] - 2026-04-06

### 新增功能 (Added)

#### Web 界面帧率显示
- 实时帧率 (FPS) 显示，位于状态面板中
- 每秒自动计算并更新视频帧率
- 停止投屏时正确重置帧率显示
- 重新开始投屏时自动重新计算

### 代码质量优化 (Improved)

#### 结构化日志
- 新增 `src/shared/logger.ts` 基于 pino 的日志模块
- 开发环境使用 pino-pretty 美化输出
- 生产环境使用 JSON 格式日志
- 支持子日志创建（带组件上下文）
- 日志级别可通过 LOG_LEVEL 环境变量配置

#### WebSocket 消息类型安全
- 新增 `WsMessage` 和 `WsMessageData` 接口
- 完整的消息类型验证（screen/uitest/touchEvent/keyCode/stop）
- 错误响应发送给客户端

#### 资源管理优化
- 使用 WeakMap 管理 WebSocket 关联的 interval
- 防止内存泄漏，自动垃圾回收
- 停止投屏时正确清理所有定时器

#### 代码规范化
- 超时参数常量化（SCREENSHOT_TIMEOUT_SEC、WAKEUP_TIMEOUT_SEC 等）
- 统一使用常量替代硬编码值
- ESLint 配置优化（.eslintrc.json）

### Bug 修复 (Fixed)
- 修复 ServerHelper 类型未导出问题
- 修复 logger.error() 参数格式问题
- 修复 ESLint 未使用变量警告

### 依赖更新 (Dependencies)
- 新增 pino 和 pino-pretty 日志库

## [1.1.1] - 2026-04-05

### 新增功能 (Added)

#### 依赖注入架构
全新的基于接口的模块化架构，支持运行时注入自定义实现：

**新增核心接口**（`src/device/interfaces.ts`）：
- `IHdcClient` — HarmonyOS Device Connector 抽象
- `IPortForwardManager` — 端口转发抽象（TCP/abstract socket）
- `IDeviceManager` — 设备管理抽象（20+ 方法）
- `IUitestServer` — 输入控制抽象
- `IScrcpyStream` — 视频流抽象
- `IDeviceFactory` — 组件工厂抽象

**新增工厂模式支持**：
- `DeviceFactory` 实现 `IDeviceFactory` 接口
- `HosScrcpyServer` 构造函数支持可选的 `IDeviceFactory` 参数
- `DeviceContext` 支持可选的流工厂函数

**代码改进**：
- 移除所有类型断言（`as any`）
- 所有组件通过接口通信
- 支持自定义设备管理器、视频流、端口转发等实现

#### 扩展能力
- 运行时注入自定义实现
- 简化单元测试（通过 Mock 接口）
- 100% 类型安全（无类型断言）
- 支持多种部署场景

#### 文档更新
- 新增 `docs/sdk-api.md` 中"依赖注入架构"章节
- 完整的接口定义和自定义实现示例
- Mock 实现测试示例

#### 向后兼容
- 所有组件保留静态工厂方法（`fromConfig`、`fromDeviceManager`）
- 现有代码无需任何修改即可运行

#### 代码质量
- 新增 ESLint 配置（`eslint.config.mjs`），基于 `@typescript-eslint`
- 新增 `npm run lint` 和 `npm run lint:fix` 命令
- 修复所有 lint 问题：移除未使用的变量/导入、补充空 catch 块注释
- 移除冗余文件 `test/api-verification.ts`（已被集成测试覆盖）

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

