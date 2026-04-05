# 资源耗尽问题分析

## 问题描述

在集成测试中，连续运行多个测试用例时出现：

```
[DeviceManager] scrcpy pids after start: 0
[DeviceManager] device SO matches libscrcpy_server-6.2-20250926.so, but process failed to start
Failed to start scrcpy server (no SO version worked)
```

## 根本原因分析

### 1. 设备端进程清理不完整

**问题**: `stopScrcpy()` 只杀死本地 hdc 进程，依赖远程 shell 自动终止

```typescript
async stopScrcpy(): Promise<void> {
  if (this.scrcpyHdcProcess) {
    try { this.scrcpyHdcProcess.kill(); } catch {}
    this.scrcpyHdcProcess = null;
  }
  await this.portForward.releaseAll();
  this.scrcpyForwardPort = 0;
}
```

**风险**:
- hdc 进程被 kill 时，设备端 scrcpy 进程可能仍在运行
- 设备端可能有残留的 `singleness` 进程
- uitest daemon 状态未重置

### 2. uitest daemon "singleness" 模式的限制

**问题**: uitest 运行在单例模式，不支持并发

```
/system/bin/uitest start-daemon singleness --extension-name libscreen_casting.z.so
```

**风险**:
- 新启动请求可能被旧进程阻塞
- daemon 状态需要时间恢复
- 没有显式的 "stop-daemon" 命令

### 3. 端口转发清理时序

**问题**: `releaseAll()` 并行释放端口，没有等待确认

```typescript
async releaseAll(): Promise<void> {
  const releases = this.forwards.map(f => f.release());
  await Promise.allSettled(releases);
  this.forwards = [];
}
```

**风险**:
- hdc 命令是异步的，返回≠立即生效
- 短时间内重新创建相同端口可能失败

### 4. SO 文件版本冲突

**问题**: 多次推送不同版本 SO，设备端可能使用错误的版本

**风险**:
- 旧 SO 文件残留在设备上
- 版本匹配逻辑可能被绕过

## 生产环境影响评估

### ✅ 正常生产场景（低风险）

**特点**:
- 长连接（投屏会话持续分钟到小时级）
- 单设备单服务器
- 启动/停止频率低

**风险**: 低
- 进程有足够时间初始化
- 资源有足够时间释放
- 不会有频繁的状态切换

### ⚠️ 高频切换场景（中等风险）

**场景**:
- 多设备轮流投屏（如设备轮巡监控）
- 快速断线重连
- 热插拔设备

**风险**: 中等
- 需要在代码中添加冷却延迟
- 需要实现连接状态机

### 🚨 压力测试场景（高风险）

**场景**:
- 压力测试
- CI/CD 自动化测试
- 设备模拟器

**风险**: 高
- 需要实现设备端健康检查
- 需要添加强制清理机制

## 建议的改进措施

### 1. 增强设备端进程清理

```typescript
async stopScrcpy(): Promise<void> {
  // 1. 杀死本地 hdc 进程
  if (this.scrcpyHdcProcess) {
    try { this.scrcpyHdcProcess.kill(); } catch {}
    this.scrcpyHdcProcess = null;
  }

  // 2. 显式杀死设备端进程（新增）
  await this.killScrcpy();

  // 3. 等待进程完全退出（新增）
  await new Promise(resolve => setTimeout(resolve, 500));

  // 4. 释放端口转发
  await this.portForward.releaseAll();
  this.scrcpyForwardPort = 0;
}
```

### 2. 添加设备健康检查

```typescript
async isScrcpyHealthy(): Promise<boolean> {
  const pids = await this.getScrcpyPids();
  if (pids.length === 0) return false;

  // 检查进程是否能响应
  try {
    await this.hdc.shell('echo ping', 3);
    return true;
  } catch {
    return false;
  }
}

async ensureScrcpyStopped(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await this.killScrcpy();
    await new Promise(r => setTimeout(r, 500));
    const pids = await this.getScrcpyPids();
    if (pids.length === 0) return;
  }
  throw new Error('Failed to stop scrcpy after 5 attempts');
}
```

### 3. 连接状态机与冷却期

