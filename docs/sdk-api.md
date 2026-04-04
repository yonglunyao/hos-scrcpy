# hos-scrcpy SDK 接口文档

> 版本: 1.0.0 | 入口: `import { ... } from 'hos-scrcpy'`

## 目录

- [快速开始](#快速开始)
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

## HosScrcpyServer

完整的 HarmonyOS 投屏服务，包含 HTTP 静态文件服务、WebSocket 消息路由、设备生命周期管理。与原 `demoWithoutRecord.jar` 的 WebSocket 协议完全兼容。

### 导入

```typescript
import { HosScrcpyServer, ServerConfig } from 'hos-scrcpy';
```

### ServerConfig

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `host` | `string` | `'0.0.0.0'` | 监听地址 |
| `port` | `number` | `9523` | 监听端口 |
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

### HTTP 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/devices` | 获取已连接设备列表（JSON 数组） |
| GET | `/` | Web UI 页面（需配置 `templatesDir`） |

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

### 案例 1: Express 服务器集成

在 Express 应用中集成 hos-scrcpy，提供投屏 API。

```typescript
import express from 'express';
import { HosScrcpyServer } from 'hos-scrcpy';

const app = express();
const port = 3000;

// 启动投屏服务
const scrcpyServer = new HosScrcpyServer({ port: 9523 });
await scrcpyServer.start();

// API 端点
app.get('/api/start-cast/:sn', async (req, res) => {
  // 自定义投屏启动逻辑
  res.json({ message: 'Casting started for ' + req.params.sn });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
```

### 案例 2: 自定义视频流处理

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

### 案例 3: 多设备管理

同时管理多个 HarmonyOS 设备。

```typescript
import { DeviceManager } from 'hos-scrcpy';

const devices = new Map<string, DeviceManager>();

// 添加设备
devices.set('device1', new DeviceManager({
  sn: 'FMR0223B16009134',
  scale: 2,
}));

devices.set('device2', new DeviceManager({
  sn: 'FMR0223B16009999',
  scale: 1,
}));

// 批量启动
for (const [id, device] of devices) {
  await device.startScrcpyWithForward();
  console.log(`设备 ${id} 已启动`);
}

// 批量停止
for (const [id, device] of devices) {
  await device.stopScrcpy();
  console.log(`设备 ${id} 已停止`);
}
```

### 案例 4: WebSocket 客户端集成

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

### 案例 5: 错误处理与重试

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

### 案例 6: React 组件集成

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
