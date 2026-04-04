# HarmonyOS Scrcpy Protocol Documentation

## Overview

HarmonyOS Scrcpy (Screen Copy) is a protocol for capturing and streaming device screen content. This document describes the protocol as implemented in `demoWithoutRecord.jar`.

## Architecture

```
┌─────────────────┐     WebSocket      ┌──────────────────────────┐
│   Web Client    │ ◄──────────────►  │   WebSocket Server       │
└─────────────────┘                    └──────────────────────────┘
                                               │
                                               │ gRPC
                                               │
                                               ▼
                                   ┌──────────────────────────┐
                                   │   Scrcpy Service (gRPC)  │
                                   └──────────────────────────┘
                                               │
                                               │ HDC Port Forward
                                               │
                                               ▼
                                   ┌──────────────────────────┐
                                   │   Device (HarmonyOS)     │
                                   │   - libscreen_casting    │
                                   │   - scrcpy socket        │
                                   └──────────────────────────┘
```

## Protocol Specification

### gRPC Service Definition

```proto
syntax = "proto3";
package ScrcpyService;

message Empty {}

message ParamValue {
  oneof values {
    int64 val_int = 1;
    double val_double = 2;
    string val_string = 3;
    bool val_bool = 4;
    bytes val_bytes = 5;
    float val_float = 6;
  }
}

message ReplyMessage {
  string data = 1;
  int32 reply_type = 2;
  map<string, ParamValue> payload = 3;
}

message ReplyEndMessage {
  int32 result = 1;
}

service ScrcpyService {
  rpc onStart(Empty) returns (stream ReplyMessage);
  rpc onEnd(Empty) returns (ReplyEndMessage);
  rpc onRequestIDRFrame(Empty) returns (ReplyEndMessage);
}
```

### Service Methods

#### 1. onStart (Server Streaming)

**Request**: `Empty` message (empty protobuf)

**Response**: Stream of `ReplyMessage` messages

Each `ReplyMessage` contains:
- `data`: String field (metadata)
- `reply_type`: Integer (message type)
- `payload`: Map containing the actual H.264 video data

The H.264 video data is stored in `payload["data"].val_bytes` as a `ByteString`.

#### 2. onEnd (Unary)

**Request**: `Empty` message

**Response**: `ReplyEndMessage` with `result` status code

#### 3. onRequestIDRFrame (Unary)

**Request**: `Empty` message

**Response**: `ReplyEndMessage` with `result` status code

Used to request an IDR (Instantaneous Decoder Refresh) frame from the device.

## Data Flow

### 1. WebSocket Protocol (Client → Server)

#### Screen Cast Request

```json
{
  "type": "screen",
  "sn": "DEVICE_SERIAL_NUMBER",
  "remoteIp": "127.0.0.1",
  "remotePort": "8710",
  "message": {
    "bitrate": 2000000,
    "fps": 15,
    "resolution": "1080p"
  }
}
```

#### UiTest Image Cast Request

```json
{
  "type": "uitest",
  "sn": "DEVICE_SERIAL_NUMBER",
  "remoteIp": "127.0.0.1",
  "remotePort": "8710"
}
```

#### Touch Event

```json
{
  "type": "touchEvent",
  "sn": "DEVICE_SERIAL_NUMBER",
  "message": {
    "event": "down|up|move",
    "x": 100,
    "y": 200
  }
}
```

#### Key Event

```json
{
  "type": "keyCode",
  "sn": "DEVICE_SERIAL_NUMBER",
  "message": {
    "key": "HOME",
    "code": "HOME"
  }
}
```

#### Stop Cast

```json
{
  "type": "stop",
  "sn": "DEVICE_SERIAL_NUMBER"
}
```

### 2. WebSocket Response (Server → Client)

**Video Mode**: Raw H.264 bytes sent directly via WebSocket binary messages.

**UiTest Mode**: Base64-encoded JSON response:

```json
{
  "type": "data",
  "data": "BASE64_ENCODED_IMAGE"
}
```

## Device Initialization Flow

### Step 1: Check Device Online

```bash
hdc -s 127.0.0.1:8710 list targets
```

### Step 2: Start UiTest Daemon

```bash
/system/bin/uitest start-daemon singleness --extension-name libscreen_casting.z.so -p 5000 &
```

### Step 3: Verify Extension MD5

```bash
md5sum /data/local/tmp/libscreen_casting.z.so
```

Compare against known library MD5 values:
- `libscrcpy/libscrcpy_server1.z.so`
- `libscrcpy/libscrcpy_server2.z.so`
- `libscrcpy/libscrcpy_server3.z.so`
- `libscrcpy/libscrcpy_server-5.8-20250925.so`
- `libscrcpy/libscrcpy_server-6.2-20250926.so` (for uitest >= 6.0.2.1)

### Step 4: Create Port Forward

**Standard Mode**:
```bash
hdc -s 127.0.0.1:8710 -t DEVICE_SN fport tcp:LOCAL_PORT tcp:5000
```