```typescript
enum ConnectionState {
  IDLE = 'idle',
  STARTING = 'starting',
  CONNECTED = 'connected',
  STOPPING = 'stopping',
  COOLDOWN = 'cooldown',
}

class ConnectionStateMachine {
  private state: ConnectionState = ConnectionState.IDLE;
  private lastStateChange: number = Date.now();
  private readonly COOLDOWN_MS = 3000; // 3秒冷却期

  canTransition(to: ConnectionState): boolean {
    const now = Date.now();
    const elapsed = now - this.lastStateChange;

    switch (this.state) {
      case ConnectionState.CONNECTED:
        return to === ConnectionState.STOPPING;
      case ConnectionState.STOPPING:
        return to === ConnectionState.COOLDOWN;
      case ConnectionState.COOLDOWN:
        return to === ConnectionState.IDLE && elapsed >= this.COOLDOWN_MS;
      case ConnectionState.IDLE:
        return to === ConnectionState.STARTING;
      case ConnectionState.STARTING:
        return to === ConnectionState.CONNECTED;
      default:
        return false;
    }
  }

  transition(to: ConnectionState): void {
    if (this.canTransition(to)) {
      this.state = to;
      this.lastStateChange = Date.now();
    } else {
      throw new Error(`Invalid transition: ${this.state} -> ${to}`);
    }
  }
}
```

### 4. 端口转发清理确认

```typescript
async releaseAll(): Promise<void> {
  // 1. 先发送所有移除命令
  const releases = this.forwards.map(f => f.release());
  await Promise.allSettled(releases);

  // 2. 等待 hdc 确认（新增）
  await new Promise(resolve => setTimeout(resolve, 200));

  // 3. 验证端口已释放（新增）
  const checkPromises = this.forwards.map(async (f) => {
    const result = await this.hdc.exec(`fport ls tcp:${f.localPort}`);
    if (result.includes(`tcp:${f.localPort}`)) {
      console.warn(`Port ${f.localPort} still in use, retrying...`);
      await f.release();
    }
  });
  await Promise.allSettled(checkPromises);

  this.forwards = [];
}
```

### 5. 集成测试改进

**方案 A**: 添加设备清理步骤

```typescript
beforeAll(async () => {
  // 清理设备上所有残留的 scrcpy 进程
  const hdc = new HdcClient({ hdcPath: 'hdc', sn: SN });
  await hdc.shell('killall -9 singleness 2>/dev/null', 5);
  await new Promise(r => setTimeout(r, 1000));
});
```

**方案 B**: 使用不同的测试设备

```typescript
// 为每个测试文件使用不同的端口，避免冲突
const PORTS = [19234, 19235, 19236, 19237];
```

**方案 C**: 串行运行测试

```bash
# 不并行运行集成测试
npx vitest run test/integration --no-parallel
```

## 监控建议

### 生产环境监控指标

1. **进程泄漏监控**
   ```typescript
   setInterval(async () => {
     const pids = await getScrcpyPids();
     if (pids.length > expected) {
       alert('Potential scrcpy process leak');
     }
   }, 30000);
   ```

2. **端口泄漏监控**
   ```typescript
   const result = await hdc.exec('fport ls');
   const activePorts = result.match(/tcp:(\d+)/g) || [];
   if (activePorts.length > expected) {
     alert('Potential port forward leak');
   }
   ```

3. **设备健康检查**
   ```typescript
   async healthCheck(): Promise<boolean> {
     try {
       await hdc.shell('echo ping', 3);
       return true;
     } catch {
       return false;
     }
   }
   ```

## 总结

| 场景 | 风险等级 | 建议措施 |
|------|----------|----------|
| 正常生产使用 | 🟢 低 | 现有机制足够 |
| 设备轮巡/多设备 | 🟡 中 | 添加冷却期、状态机 |
| 压力测试/CI | 🔴 高 | 实现设备健康检查、强制清理 |

**核心建议**:
1. ✅ 正常生产使用不受影响
2. ⚠️ 避免短时间内频繁启停（< 3秒间隔）
3. 🔧 实现优雅关闭和健康检查
4. 📊 监控设备端进程和端口数量
