# hos-scrcpy

> HarmonyOS screen casting server - TypeScript implementation of `demoWithoutRecord.jar`

hos-scrcpy 是一个 HarmonyOS 设备投屏服务器的 TypeScript 实现，与原 Java 版本的 `demoWithoutRecord.jar` 完全兼容 WebSocket 协议。

## 特性

- ✅ **纯 TypeScript 实现** - 无需 Java 运行时
- ✅ **WebSocket 协议兼容** - 直接替换 `demoWithoutRecord.jar`
- ✅ **H.264 视频流** - 高质量视频编码
- ✅ **触摸/键盘输入** - 完整的设备控制
- ✅ **编程式 API** - 支持事件驱动的设备管理
- ✅ **多设备支持** - 同时管理多个 HarmonyOS 设备
- ✅ **依赖注入架构** - 基于接口的模块化设计，可扩展和自定义实现
- ✅ **Web UI** - 内置投屏控制界面，支持实时帧率显示
- ✅ **录屏截屏** - 浏览器端录屏和截屏功能

## 安装

```bash
npm install hos-scrcpy
```

前置条件：`hdc`（HarmonyOS Device Connector）已安装并在 PATH 中。

## 快速开始

### 方式一：CLI

```bash
# 启动服务器
npx hos-scrcpy --port 9523

# 打开浏览器访问
# http://localhost:9523
```

### 方式二：Node.js 模块

```typescript
import { HosScrcpyServer } from 'hos-scrcpy';

const server = new HosScrcpyServer({ port: 9523 });
await server.start();

// 浏览器访问 http://localhost:9523
```

### 方式三：编程式 API

```typescript
import { HosScrcpyServer } from 'hos-scrcpy';

const server = new HosScrcpyServer({ port: 8899 });
await server.start();

// 启动指定设备投屏
await server.startDevice('设备序列号');
console.log(server.isCasting('设备序列号')); // true

// 停止投屏
await server.stopDevice('设备序列号');
await server.stopAll();
```

## 文档

- [SDK API 文档](docs/sdk-api.md) - 完整的 API 参考
- [集成测试文档](docs/integration-tests.md) - 测试覆盖说明
- [WebSocket 协议](docs/scrcpy-protocol.md) - 协议详情
- [CHANGELOG](CHANGELOG.md) - 版本变更记录

## API 端点

| 端点 | 说明 |
|------|------|
| `GET /api/devices` | 获取设备列表 |
| `GET /api/status` | 查询投屏状态 |
| `WS /ws/screen/{sn}` | 投屏 WebSocket 连接 |
| `GET /webview/*` | 静态文件服务 |

## 编程式 API

| 方法 | 说明 |
|------|------|
| `startDevice(sn)` | 启动设备投屏 |
| `stopDevice(sn)` | 停止设备投屏 |
| `stopAll()` | 停止所有投屏 |
| `isCasting(sn)` | 检查投屏状态 |
| `getPort()` | 获取实际端口 |

## 开发

```bash
# 安装依赖
npm install

# 构建
npm run build

# 开发模式
npm run dev

# 代码检查
npm run lint         # ESLint 检查
npm run lint:fix     # ESLint 自动修复

# 测试
npm run test:unit      # 单元测试
npm run test:integration # 集成测试

# 打包
npm run pack           # 输出到 package/ 目录
```

## CLI 选项

```bash
hos-scrcpy [options]

Options:
  --port <number>      监听端口 (默认: 9523)
  --hdc <path>         hdc 可执行文件路径 (默认: hdc)
  --templates <dir>    Web UI 模板目录
```

## MCP Server

hos-scrcpy 内置一个 MCP(Model Context Protocol)server,把 HarmonyOS 设备控制能力暴露为 LLM agent 工具,可用于 UI 自动化、动态分析、自动点击等场景(类比手机版 computer-use)。

### 运行

```bash
# 需先 build
npm run build

# 启动 MCP server(stdio 传输)
npm run mcp
# 或:hos-scrcpy-mcp
```

环境变量 `HDC_PATH` 指定 hdc 路径(默认 `hdc`)。

### 工具一览

| 工具 | 说明 | 注解 |
|------|------|------|
| `list_devices` | 列出已连接设备序列号 | 只读 |
| `connect_device` | 连接设备并启动 uitest 输入会话(控制前必调) | — |
| `disconnect_device` | 断开设备,释放资源 | — |
| `device_info` | 查询在线状态/分辨率/uitest 版本/云设备 | 只读 |
| `take_screenshot` | 截屏,返回全分辨率图像(设备坐标) | 只读 |
| `dump_ui` | 转储 UI 布局树,返回元素 bounds 与中心坐标 | 只读 |
| `tap` | 点击坐标 | 写操作 |
| `long_press` | 长按 | 写操作 |
| `swipe` | 滑动 | 写操作 |
| `input_text` | 点击聚焦后输入文本 | 写操作 |
| `press_key` | 按键(HOME/BACK 走 uitest,其余走 uinput) | 写操作 |
| `home` / `back` | HOME / BACK 便捷封装 | 写操作 |
| `launch_app` | `aa start` 启动应用 | 写操作 |
| `run_shell` | 执行任意 hdc shell(危险) | 写操作 ⚠️ |
| `push_file` / `pull_file` | 文件收发 | 写操作 |

> 坐标系:截图/触摸/UI 布局全程使用设备坐标,无 scale 转换。

### 编程式使用

```typescript
import { createMcpServer } from 'hos-scrcpy';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = createMcpServer();
await server.connect(new StdioServerTransport());
```

### 接入 Claude Code

在 `~/.claude.json` 的 `mcpServers` 中添加:

```json
"hos-scrcpy": {
  "command": "node",
  "args": ["<path-to>/hos-scrcpy/dist/bin/mcp.js"],
  "env": { "HDC_PATH": "hdc" }
}
```

或发布后用 `npx hos-scrcpy-mcp`。

## 架构

```
Web Browser ←WebSocket→ HosScrcpyServer ←gRPC (h2c)→ uitest daemon (on device)
                                  ↑
                            TCP forward via HDC
```

- **HDC** - HarmonyOS Device Connector（类似 ADB）
- **uitest daemon** - 设备端单例守护进程
- **Port forwarding** - 本地端口到设备端抽象 socket 的转发

## 版本

当前版本：[![npm version](https://badge.fury.io/js/hos-scrcpy.svg)](https://www.npmjs.com/package/hos-scrcpy)

- **v1.2.0** - 录屏截屏功能、帧率显示、结构化日志
- **v1.1.2** - Web 界面帧率显示、代码质量优化
- **v1.1.1** - 依赖注入架构、接口抽象、可扩展设计
- **v1.1.0** - 编程式 API、持久化投屏
- **v1.0.0** - 初始发布

## 许可证

MIT

## 作者

Yonglun Yao <yonglunyao@gmail.com>

## 相关链接

- [GitHub](https://github.com/yonglunyao/hos-scrcpy)
- [npm](https://www.npmjs.com/package/hos-scrcpy)
- [HarmonyOS](https://www.harmonyos.com/)
