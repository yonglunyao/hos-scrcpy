# hos-scrcpy 集成测试设计

## 概述

hos-scrcpy 集成测试验证服务器与 HarmonyOS 设备的端到端交互。

## 测试文件

| 文件 | 描述 | 测试数 |
|------|------|--------|
| `test/integration/server-api.test.ts` | **编程式 API 直接测试** - 直接导入 HosScrcpyServer 类测试 | 17 |
| `test/integration/programmatic-api.test.ts` | **编程式 API 进程测试** - 通过子进程和 HTTP API 测试 | 8 |
| `test/integration/websocket.test.ts` | **WebSocket 协议测试** - WS 消息协议验证 | 7 |
| `test/integration/key-event-routing.test.ts` | **按键路由测试** - 按键事件处理 | 4 |

## server-api.test.ts (新增)

**直接测试 HosScrcpyServer 类的编程式 API**

### 测试组

#### 1. `getPort()` 动态端口分配
- 返回实际监听端口（非默认值）
- 端口可被 TCP 连接访问

#### 2. `isCasting()` 状态检查
- 设备未投屏时返回 `false`
- 不存在的设备返回 `false`

#### 3. `/api/status` 端点
- 无投屏设备时返回空对象
- 指定 SN 查询返回正确状态

#### 4. `startDevice()` / `stopDevice()`
- `startDevice()` 启动投屏后 `isCasting()` 返回 `true`
- `/api/status?sn=xxx` 验证投屏状态
- `stopDevice()` 停止投屏后 `isCasting()` 返回 `false`
- **幂等性测试**：重复调用 `stopDevice()` 不报错
- **幂等性测试**：已投屏时调用 `startDevice()` 不报错

#### 5. `stopAll()`
- 停止所有设备投屏
- **幂等性测试**：重复调用不报错

#### 6. 持久化设备行为
- `startDevice()` 启动的设备在无 WS 客户端时保持投屏
- WS 客户端可连接到持久化设备并接收视频流

#### 7. `/webview/*` 路由
- 不存在的文件返回 404
- 路径遍历攻击被阻止（返回 404/403）

#### 8. `stop()` 方法
- 调用 `stopAll()` 并关闭服务器
- 端口不再可达

### 关键验证

```typescript
// 动态端口分配
const server = new HosScrcpyServer({ port: 0 });
await server.start();
expect(server.getPort()).toBeGreaterThan(0);

// 编程式启动投屏
await server.startDevice(SN);
expect(server.isCasting(SN)).toBe(true);

// 持久化行为（无 WS 客户端也保持）
await new Promise(resolve => setTimeout(resolve, 2000));
expect(server.isCasting(SN)).toBe(true);

// 清理
await server.stopDevice(SN);
```

## programmatic-api.test.ts (新增)

**通过子进程和 HTTP API 测试服务器**

### 测试组

#### 1. `GET /api/status`
- 无投屏设备返回空对象
- 不存在的设备返回 `casting: false`

#### 2. WS 客户端投屏与状态
- WS 客户端启动投屏
- `/api/status?sn=xxx` 验证状态正确

#### 3. WS 客户端断开行为
- 验证 WS 断开后设备状态（非持久化设备会清理）

#### 4. 多客户端共享流
- 多个 WS 客户端连接同一设备
- 所有客户端都接收视频流

#### 5. `/api/devices` 端点
- 返回已连接设备列表
- 包含测试设备 SN

#### 6. WebSocket 协议合规性
- 无效路径连接被拒绝
- 格式错误的 JSON 被优雅处理

### 测试方法

```typescript
// 每个测试前启动服务器
beforeEach(async () => {
  serverProc = spawn('node', ['dist/bin/server.js', '--port', '19235']);
  // 等待端口就绪...
});

// 每个测试后停止服务器
afterEach(async () => {
  serverProc.kill();
  // 等待端口释放...
});
```

## 测试运行

### 运行所有集成测试

```bash
npm run test:integration
```

### 运行单个测试文件

```bash
npx vitest run test/integration/server-api.test.ts
npx vitest run test/integration/programmatic-api.test.ts
npx vitest run test/integration/websocket.test.ts
```

### 设备要求

集成测试需要 HarmonyOS 设备通过 HDC 连接：

```bash
hdc list targets  # 应显示至少一个设备 SN
```

## 已知问题

### 设备资源耗尽

当连续运行多个集成测试时，设备可能出现以下问题：
- scrcpy 进程启动失败
- 视频流超时

**原因**：设备端 scrcpy 进程需要时间清理资源。

**解决方案**：
- 单独运行测试文件可避免此问题
- 在测试之间添加延迟
- 重启设备

### 端口冲突

多个测试文件同时运行可能导致端口冲突。

**解决方案**：
- 使用不同的端口（19234, 19235）
- 在测试前等待端口释放

## 测试覆盖率

| API 方法 | 测试覆盖 |
|----------|----------|
| `startDevice()` | ✅ |
| `stopDevice()` | ✅ |
| `stopAll()` | ✅ |
| `isCasting()` | ✅ |
| `getPort()` | ✅ |
| `/api/status` | ✅ |
| `/webview/*` | ✅ |
| 持久化行为 | ✅ |
| 幂等性 | ✅ |

## 与单元测试的区别

| 单元测试 | 集成测试 |
|----------|----------|
| 测试单个函数/类 | 测试端到端流程 |
| 使用 mock 设备 | 使用真实设备 |
| 快速（<1s） | 较慢（30-60s） |
| 122 个测试 | 36 个测试 |
| 不需要设备 | 需要 HarmonyOS 设备 |

## 持续集成建议

```yaml
# .github/workflows/test.yml
steps:
  - name: Run unit tests
    run: npm run test:unit  # 无需设备

  - name: Run integration tests
    if: github.event_name == 'schedule'  # 定时任务运行
    run: npm run test:integration  # 需要设备连接
```