**Secure Mode** (uitest >= 6.0.2.1):
```bash
hdc -s 127.0.0.1:8710 -t DEVICE_SN fport tcp:LOCAL_PORT localabstract:scrcpy_grpc_socket
```

### Step 5: Establish gRPC Channel

```
dns:///127.0.0.1:LOCAL_PORT
```

Channel options:
- `usePlaintext()` - No TLS
- `maxInboundMessageSize(104857600)` - 100MB max message size

### Step 6: Start Video Stream

Call `onStart(Empty)` - returns stream of `ReplyMessage` with H.264 data in `payload["data"].val_bytes`.

## gRPC vs Java Implementation

### Why @grpc/grpc-js Fails

The Java implementation uses a **Blocking Stub** with direct iteration:

```java
this.stub = ScrcpyServiceGrpc.newBlockingStub(build);
this.responses = this.stub.onStart(Scrcpy.Empty.getDefaultInstance());

while (this.responses.hasNext()) {
    Scrcpy.ReplyMessage message = this.responses.next();
    ByteString byteString = message.getPayloadMap().get("data").getValBytes();
    ByteBuffer byteBuffer = ByteBuffer.wrap(byteString.toByteArray());
    capCallback.onData(byteBuffer);
}
```

The Node.js `@grpc/grpc-js` library uses an **Async Observer pattern**:

```typescript
const call = this.client.makeServerStreamRequest(
  '/ScrcpyService/onStart',
  () => Buffer.alloc(0),
  (buf: Buffer) => buf,
  {}
);
call.on('data', (data) => { /* handler */ });
```

**The Issue**: HarmonyOS gRPC server may send responses in a way that `@grpc/grpc-js` doesn't recognize. The Java implementation's direct iterator works because it pulls data synchronously, while the Node.js library expects proper gRPC stream framing.

## Port Forwarding Types

### TCP Forwarding (Legacy)

Used when uitest version < 6.0.2.1:

```bash
hdc fport tcp:LOCAL_PORT tcp:DEVICE_PORT
```

The device listens on a TCP port (default 5000).

### Abstract Socket Forwarding (Modern)

Used when uitest version >= 6.0.2.1:

```bash
hdc fport tcp:LOCAL_PORT localabstract:scrcpy_grpc_socket
```

The device uses a Unix abstract socket `scrcpy_grpc_socket`.

**Check if abstract socket exists**:
```bash
cat /proc/net/unix | grep scrcpy_grpc_socket
```

## Video Data Format

- **Codec**: H.264 (AVC)
- **Container**: Raw H.264 NAL units
- **Transmission**: gRPC protobuf `ReplyMessage.payload["data"].val_bytes`
- **Typical frame size**: 30-50 KB per frame
- **Typical frame rate**: 60 FPS (configurable)

## Input Control

### Touch Events

Via `uinput` command:

```bash
uinput -M -m 100 100 120 100 1000 --trace
```

Coordinates are scaled by 2 in the Java implementation.

### Key Events

```bash
uinput -K -d KEY_CODE -u KEY_CODE
```

Key codes are mapped from browser key names to HDC key codes (see full mapping in source).

## Error Handling

### Common Failure Modes

1. **Device not online**: Check device list with `hdc list targets`
2. **Wrong libscrcpy version**: MD5 mismatch, need to push correct library
3. **Port forward failure**: Check if port is already in use
4. **gRPC stream timeout**: Abstract socket not ready
5. **uitest daemon not running**: Start daemon before creating forward

### Retry Strategy

The Java implementation retries with different scrcpy libraries:
1. Check device MD5
2. If mismatch, try each library in sequence
3. Push library if needed
4. Restart scrcpy process

## Key Code Locations in demoWithoutRecord.jar

| Class | Purpose |
|-------|---------|
| `p000.MyWebSocketServer` | WebSocket server handling client connections |
| `com.huawei.hosscrcpy.api.HosRemoteDevice` | Main device interaction logic |
| `com.huawei.hosscrcpy.protocol.ScrcpyServiceGrpc` | gRPC service definitions |
| `com.huawei.hosscrcpy.api.UitestServer` | UiTest image capture |
| `com.huawei.hosscrcpy.utils.ProcessExecutor` | HDC command execution |

## TypeScript Implementation Notes

### Critical Differences

1. **gRPC Library**: `@grpc/grpc-js` vs Java's `grpc-java`
2. **Async vs Sync**: Node.js uses callbacks/promises, Java uses blocking calls
3. **Buffer Handling**: `ByteBuffer` vs `Buffer`
4. **Channel Creation**: DNS target string vs Java's builder pattern

### Recommended Approach for TypeScript

1. **Try BlockingStub Pattern**: Find or implement a blocking stub for Node.js
2. **Manual gRPC**: Implement raw HTTP/2 framing to bypass library issues
3. **Direct TCP**: Connect directly to forwarded port and handle protobuf manually
4. **Alternative**: Use UiTest image mode as fallback (2 FPS, JSON UI layout)