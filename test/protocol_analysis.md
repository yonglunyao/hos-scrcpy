# hos-scrcpy 协议分析报告

## 测试结果总结

### 1. gRPC 库兼容性测试

| 方法 | 结果 | 详情 |
|------|------|------|
| @grpc/grpc-js | ❌ 失败 | 连接成功，但从未触发 'data' 事件 |
| Direct TCP (DirectScrcpyStream) | ⚠️ 部分成功 | 接收到 46 字节初始消息，随后连接关闭 |

### 2. 原始数据分析

接收到的 46 字节数据：
```
000018040000000000000400400000000500400000000600004000fe0300000001000004080000000000003f0001
```

数据结构解析：
```
[00] 00001804 : 0   0  24   4  (可能是魔数/版本)
[04] 00000000 : 0   0   0   0  (填充)
[08] 00000400 : 0   0   4   0  (1024? 可能是宽度相关)
[12] 40000000 : 64  0   0   0
[16] 05004000 : 5   0  64   0
[20] 00000600 : 0   0   6   0
[24] 004000fe : 0  64   0 254
[28] 03000000 : 3   0   0   0
[32] 01000004 : 1   0   0   4
[36] 08000000 : 8   0   0   0
[40] 0000003f : 0   0   0  63
[44] 0001     : 0   1
```

Protobuf 解码结果：
- `data=""` (空)
- `replyType=0`
- `payload={}` (空 map)

### 3. 问题诊断

**核心问题**: HarmonyOS scrcpy gRPC 服务器与标准 gRPC 客户端不兼容

可能原因：
1. HarmonyOS 使用了修改版的 gRPC 协议
2. 需要特定的请求头/元数据
3. HTTP/2 实现与标准不兼容
4. 初始 46 字节消息需要特定响应后才会发送视频流

### 4. scrcpy 启动命令

```
/system/bin/uitest start-daemon singleness --extension-name libscreen_casting.z.so \
  -scale 2 -frameRate 60 -bitRate 8388608 -p 5000 -screenId 0 -encodeType 0 \
  -iFrameInterval 500 -repeatInterval 33
```

### 5. 解决方案建议

#### 方案 A: 使用 demoWithoutRecord.jar 作为代理
- 启动 demoWithoutRecord.jar 的 WebSocket 服务器
- hos-scrcpy 连接到 demoWithoutRecord.jar
- 让 Java 代码处理 gRPC 通信

#### 方案 B: 实现 Java gRPC 客户端模块
- 使用 Java 实现 gRPC 客户端
- 通过 JNI 或进程间通信与 Node.js 通信
- 保持 TypeScript 服务器的架构

#### 方案 C: 反向工程协议
- 使用 Wireshark 或类似工具捕获 demoWithoutRecord.jar 的通信
- 分析完整的请求/响应格式
- 在 TypeScript 中重新实现

#### 方案 D: 使用 uitest 图像模式（备选）
- 不使用视频流，而是定期捕获屏幕截图
- 通过 uitest.captureScreen() 获取图像
- 实现较低帧率的投屏

### 6. 下一步行动

1. 检查 demoWithoutRecord.jar 是否可复用
2. 如果可用，实现方案 A（最快捷）
3. 如果不可用，考虑方案 C（逆向工程）

## 结论

hos-scrcpy 当前无法直接从 HarmonyOS scrcpy 服务器获取视频流，需要额外的适配层或协议解析。
