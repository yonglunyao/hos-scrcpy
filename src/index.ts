export { HosScrcpyServer, getContentType } from './server';
export { DeviceManager, sprintf } from './device/application/device-manager';
export { DeviceFactory } from './device/factory';
export { HdcClient } from './device/hdc';
export { PortForwardManager } from './device/port-forward';
export { DeviceContext } from './device/context';
export { UitestServer } from './input/infrastructure/uitest-server';
export { DirectScrcpyStream } from './capture/direct-scrcpy';
export { getHdcKeyCode, KEY_CODE_MAP } from './input/keycode';
export {
  decodeReplyMessage,
  encodeEmpty,
  encodeGrpcMessage,
  decodeGrpcFrame,
  ParamValue,
  ReplyMessage,
  ReplyEndMessage,
} from './capture/protobuf';

// Re-export types from centralized types module
export type { ServerConfig, ScrcpyConfig, ScreenSize, HdcOptions } from './shared/types';

// Re-export interfaces
export type { IHdcClient, IDeviceManager, IUitestServer } from './device/interfaces';

// Re-export logger
export { logger, createChildLogger } from './shared/logger';

// MCP server
export { createMcpServer, runMcpServer } from './mcp';

// Screen model(UI 解析基础设施,供上层 agent 依赖)
export type { Element, ScreenModel, Locator } from './screen-model';
export { buildScreenModel, renderModel, resolveLocator, associateText } from './screen-model';

// Device primitives(设备原语契约 + 生产实现,供上层 agent 依赖注入)
export type { DevicePrimitives } from './mcp/device-primitives';
export { createMcpDevice } from './mcp/mcp-device';

// MCP session API(程序化设备会话:列设备/连接/断开/sleep,供上层 agent/spike 使用)
export { connectSession, disconnectSession, listDevices, sleep } from './mcp/session';
