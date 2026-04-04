# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

```bash
npm run build       # tsc + copy SO assets to dist/
npm start           # node dist/bin/server.js
npm run dev         # ts-node src/bin/server.ts (development)
npm run ui          # start server + open web UI in browser
npx tsc --noEmit    # type-check only
```

CLI options: `--hdc <path>` (default: `hdc`), `--port <port>` (default: `9523`), `--templates <dir>`

Requires `hdc` (HarmonyOS Device Connector) on PATH or specified via `--hdc`. No test framework is configured.

## Architecture

hos-scrcpy is a TypeScript replacement for `demoWithoutRecord.jar` — a HarmonyOS screen casting server. It connects to HarmonyOS devices via HDC, loads native SO extensions into the uitest daemon, and streams H.264 video over WebSocket.

### Protocol Stack

```
Web Browser ←WebSocket→ HosScrcpyServer ←gRPC (h2c)→ uitest daemon (on device)
                                  ↑
                            TCP forward via HDC
```

- **HDC** (HarmonyOS Device Connector) = Android ADB equivalent. Handles device discovery, shell commands, file push, port forwarding.
- **uitest daemon** runs in "singleness" mode on device, loads SO extensions. Two sockets: `scrcpy_grpc_socket` (video) and `uitest_socket` (input control).
- **Port forwarding**: uitest < 6.0.2.1 uses `tcp:local:tcp:remote`; >= 6.0.2.1 uses `tcp:local:localabstract:<name>` (abstract unix socket).

### Source Layout

| Module | Purpose |
|--------|---------|
| `src/server.ts` | HTTP + WebSocket server, device lifecycle (`DeviceContext`), message routing |
| `src/device/hdc.ts` | HDC CLI wrapper (`shell`, `spawnShell`, `pushFile`, `fport`) |
| `src/device/manager.ts` | SO version matching (MD5), scrcpy process management, startup orchestration (`startScrcpyWithForward`) |
| `src/device/port-forward.ts` | Mutex-guarded `hdc fport` create/remove for TCP and abstract sockets |
| `src/capture/direct-scrcpy.ts` | **Active** gRPC client using Node.js `http2` (h2c prior knowledge). Parses 5-byte gRPC frames + hand-written protobuf. |
| `src/capture/scrcpy.ts` | Alternative gRPC client using `@grpc/grpc-js` (less reliable with HarmonyOS gRPC). |
| `src/capture/protobuf.ts` | Hand-written protobuf codec for `ReplyMessage`, `ParamValue`, `ReplyEndMessage` — no .proto compilation needed. |
| `src/input/uitest.ts` | TCP socket client to uitest agent. Plain JSON for input events; HEAD/TAIL framed JSON for layout queries. |
| `src/input/keycode.ts` | Browser key → HDC key code mapping |
| `src/bin/server.ts` | CLI entry point with auto-port-killing |
| `src/assets/so/` | Native libraries pushed to device (`libscrcpy_server-*.so`, `uitest_agent_*.so`) |

### Key Version Thresholds

- **uitest 6.0.2.1**: switches forwarding from TCP to abstract socket, changes SO selection (`SCRCPY_SEC_SO_LIST` vs `SCRCPY_SO_LIST`)
- **uitest 5.1.1.2**: oldest supported agent SO (`uitest_agent_1.1.3.so`)
- **uitest 5.1.1.3**: split version uses `uitest_agent_1.1.5.so`
- **agent 1.2.0**: determines whether uitest socket uses abstract forwarding (`isUseSecConnect`)

### WebSocket Protocol

Clients connect to `/ws/screen/{sn}` and send JSON:
- `{"type":"screen","sn":"...","remoteIp":"...","remotePort":"..."}` — start H.264 streaming
- `{"type":"uitest","sn":"..."}` — start image capture mode (2 FPS)
- `{"type":"touchEvent","sn":"...","message":{"event":"down|up|move","x":N,"y":N}}` — touch input
- `{"type":"keyCode","sn":"...","message":{"key":"HOME","code":"..."}}` — key press
- `{"type":"stop","sn":"..."}` — stop capture

Video frames are sent as raw binary WebSocket messages (H.264 NALUs extracted from protobuf `payload["data"].val_bytes`). Server sends `{ type: 'screenConfig', scale: N }` JSON message when stream is ready.

### gRPC Service (on device)

```
service ScrcpyService {
  rpc onStart(Empty) returns (stream ReplyMessage);       // H.264 video stream
  rpc onEnd(Empty) returns (ReplyEndMessage);              // stop recording
  rpc onRequestIDRFrame(Empty) returns (ReplyEndMessage);  // request keyframe
}
```

### Multi-Client Support

Multiple WebSocket clients can share one device's scrcpy stream. `DeviceContext` tracks clients and cleans up when the last one disconnects. A `startLock` Promise prevents concurrent scrcpy startup when multiple clients connect simultaneously.

### Touch Coordinate Mapping

Video is captured at `device_resolution / scale` (default scale=2). Touch coordinates from the video must be multiplied by `scale` to map to device screen coordinates. Server sends `{ type: 'screenConfig', scale }` on stream ready; frontend stores it and applies in `getVideoCoords()`.

### Key Event Routing

`uitest.pressKey()` only handles HOME (3) and BACK (4) via uitest agent API. All other keys (VOLUME, POWER, etc.) fall through to `uinput -K -d <code> -u <code>` shell command.

## Reference

The Java reference implementation lives at `../demoWithoutRecord/`. Key files for protocol verification:
- `HosRemoteDevice.java` — complete startup flow
- `UitestServer.java` — agent socket protocol
- `Scrcpy.java` / `test.proto` — protobuf definitions
- `HosRemoteConfig.java` — default parameters

Protocol documentation: `docs/scrcpy-protocol.md`
