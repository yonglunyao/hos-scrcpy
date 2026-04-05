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
