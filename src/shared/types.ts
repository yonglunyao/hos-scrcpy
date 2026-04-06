/**
 * hos-scrcpy 统一类型定义
 */

/**
 * 服务器配置
 */
export interface ServerConfig {
  host?: string;
  port?: number;
  hdcPath?: string;
  templatesDir?: string;
}

/**
 * Scrcpy 配置
 */
export interface ScrcpyConfig {
  sn: string;
  ip?: string;
  hdcPath?: string;
  hdcPort?: number;
  scale?: number;
  frameRate?: number;
  bitRate?: number; // in Mbps
  port?: number; // device-side scrcpy port
  screenId?: number;
  windowsId?: string;
  appPid?: string;
  encoderType?: string;
  iFrameInterval?: number;
  repeatInterval?: number;
  extensionName?: string;
  imageScaleSize?: number;
}

/**
 * 屏幕尺寸
 */
export interface ScreenSize {
  width: number;
  height: number;
}

/**
 * HDC 客户端配置
 */
export interface HdcOptions {
  hdcPath: string;
  ip?: string;
  sn: string;
  port?: number; // hdc port, default 8710
}
