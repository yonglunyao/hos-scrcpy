# hos-scrcpy SDK 接口文档

> 版本: 1.2.0 | 入口: `import { ... } from 'hos-scrcpy'`

## 目录

- [快速开始](#快速开始)
- [依赖注入架构](#依赖注入架构-v111+) — 接口抽象与自定义实现
- [HosScrcpyServer](#hosscrcpyserver) — 完整投屏服务（HTTP + WebSocket）
- [DeviceManager](#devicemanager) — 设备管理、SO 推送、scrcpy 生命周期
- [HdcClient](#hdcclient) — HDC 命令行封装
- [PortForwardManager](#portforwardmanager) — 端口转发管理
- [UitestServer](#uitestserver) — 触摸/鼠标/键盘/截图输入控制
- [DirectScrcpyStream](#directscrcpystream) — gRPC 视频流（http2）
- [键码映射](#键码映射)
- [Protobuf 编解码](#protobuf-编解码)
- [WebSocket 协议](#websocket-协议)
- [类型定义](#类型定义)

---

## 快速开始

### 安装

```bash
npm install hos-scrcpy
```

前置条件: `hdc`（HarmonyOS Device Connector）已安装并在 PATH 中。

### 方式一: 独立服务器

```typescript
import { HosScrcpyServer } from 'hos-scrcpy';

const server = new HosScrcpyServer({ port: 9523 });
await server.start();
// 浏览器访问 http://localhost:9523 即可投屏
```

### 方式二: 编程式 SDK

```typescript
import {
  DeviceManager, UitestServer, DirectScrcpyStream,
  getHdcKeyCode
} from 'hos-scrcpy';

// 1. 创建设备管理器
const device = new DeviceManager({
  sn: 'FMR0223B16009134',
  scale: 2,
  frameRate: 30,
  bitRate: 4,
});

// 2. 启动 scrcpy（含 SO 推送、端口转发）
const forwardPort = await device.startScrcpyWithForward();
device.setScrcpyForwardPort(forwardPort);

// 3. 启动输入控制
const uitest = new UitestServer(device);
await uitest.start();

// 4. 接收视频流
const stream = new DirectScrcpyStream(device);
await stream.start({
  onData: (h264Nalu: Buffer) => { /* 处理 H.264 数据 */ },
  onReady: () => console.log('视频流就绪'),
  onError: (err) => console.error('流错误:', err),
});

// 5. 发送控制指令
await uitest.touchDown(540, 1200);
await uitest.touchUp(540, 1200);
await uitest.pressKey(getHdcKeyCode('HOME')!);

// 6. 停止
await stream.stop();
await uitest.stop();
await device.stopScrcpy();
```

### 方式三: CLI

```bash
npx hos-scrcpy --port 9523 --hdc /path/to/hdc --templates ./templates
```

---

## 依赖注入架构 (v1.1.1+)

hos-scrcpy 采用基于接口的依赖注入架构，所有核心组件都可通过接口抽象进行替换或扩展。

### 接口层次结构

```
IHdcClient          — HarmonyOS Device Connector 抽象
    ↓
IPortForwardManager — 端口转发抽象（TCP/abstract socket）
    ↓
IDeviceManager      — 设备管理抽象（组合上述两个）
    ↓
IUitestServer       — 输入控制抽象（依赖 IDeviceManager）
    ↓
IScrcpyStream       — 视频流抽象（依赖 IDeviceManager）
    ↓
IDeviceFactory      — 组件工厂抽象
```

### 导入接口

```typescript
import type {
  IHdcClient,
  IPortForwardManager,
  IDeviceManager,
  IUitestServer,
  IScrcpyStream,
  IDeviceFactory,
} from 'hos-scrcpy';
```

### 接口定义速查

#### IHdcClient

```typescript
interface IHdcClient {
  isOnline(): Promise<boolean>;
  shell(command: string, timeout?: number): Promise<string>;
  spawnShell(command: string): ChildProcess;
  pushFile(localPath: string, remotePath: string): Promise<string>;
  pullFile(remotePath: string, localPath: string): Promise<string>;
  createForward(localPort: number, remotePort: number): Promise<string>;
  createAbstractForward(localPort: number, abstractSocket: string): Promise<string>;
  removeForward(localPort: number, remotePort: number): Promise<string>;
  removeAbstractForward(localPort: number, abstractSocket: string): Promise<string>;
  getSn(): string;
  getIp(): string;
}
```

#### IPortForwardManager

```typescript
interface ForwardedPort {
  localPort: number;
  release(): Promise<void>;
}

interface IPortForwardManager {
  createTcpForward(remotePort: number): Promise<ForwardedPort>;
  createAbstractForward(abstractSocket: string): Promise<ForwardedPort>;
  releaseAll(): Promise<void>;
}
```

#### IDeviceManager（核心接口）

```typescript
interface IDeviceManager {
  // 设备状态
  isOnline(): Promise<boolean>;
  shell(command: string, timeout?: number): Promise<string>;
  getScale(): number;
  getSn(): string;
  getIp(): string;
  getScreenId(): number;

  // 组件访问
  getHdc(): IHdcClient;
  getPortForward(): IPortForwardManager | undefined;

  // Scrcpy 生命周期
  startScrcpyWithForward(): Promise<number>;
  stopScrcpy(): Promise<void>;
  getScrcpyForwardPort(): number;
  setScrcpyForwardPort(port: number): void;

  // 设备信息
  getScreenSize(): Promise<{ width: number; height: number }>;
  compareVersion(target: string, device: string): number;
  useSecConnect(): Promise<boolean>;
  pushSo(soName: string, devicePath?: string): Promise<boolean>;
  getUitestVersion(): Promise<string>;
  ensureBasicUitest(): Promise<void>;
  getScrcpyPids(): Promise<string[]>;
  killScrcpy(): Promise<void>;
  wakeUp(): Promise<void>;
  isCloudDevice(): Promise<boolean>;
  getImageScaleSize(): number;
  getIsUseSecSo(): boolean;
  startScrcpy(): Promise<void>;
}
```

#### IUitestServer

```typescript
interface IUitestServer {
  isUitestRunning(): boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  pressKey(keyCode: number): Promise<boolean>;
  touchDown(x: number, y: number): Promise<void>;
  touchUp(x: number, y: number): Promise<void>;
  touchMove(x: number, y: number): Promise<void>;
  getScreenSize(): Promise<{ width: number; height: number }>;
  getLayout(): Promise<string>;
}
```

#### IScrcpyStream

```typescript
interface IScrcpyStream {
  start(opts: {
    onData: (data: Buffer) => void;
    onReady: () => void;
    onError: (err: Error) => void;
  }): Promise<void>;
  requestIdrFrame(): Promise<void>;
  stop(): Promise<void>;
}
```

#### IDeviceFactory

```typescript
interface IDeviceFactory {
  createHdcClient(config: {
    hdcPath?: string;
    ip?: string;
    sn: string;
    port?: number;
  }): IHdcClient;
  createPortForwardManager(hdc: IHdcClient): IPortForwardManager;
  createDeviceManager(config: ScrcpyConfig): IDeviceManager;
  createUitestServer(manager: IDeviceManager): IUitestServer;
  createScrcpyStream(manager: IDeviceManager): IScrcpyStream;
  createDeviceContext(config: ScrcpyConfig & { persistent?: boolean }): IDeviceContext;
}
```

### 自定义实现示例

#### 示例 1: 自定义设备管理器

```typescript
import { IDeviceManager, IUitestServer, IScrcpyStream } from 'hos-scrcpy';

class CustomDeviceManager implements IDeviceManager {
  constructor(private config: ScrcpyConfig) {
    // 初始化自定义实现
  }

  // 实现所有必需的接口方法
  async isOnline(): Promise<boolean> {
    // 自定义设备检测逻辑
    return true;
  }

  async shell(command: string, timeout?: number): Promise<string> {
    // 自定义 shell 命令执行
    return '';
  }

  getScale(): number { return this.config.scale || 1; }
  getSn(): string { return this.config.sn; }
  getIp(): string { return this.config.ip || '127.0.0.1'; }
  getScreenId(): number { return 0; }

  // ... 实现其余 20+ 个接口方法

  getHdc(): IHdcClient {
    // 返回自定义 HDC 客户端
    throw new Error('Not implemented');
  }

  getPortForward(): IPortForwardManager | undefined {
    // 返回自定义端口转发管理器
    return undefined;
  }

  async startScrcpyWithForward(): Promise<number> {
    // 自定义 scrcpy 启动流程
    return 5000;
  }

  // ... 其他方法实现
}
```

#### 示例 2: 自定义视频流处理

```typescript
import { IScrcpyStream, IDeviceManager } from 'hos-scrcpy';

class CustomVideoStream implements IScrcpyStream {
  constructor(private device: IDeviceManager) {
    // 初始化自定义视频流处理器
  }

  async start(opts: {
    onData: (data: Buffer) => void;
    onReady: () => void;
    onError: (err: Error) => void;
  }): Promise<void> {
    // 自定义视频流启动逻辑
    // 例如：添加视频编码转换、水印叠加等
    opts.onReady();
  }

  async requestIdrFrame(): Promise<void> {
    // 请求 IDR 帧
  }

  async stop(): Promise<void> {
    // 清理资源
  }
}
```

#### 示例 3: 完整的自定义工厂

```typescript
import {
  IDeviceFactory,
  IDeviceManager,
  IHdcClient,
  IPortForwardManager,
  IUitestServer,
  IScrcpyStream,
  ScrcpyConfig,
} from 'hos-scrcpy';

class CustomDeviceFactory implements IDeviceFactory {
  createHdcClient(config): IHdcClient {
    // 返回自定义 HDC 客户端
    return new CustomHdcClient(config);
  }

  createPortForwardManager(hdc: IHdcClient): IPortForwardManager {
    // 返回自定义端口转发管理器
    return new CustomPortForwardManager(hdc);
  }

  createDeviceManager(config: ScrcpyConfig): IDeviceManager {
    // 返回自定义设备管理器
    return new CustomDeviceManager(config);
  }

  createUitestServer(manager: IDeviceManager): IUitestServer {
    // 返回自定义 UiTest 服务
    return new CustomUitestServer(manager);
  }

  createScrcpyStream(manager: IDeviceManager): IScrcpyStream {
    // 返回自定义视频流
    return new CustomVideoStream(manager);
  }

  createDeviceContext(config) {
    // 返回自定义设备上下文
    return new CustomDeviceContext(config);
  }
}
```

#### 示例 4: 注入自定义工厂到服务器

```typescript
import { HosScrcpyServer, IDeviceFactory } from 'hos-scrcpy';

const customFactory = new CustomDeviceFactory();
const server = new HosScrcpyServer(
  { port: 9523 },
  customFactory  // 注入自定义工厂
);
await server.start();

// 所有设备操作现在都使用自定义实现
await server.startDevice('FMR0223B16009134');
```

#### 示例 5: 使用流工厂注入

```typescript
import { DeviceContext, IDeviceManager, IUitestServer, IScrcpyStream } from 'hos-scrcpy';

// 创建设备上下文时注入自定义流工厂
const ctx = new DeviceContext(
  manager,      // IDeviceManager
  uitest,       // IUitestServer
  false,        // persistent
  (mgr: IDeviceManager) => new CustomVideoStream(mgr)  // 流工厂
);

// 启动投屏时将使用自定义视频流
await ctx.startScreenCast();
```

### 测试中的 Mock 实现

依赖注入架构使单元测试变得简单：

```typescript
import { IDeviceManager, IUitestServer } from 'hos-scrcpy';

class MockDeviceManager implements IDeviceManager {
  async isOnline() { return true; }
  async shell(cmd: string) { return 'mock output'; }
  getScale() { return 2; }
  getSn() { return 'MOCK_DEVICE'; }
  getIp() { return '127.0.0.1'; }
  getScreenId() { return 0; }
  // ... 最小化实现其他方法
}

describe('MyComponent', () => {
  it('should work with mock device', async () => {
    const mockDevice = new MockDeviceManager();
    // 测试代码使用 mock 对象
  });
});
```

### 向后兼容性

所有组件保留静态工厂方法，现有代码无需修改：

```typescript
// 旧代码继续工作
import { DeviceManager, UitestServer } from 'hos-scrcpy';

const device = DeviceManager.fromConfig({ sn: 'xxx' });
const uitest = UitestServer.fromDeviceManager(device);
```

### 架构收益

| 特性 | 收益 |
|------|------|
| **可测试性** | 通过 Mock 接口进行单元测试 |
| **可扩展性** | 运行时注入自定义实现 |
| **类型安全** | 完整的 TypeScript 类型定义 |
| **模块化** | 组件间低耦合，易于维护 |
| **灵活性** | 支持多种部署场景 |

---

## HosScrcpyServer

完整的 HarmonyOS 投屏服务，包含 HTTP 静态文件服务、WebSocket 消息路由、设备生命周期管理。与原 `demoWithoutRecord.jar` 的 WebSocket 协议完全兼容。

**内置 Web UI 功能**（v1.2.0+）：
- 实时视频流播放（使用 JMuxer 解码 H.264）
- 实时帧率（FPS）显示
- 一键截屏（PNG 格式下载）
- 屏幕录制（WebM 格式下载）
- 触摸/鼠标输入控制
- 键盘输入控制（HOME/BACK/音量/菜单/电源）

### 导入

```typescript
import { HosScrcpyServer, ServerConfig } from 'hos-scrcpy';
```

### ServerConfig

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `host` | `string` | `'0.0.0.0'` | 监听地址 |
| `port` | `number` | `9523` | 监听端口（设为 `0` 时动态分配） |
| `hdcPath` | `string` | `'hdc'` | hdc 可执行文件路径 |
| `templatesDir` | `string` | — | 前端模板目录（提供 Web UI） |

### 方法

#### `constructor(config?: ServerConfig)`

创建服务器实例。

```typescript
const server = new HosScrcpyServer({
  port: 9523,
  hdcPath: '/usr/local/bin/hdc',
  templatesDir: './templates',
});
```

#### `async start(): Promise<void>`

启动 HTTP 和 WebSocket 服务器。成功后可接受浏览器连接。

#### `async stop(): Promise<void>`

停止所有设备上下文并关闭服务器。

#### `async startDevice(sn: string): Promise<void>`

**编程式 API** — 启动指定设备的投屏，无需 WebSocket 客户端触发。

等价于收到 WS 消息 `{"type":"screen","sn":"xxx"}`，但不依赖客户端连接。

- **幂等**: 如果设备已在投屏，直接返回。
- **持久化**: 通过此方法启动的设备，即使没有 WS 客户端也保持流活跃。

```typescript
await server.startDevice('FMR0223B16009134');
```

#### `async stopDevice(sn: string): Promise<void>`

**编程式 API** — 停止指定设备的投屏，清理所有资源。

- **幂等**: 如果设备未在投屏，直接返回。

```typescript
await server.stopDevice('FMR0223B16009134');
```

#### `async stopAll(): Promise<void>`

**编程式 API** — 停止所有设备的投屏。

```typescript
await server.stopAll();
```

#### `isCasting(sn: string): boolean`

检查指定设备是否正在投屏。

```typescript
if (server.isCasting('FMR0223B16009134')) {
  console.log('设备正在投屏');
}
```

#### `getPort(): number`

返回实际监听端口。支持 `config.port = 0` 时的动态端口分配。

```typescript
const server = new HosScrcpyServer({ port: 0 });
await server.start();
console.log('实际端口:', server.getPort());  // 例如: 19148
```

### HTTP 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/devices` | 获取已连接设备列表（JSON 数组） |
| GET | `/api/status[?sn=xxx]` | 获取投屏状态（不传 `sn` 返回所有设备） |
| GET | `/` | Web UI 控制台（需配置 `templatesDir`） |
| GET | `/webview/*` | 静态文件服务（用于插件 webview） |

### Web UI 功能

内置 Web 控制台提供以下功能：

| 功能 | 说明 |
|------|------|
| 设备管理 | 选择设备、启动/停止投屏、刷新设备列表 |
| 状态监控 | 分辨率、帧率、帧数、延迟、码率、运行时长 |
| 截屏 | 一键截取当前视频帧并保存为 PNG 图片 |
| 录屏 | 录制视频流并保存为 WebM 文件（支持实时时长显示） |
| 远程控制 | HOME/BACK/音量+/音量-/菜单/电源按键 |

#### `/api/status` 响应格式

查询单个设备:
```json
// GET /api/status?sn=FMR0223B16009134
{ "casting": true, "sn": "FMR0223B16009134" }
```

查询所有设备:
```json
// GET /api/status
{
  "devices": {
    "FMR0223B16009134": { "casting": true },
    "FMR0223B16009135": { "casting": false }
  }
}
```

### WebSocket 端点

| 路径 | 说明 |
|------|------|
| `ws://host:port/ws/screen/{sn}` | 投屏 + 控制通道 |
| `ws://host:port/ws/uitest/{sn}` | UiTest 截图模式 |

---

## DeviceManager

设备管理的核心类。负责 SO 文件推送、版本匹配、scrcpy 进程启动/停止、端口转发。

### 导入

```typescript
import { DeviceManager, ScrcpyConfig, ScreenSize } from 'hos-scrcpy';
```

### ScrcpyConfig

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `sn` | `string` | **必填** | 设备序列号 |
| `ip` | `string` | `'127.0.0.1'` | 设备 IP 地址 |
| `hdcPath` | `string` | `'hdc'` | hdc 可执行文件路径 |
| `hdcPort` | `number` | `8710` | HDC 端口 |
| `scale` | `number` | `1` | 视频缩放倍率（2 = 分辨率减半） |
| `frameRate` | `number` | `30` | 帧率（FPS） |
| `bitRate` | `number` | `4` | 码率（Mbps） |
| `port` | `number` | `5000` | 设备端 scrcpy 端口 |
| `screenId` | `number` | `0` | 屏幕 ID |
| `windowsId` | `string` | — | 窗口 ID |
| `appPid` | `string` | — | 应用 PID |
| `encoderType` | `string` | — | 编码器类型 |
| `iFrameInterval` | `number` | `500` | 关键帧间隔（ms） |
| `repeatInterval` | `number` | `33` | 重复帧间隔（ms，30fps） |
| `extensionName` | `string` | `'libscreen_casting.z.so'` | 扩展 SO 名称 |
| `imageScaleSize` | `number` | `0.99` | UiTest 截图缩放 |

### ScreenSize

```typescript
interface ScreenSize {
  width: number;
  height: number;
}
```

### 方法

#### `constructor(config: ScrcpyConfig)`

```typescript
const device = new DeviceManager({
  sn: 'FMR0223B16009134',
  scale: 2,
  frameRate: 30,
  bitRate: 8,
});
```

#### 设备查询

| 方法 | 返回类型 | 说明 |
|------|----------|------|
| `getHdc(): HdcClient` | `HdcClient` | 获取底层 HDC 客户端 |
| `getPortForward(): PortForwardManager` | `PortForwardManager` | 获取端口转发管理器 |
| `getIp(): string` | `string` | 设备 IP |
| `getSn(): string` | `string` | 设备序列号 |
| `getScreenId(): number` | `number` | 屏幕 ID |
| `getScale(): number` | `number` | 视频缩放倍率 |
| `getImageScaleSize(): number` | `number` | UiTest 截图缩放 |
| `getScrcpyForwardPort(): number` | `number` | 当前 scrcpy 转发端口（0 = 未设置） |
| `getIsUseSecSo(): boolean` | `boolean` | 是否使用新版 SO |

#### `async isOnline(): Promise<boolean>`

检查设备是否在线。

#### `async shell(command: string, timeoutSec?: number): Promise<string>`

在设备上执行 shell 命令。

#### `async getUitestVersion(): Promise<string>`

获取设备端 uitest 版本号。

#### `compareVersion(targetVersion: string, deviceVersion: string): number`

比较版本号。返回: `1`（target > device）、`-1`（target < device）、`0`（相等）。

#### `async detectUseSecSo(): Promise<boolean>`

检测是否使用新版 SO 文件（uitest >= 6.0.2.1）。

#### SO 文件管理

| 方法 | 说明 |
|------|------|
| `async getDeviceSoMd5(soName?: string): Promise<string>` | 获取设备端 SO 文件 MD5 |
| `getLocalSoMd5(soName: string): string` | 获取本地 SO 文件 MD5 |
| `async pushSo(soName: string, devicePath?: string): Promise<boolean>` | 推送 SO 到设备 |

#### 进程管理

| 方法 | 说明 |
|------|------|
| `async getScrcpyPids(): Promise<string[]>` | 获取 scrcpy 进程 PID 列表 |
| `async getRecorderPids(): Promise<string[]>` | 获取 recorder 进程 PID 列表 |
| `async killScrcpy(): Promise<void>` | 终止所有 scrcpy 进程 |
| `async killRecorder(): Promise<void>` | 终止所有 recorder 进程 |

#### Scrcpy 生命周期

##### `buildScrcpyParams(): string`

构建 scrcpy 启动参数字符串。

##### `async startScrcpy(): Promise<void>`

启动 scrcpy server 进程。如已有进程在运行则跳过。

##### `async startScrcpyWithForward(): Promise<number>`

**完整启动流程**: 版本检测 → SO 匹配推送 → 进程启动 → 端口转发。

返回本地转发端口号。调用后需用 `setScrcpyForwardPort()` 保存。

```typescript
const port = await device.startScrcpyWithForward();
device.setScrcpyForwardPort(port);
```

##### `async stopScrcpy(): Promise<void>`

停止 scrcpy server，清理端口转发。

##### `setScrcpyForwardPort(port: number): void`

设置 scrcpy 转发端口（供 DirectScrcpyStream 使用）。

#### 设备信息

| 方法 | 说明 |
|------|------|
| `async getScreenSize(): Promise<ScreenSize>` | 获取屏幕尺寸 |
| `async wakeUp(): Promise<void>` | 唤醒屏幕 |
| `async isCloudDevice(): Promise<boolean>` | 是否云设备 |
| `async useSecConnect(): Promise<boolean>` | 是否使用新版 uitest 连接方式 |
| `async ensureBasicUitest(): Promise<void>` | 确保基础 uitest daemon 在运行 |

---

## HdcClient

HDC（HarmonyOS Device Connector）命令行封装，提供设备通信能力。

### 导入

```typescript
import { HdcClient, HdcOptions } from 'hos-scrcpy';
```

### HdcOptions

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `hdcPath` | `string` | **必填** | hdc 可执行文件路径 |
| `ip` | `string` | `'127.0.0.1'` | 设备 IP |
| `sn` | `string` | **必填** | 设备序列号 |
| `port` | `number` | `8710` | HDC 端口 |

### 方法

#### `constructor(opts: HdcOptions)`

```typescript
const hdc = new HdcClient({
  hdcPath: 'hdc',
  sn: 'FMR0223B16009134',
});
```

#### 命令执行

| 方法 | 返回类型 | 说明 |
|------|----------|------|
| `async exec(command: string, timeoutSec?: number): Promise<string>` | 执行 hdc 命令 |
| `async shell(command: string, timeoutSec?: number): Promise<string>` | 执行设备 shell 命令 |
| `spawnShell(command: string): ChildProcess` | 启动长连接 shell 进程 |

> `timeoutSec` 默认 8 秒。

#### 设备发现

| 方法 | 说明 |
|------|------|
| `async listTargets(): Promise<string[]>` | 列出已连接设备序列号 |
| `async isOnline(): Promise<boolean>` | 检查本设备是否在线 |

#### 端口转发

| 方法 | 说明 |
|------|------|
| `async createForward(localPort: number, remotePort: number): Promise<string>` | 创建 TCP 端口转发 |
| `async createAbstractForward(localPort: number, abstractSocket: string): Promise<string>` | 创建 abstract socket 转发 |
| `async removeForward(localPort: number, remotePort: number): Promise<string>` | 移除 TCP 转发 |
| `async removeAbstractForward(localPort: number, abstractSocket: string): Promise<string>` | 移除 abstract 转发 |

#### 文件操作

| 方法 | 说明 |
|------|------|
| `async pushFile(localPath: string, remotePath: string): Promise<string>` | 推送文件到设备 |
| `async pullFile(remotePath: string, localPath: string): Promise<string>` | 从设备拉取文件 |

#### 访问器

| 方法 | 返回类型 |
|------|----------|
| `getSn(): string` | 设备序列号 |
| `getIp(): string` | 设备 IP |

---

## PortForwardManager

管理 HDC 端口转发的创建和清理。内置互斥锁防止并发创建冲突。

### 导入

```typescript
import { PortForwardManager, ForwardedPort } from 'hos-scrcpy';
```

> 注意: `ForwardedPort` 接口虽未在 `index.ts` 显式导出，但通过 `PortForwardManager` 方法返回。

### ForwardedPort

```typescript
interface ForwardedPort {
  localPort: number;        // 本地监听端口
  release: () => Promise<void>;  // 释放转发
}
```

### 方法

#### `constructor(hdc: HdcClient)`

#### `async createTcpForward(remotePort: number): Promise<ForwardedPort>`

创建 TCP 端口转发。自动分配本地端口（36000-37000 范围内随机）。

#### `async createAbstractForward(abstractSocket: string): Promise<ForwardedPort>`

创建 abstract socket 转发。用于新版 uitest（>= 6.0.2.1）。

```typescript
const fwd = await pf.createAbstractForward('scrcpy_grpc_socket');
console.log(fwd.localPort); // 转发的本地端口
// 用完后释放
await fwd.release();
```

#### `async releaseAll(): Promise<void>`

释放所有已创建的端口转发。

---

## UitestServer

通过 TCP socket 与设备端 uitest agent 通信，提供触摸、鼠标、键盘、截图等输入控制。

### 导入

```typescript
import { UitestServer } from 'hos-scrcpy';
```

### 方法

#### `constructor(device: DeviceManager)`

#### 生命周期

| 方法 | 说明 |
|------|------|
| `isUitestRunning(): boolean` | uitest 是否在运行 |
| `async start(): Promise<void>` | 启动 uitest（含 SO 推送、进程启动、端口转发） |
| `async stop(): Promise<void>` | 停止 uitest 并清理资源 |

#### 触摸事件

| 方法 | 说明 |
|------|------|
| `async touchDown(x: number, y: number): Promise<void>` | 触摸按下 |
| `async touchUp(x: number, y: number): Promise<void>` | 触摸抬起 |
| `async touchMove(x: number, y: number): Promise<void>` | 触摸移动 |

> 坐标为设备屏幕坐标（需乘以 scale）。

#### 鼠标事件

| 方法 | 说明 |
|------|------|
| `async mouseDown(type, x, y): Promise<void>` | 鼠标按下 |
| `async mouseUp(type, x, y): Promise<void>` | 鼠标抬起 |
| `async mouseMove(type, x, y): Promise<void>` | 鼠标移动 |
| `async mouseWheelUp(x, y): Promise<void>` | 滚轮上 |
| `async mouseWheelDown(x, y): Promise<void>` | 滚轮下 |
| `async mouseWheelStop(x, y): Promise<void>` | 停止滚轮 |

`type` 取值: `'mouseLeft' | 'mouseMiddle' | 'mouseRight' | null`

#### 文本与按键

| 方法 | 说明 |
|------|------|
| `async inputText(x: number, y: number, content: string): Promise<void>` | 在坐标处输入文本 |
| `async pressKey(keyCode: number): Promise<boolean>` | 发送按键（仅 HOME/BACK 通过 uitest，其他走 uinput） |

> `pressKey` 返回 `true` 表示由 uitest 处理，`false` 表示需走其他方式。

#### 屏幕信息

| 方法 | 说明 |
|------|------|
| `async getLayout(): Promise<string>` | 获取 UI 布局（JSON 字符串） |
| `async getScreenSize(): Promise<{ width: number; height: number }>` | 获取屏幕分辨率 |
| `async setRotation(rotation: number): Promise<void>` | 设置屏幕方向 |
| `async captureScreen(savePath: string, displayId?: number): Promise<void>` | 截图保存到设备路径 |

---

## DirectScrcpyStream

使用 Node.js 内置 `http2` 模块实现的 gRPC 客户端。通过 h2c prior knowledge 直接连接设备端 gRPC 服务。

### 导入

```typescript
import { DirectScrcpyStream } from 'hos-scrcpy';
```

### 方法

#### `constructor(device: DeviceManager)`

#### `async start(opts: StreamCallbacks): Promise<void>`

启动 gRPC 视频流连接。

```typescript
interface StreamCallbacks {
  onData: (data: Buffer) => void;    // H.264 NALU 数据
  onReady: () => void;                // 流就绪回调
  onError: (err: Error) => void;      // 错误回调
}
```

内部流程:
1. 通过 `http2.connect()` 建立 h2c 连接到 `127.0.0.1:{forwardPort}`
2. 发送 gRPC POST `/ScrcpyService/onStart`
3. 接收 server-streaming 响应
4. 解析 gRPC 5 字节帧前缀 + protobuf `ReplyMessage`
5. 提取 `payload["data"].val_bytes` 即 H.264 NALU 数据

前置条件: `device.getScrcpyForwardPort()` 必须返回有效端口，否则抛出 `Error('Scrcpy forward port not set')`。

#### `async requestIdrFrame(): Promise<void>`

请求 IDR 关键帧。发送 gRPC 请求 `/ScrcpyService/onRequestIDRFrame`。

#### `async stop(): Promise<void>`

停止流并关闭 HTTP/2 连接。

---

## 键码映射

### 导入

```typescript
import { KEY_CODE_MAP, getHdcKeyCode } from 'hos-scrcpy';
```

### KEY_CODE_MAP

键名到 HarmonyOS 键码的映射表。

```typescript
const KEY_CODE_MAP: Record<string, number> = {
  HOME: 3, BACK: 4,
  VOLUME_UP: 16, VOLUME_DOWN: 17, POWER: 18,
  CAMERA: 19, VOLUME_MUTE: 22, MUTE: 23,
  MENU: 2067, ESCAPE: 2070, ENTER: 2054,
  TAB: 2049, SPACE: 2050, DEL: 2055,
  // ... 完整映射见 src/input/keycode.ts
};
```

### `getHdcKeyCode(keyCode1: string, keyCode2?: string): number | null`

根据键名查找键码。支持精确匹配和模糊匹配（忽略下划线和大小写）。

```typescript
getHdcKeyCode('HOME');           // 3
getHdcKeyCode('volumeup');       // 16 (模糊匹配)
getHdcKeyCode('VOLUME', 'UP');   // 16 (第二个参数备选)
getHdcKeyCode('unknown');        // null
```

### 常用键码速查

| 键名 | 键码 | 说明 |
|------|------|------|
| `HOME` | 3 | 主页 |
| `BACK` | 4 | 返回 |
| `VOLUME_UP` | 16 | 音量+ |
| `VOLUME_DOWN` | 17 | 音量- |
| `POWER` | 18 | 电源 |
| `CAMERA` | 19 | 相机 |
| `MENU` | 2067 | 菜单 |
| `ENTER` | 2054 | 回车 |
| `ESCAPE` | 2070 | ESC |
| `TAB` | 2049 | Tab |
| `SPACE` | 2050 | 空格 |
| `F1`-`F12` | 2090-2101 | 功能键 |
| `0`-`9` | 2000-2009 | 数字键 |
| `A`-`Z` | 2017-2042 | 字母键 |

---

## Protobuf 编解码

手写的 protobuf 编解码实现，对应设备端 `scrcpy.proto`。无需 `.proto` 编译。

### 导入

```typescript
import {
  decodeReplyMessage, encodeEmpty, encodeGrpcMessage,
  decodeGrpcFrame, ParamValue, ReplyMessage, ReplyEndMessage,
} from 'hos-scrcpy';
```

### 类型

#### ParamValue

```typescript
interface ParamValue {
  valInt?: bigint;      // field 1, int64
  valDouble?: number;   // field 2, double
  valString?: string;   // field 3, string
  valBool?: boolean;    // field 4, bool
  valBytes?: Buffer;    // field 5, bytes (H.264 视频数据)
  valFloat?: number;    // field 6, float
}
```

#### ReplyMessage

```typescript
interface ReplyMessage {
  data: string;                         // field 1
  replyType: number;                    // field 2
  payload: Map<string, ParamValue>;     // field 3, map
}
```

> 视频数据在 `payload.get('data')?.valBytes` 中。

#### ReplyEndMessage

```typescript
interface ReplyEndMessage {
  result: number;    // field 1
}
```

### 函数

#### `decodeReplyMessage(buf: Buffer): ReplyMessage`

解码 `ReplyMessage` protobuf。

#### `decodeReplyEndMessage(buf: Buffer): ReplyEndMessage`

解码 `ReplyEndMessage` protobuf。

#### `encodeEmpty(): Buffer`

编码空 protobuf 消息（5 字节 gRPC 帧: `[0, 0, 0, 0, 0]`）。

#### `encodeGrpcMessage(payload: Buffer): Buffer`

将 protobuf 数据封装为 gRPC 帧（5 字节头 + payload）。

#### `decodeGrpcFrame(buf: Buffer): { messages: Buffer[]; remaining: Buffer }`

从连续 buffer 中解析所有完整的 gRPC 帧。返回解析出的消息列表和剩余未完成数据。

---

## WebSocket 协议

浏览器通过 WebSocket 连接 `/ws/screen/{sn}` 或 `/ws/uitest/{sn}` 进行通信。

### 客户端 → 服务器

#### 开始投屏

```json
{
  "type": "screen",
  "sn": "FMR0223B16009134",
  "remoteIp": "127.0.0.1",
  "remotePort": "8710"
}
```

#### UiTest 截图模式

```json
{ "type": "uitest", "sn": "FMR0223B16009134" }
```

#### 触摸事件

```json
{
  "type": "touchEvent",
  "sn": "FMR0223B16009134",
  "message": {
    "event": "down",
    "x": 540,
    "y": 1200
  }
}
```

`event` 取值: `"down"` | `"up"` | `"move"`

> 坐标需为视频坐标（设备坐标 / scale）。

#### 按键事件

```json
{
  "type": "keyCode",
  "sn": "FMR0223B16009134",
  "message": {
    "key": "HOME",
    "code": "3"
  }
}
```

#### 停止投屏

```json
{ "type": "stop", "sn": "FMR0223B16009134" }
```

### 服务器 → 客户端

#### 屏幕配置（JSON 文本消息）

```json
{ "type": "screenConfig", "scale": 2 }
```

投屏启动后发送一次。客户端据此将视频坐标 × scale 映射为设备坐标。

#### 视频帧（Binary 消息）

H.264 NALU 原始数据，通过 WebSocket binary frame 发送。客户端可用 JMuxer 或 Broadway 解码播放。

#### UiTest 就绪

```json
{ "type": "ready", "width": 1080, "height": 2340, "message": "..." }
```

#### UiTest 数据

```json
{ "type": "data", "data": "{ ... }" }
```

### gRPC 服务定义（设备端）

```protobuf
service ScrcpyService {
  rpc onStart(Empty) returns (stream ReplyMessage);      // H.264 视频流
  rpc onEnd(Empty) returns (ReplyEndMessage);             // 停止录制
  rpc onRequestIDRFrame(Empty) returns (ReplyEndMessage); // 请求关键帧
}
```

### 协议流程

```
客户端                    服务器                      设备
  │                         │                           │
  │── ws connect ──────────>│                           │
  │── {"type":"screen"} ───>│                           │
  │                         │── start uitest ──────────>│
  │                         │── start scrcpy ──────────>│
  │                         │── port forward ──────────>│
  │                         │── gRPC onStart ──────────>│
  │<── {"type":"screenConfig","scale":2} ──│           │
  │                         │<── H.264 stream ─────────│
  │<── binary (H.264) ─────│                           │
  │<── binary (H.264) ─────│                           │
  │── {"type":"touchEvent"} ──>│                        │
  │                         │── uitest touchDown ──────>│
  │── {"type":"keyCode"} ──>│                           │
  │                         │── uitest/uinput key ─────>│
  │── {"type":"stop"} ─────>│                           │
  │                         │── gRPC onEnd ────────────>│
  │                         │── stop scrcpy ───────────>│
```

---

## 类型定义

### 所有导出类型索引

```typescript
// 服务器配置
import { ServerConfig } from 'hos-scrcpy';

// 设备配置与屏幕尺寸
import { ScrcpyConfig, ScreenSize } from 'hos-scrcpy';

// HDC 客户端配置
import { HdcOptions } from 'hos-scrcpy';

// 端口转发结果（通过 PortForwardManager 方法返回）
interface ForwardedPort {
  localPort: number;
  release: () => Promise<void>;
}

// Protobuf 消息类型
import { ParamValue, ReplyMessage, ReplyEndMessage } from 'hos-scrcpy';

// 键码映射表
import { KEY_CODE_MAP } from 'hos-scrcpy';
// KEY_CODE_MAP 类型: Record<string, number>
```

---

## 集成案例

### 案例 1: Express 服务器集成（使用编程式 API）

在 Express 应用中集成 hos-scrcpy，通过 API 控制设备投屏。

```typescript
import express from 'express';
import { HosScrcpyServer } from 'hos-scrcpy';

const app = express();
const port = 3000;

// 启动投屏服务（使用动态端口）
const scrcpyServer = new HosScrcpyServer({ port: 0 });
await scrcpyServer.start();
console.log('投屏服务端口:', scrcpyServer.getPort());

// API 端点：启动设备投屏
app.post('/api/cast/:sn/start', async (req, res) => {
  const { sn } = req.params;
  await scrcpyServer.startDevice(sn);
  res.json({ success: true, sn, casting: scrcpyServer.isCasting(sn) });
});

// API 端点：停止设备投屏
app.post('/api/cast/:sn/stop', async (req, res) => {
  const { sn } = req.params;
  await scrcpyServer.stopDevice(sn);
  res.json({ success: true, sn, casting: scrcpyServer.isCasting(sn) });
});

// API 端点：查询投屏状态
app.get('/api/cast/:sn/status', (req, res) => {
  const { sn } = req.params;
  res.json({ sn, casting: scrcpyServer.isCasting(sn) });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
```

### 案例 2: 框架事件驱动的设备管理

模拟 screencast 插件的事件驱动模式，根据框架事件自动管理设备投屏。

```typescript
import { HosScrcpyServer } from 'hos-scrcpy';

const server = new HosScrcpyServer({ port: 8899 });
await server.start();

// 模拟框架事件
interface DeviceEvents {
  on(event: 'discovered', handler: (sn: string) => void): void;
  on(event: 'removed', handler: (sn: string) => void): void;
  on(event: 'activeChanged', handler: (oldSn: string | null, newSn: string | null) => void): void;
}

// 框架事件驱动
deviceEvents.on('discovered', async (sn) => {
  console.log(`设备发现: ${sn}`);
  await server.startDevice(sn);
});

deviceEvents.on('removed', async (sn) => {
  console.log(`设备移除: ${sn}`);
  await server.stopDevice(sn);
});

deviceEvents.on('activeChanged', async (oldSn, newSn) => {
  console.log(`活动设备切换: ${oldSn} -> ${newSn}`);
  if (oldSn) await server.stopDevice(oldSn);
  if (newSn) await server.startDevice(newSn);
});

// 关闭时清理所有投屏
process.on('SIGINT', async () => {
  await server.stopAll();
  await server.stop();
});
```

### 案例 3: 多设备并发投屏管理

同时管理多个设备的投屏状态。

```typescript
import { HosScrcpyServer } from 'hos-scrcpy';

const server = new HosScrcpyServer({ port: 9523 });
await server.start();

// 批量启动多个设备
async function startMultipleDevices(sns: string[]) {
  const results = await Promise.allSettled(
    sns.map(sn => server.startDevice(sn))
  );

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      console.log(`✓ ${sns[i]} 启动成功`);
    } else {
      console.error(`✗ ${sns[i]} 启动失败:`, result.reason);
    }
  });
}

// 获取所有投屏中的设备
function getActiveCasts(): string[] {
  const response = await fetch('http://localhost:9523/api/status');
  const data = await response.json() as { devices: Record<string, { casting: boolean }> };
  return Object.entries(data.devices)
    .filter(([_, status]) => status.casting)
    .map(([sn]) => sn);
}

// 停止所有投屏
async function stopAllCasts() {
  await server.stopAll();
}
```

### 案例 4: 自定义视频流处理

接收 H.264 视频流并保存到文件或转发。

```typescript
import { DeviceManager, UitestServer, DirectScrcpyStream } from 'hos-scrcpy';
import { createWriteStream } from 'fs';

const device = new DeviceManager({ sn: 'FMR0223B16009134' });
await device.startScrcpyWithForward();
device.setScrcpyForwardPort(await device.startScrcpyWithForward());

// 创建文件写入流
const outputStream = createWriteStream('screen.mp4');

const stream = new DirectScrcpyStream(device);
await stream.start({
  onData: (h264Nalu: Buffer) => {
    // 处理 H.264 数据
    outputStream.write(h264Nalu);
  },
  onReady: () => console.log('录制开始'),
  onError: (err) => {
    console.error('录制错误:', err);
    outputStream.close();
  },
});
```

### 案例 5: WebSocket 客户端集成

使用 WebSocket 客户端连接 hos-scrcpy 服务器。

```typescript
import { WebSocket } from 'ws';

const ws = new WebSocket('ws://localhost:9523/ws/screen/FMR0223B16009134');

ws.on('open', () => {
  // 开始投屏
  ws.send(JSON.stringify({
    type: 'screen',
    sn: 'FMR0223B16009134',
  }));
});

ws.on('message', (data: Buffer) => {
  if (data[0] === 123) {
    // JSON 消息 (如 screenConfig)
    const msg = JSON.parse(data.toString());
    console.log('配置:', msg);
  } else {
    // H.264 视频帧
    console.log('收到视频帧:', data.length, 'bytes');
  }
});

// 发送触摸事件
ws.send(JSON.stringify({
  type: 'touchEvent',
  sn: 'FMR0223B16009134',
  message: { event: 'down', x: 540, y: 1200 },
}));

// 发送按键
ws.send(JSON.stringify({
  type: 'keyCode',
  sn: 'FMR0223B16009134',
  message: { key: 'HOME' },
}));
```

### 案例 6: 错误处理与重试

健壮的设备连接实现，包含错误处理和自动重试。

```typescript
import { DeviceManager, DirectScrcpyStream } from 'hos-scrcpy';

async function startCastingWithRetry(
  sn: string,
  maxRetries = 3
): Promise<{ device: DeviceManager; stream: DirectScrcpyStream }> {
  let lastError: Error | null = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const device = new DeviceManager({
        sn,
        scale: 2,
        frameRate: 30,
        bitRate: 8,
      });

      // 检查设备是否在线
      const online = await device.isOnline();
      if (!online) {
        throw new Error(`设备 ${sn} 未连接`);
      }

      // 启动 scrcpy
      const port = await device.startScrcpyWithForward();
      device.setScrcpyForwardPort(port);

      // 启动视频流
      const stream = new DirectScrcpyStream(device);
      await stream.start({
        onData: (data) => console.log('收到帧:', data.length),
        onReady: () => console.log('投屏成功'),
        onError: (err) => {
          console.error('流错误:', err);
          lastError = err;
        },
      });

      console.log(`尝试 ${i + 1}/${maxRetries} 成功`);
      return { device, stream };

    } catch (err) {
      console.warn(`尝试 ${i + 1}/${maxRetries} 失败:`, err.message);
      lastError = err;
      if (i < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 2000)); // 等待 2 秒后重试
      }
    }
  }

  throw lastError || new Error('未知错误');
}

// 使用
try {
  const { device, stream } = await startCastingWithRetry('FMR0223B16009134');
  // 投屏成功，执行其他操作...
} catch (err) {
  console.error('投屏失败:', err);
}
```

### 案例 7: React 组件集成

在 React 应用中集成 hos-scrcpy 控制功能。

```typescript
import { useState, useEffect } from 'react';
import { DeviceManager, UitestServer, getHdcKeyCode } from 'hos-scrcpy';

function ScreenCaster({ sn }: { sn: string }) {
  const [casting, setCasting] = useState(false);
  const [device, setDevice] = useState<DeviceManager | null>(null);
  const [uitest, setUitest] = useState<UitestServer | null>(null);

  const startCasting = async () => {
    const dev = new DeviceManager({ sn, scale: 2 });
    await dev.startScrcpyWithForward();
    dev.setScrcpyForwardPort(await dev.startScrcpyWithForward());

    const uitestServer = new UitestServer(dev);
    await uitestServer.start();

    setDevice(dev);
    setUitest(uitestServer);
    setCasting(true);
  };

  const stopCasting = async () => {
    if (device) {
      await device.stopScrcpy();
    }
    if (uitest) {
      await uitest.stop();
    }
    setCasting(false);
  };

  const pressHome = async () => {
    if (uitest) {
      await uitest.pressKey(getHdcKeyCode('HOME')!);
    }
  };

  return (
    <div>
      <button onClick={startCasting} disabled={casting}>
        开始投屏
      </button>
      <button onClick={stopCasting} disabled={!casting}>
        停止投屏
      </button>
      <button onClick={pressHome} disabled={!casting}>
        HOME
      </button>
    </div>
  );
}
```

---

## 错误处理

SDK 使用标准 JavaScript `Error` 对象。常见错误:

| 错误消息 | 触发场景 |
|----------|----------|
| `Device not found: {sn}` | 设备离线或未连接 |
| `Scrcpy forward port not set` | DirectScrcpyStream 启动前未设置转发端口 |
| `Failed to start scrcpy server (no SO version worked)` | 所有 SO 版本都无法启动 scrcpy |
| `Uitest not ready` | uitest 未初始化就发送控制指令 |
| `HTTP/2 connect timeout` | 10 秒内无法建立 gRPC 连接 |
| `Server did not start` | 服务器端口未就绪 |

---

## 版本兼容性

| 设备端 uitest 版本 | SO 选择 | 转发方式 | Agent SO |
|-------------------|---------|----------|----------|
| >= 6.0.2.1 | `SCRCPY_SEC_SO_LIST` | abstract socket | `uitest_agent_1.2.2.so` |
| 5.1.1.3 - 6.0.2.0 | `SCRCPY_SO_LIST` | TCP forward | `uitest_agent_1.1.10.so` |
| 5.1.1.2 - 5.1.1.3 | `SCRCPY_SO_LIST` | TCP forward | `uitest_agent_1.1.3.so` / `1.1.5.so` |
| < 5.1.1.2 | 不支持 | — | — |
| x86_64 模拟器 | — | — | `uitest_agent_x86_1.1.9.so` |

Agent 版本 >= 1.2.0 使用 abstract socket 转发（`useSecConnect`）。
