/**
 * hos-scrcpy 统一错误类型定义
 *
 * 提供错误类型层次结构，便于错误处理和调试
 */

/**
 * 基础错误类 — 所有 hos-scrcpy 错误的父类
 */
export class HosScrcpyError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'HosScrcpyError';
  }
}

/**
 * 设备未找到错误
 */
export class DeviceNotFoundError extends HosScrcpyError {
  constructor(deviceSn: string) {
    super(`Device not found: ${deviceSn}`, 'DEVICE_NOT_FOUND');
    this.name = 'DeviceNotFoundError';
  }
}

/**
 * 连接超时错误
 */
export class ConnectionTimeoutError extends HosScrcpyError {
  constructor(operation: string, timeout: number) {
    super(`${operation} timeout after ${timeout}ms`, 'CONNECTION_TIMEOUT');
    this.name = 'ConnectionTimeoutError';
  }
}

/**
 * Scrcpy 启动失败错误
 */
export class ScrcpyStartupError extends HosScrcpyError {
  constructor(reason: string) {
    super(`Failed to start scrcpy: ${reason}`, 'SCRCPY_STARTUP_FAILED');
    this.name = 'ScrcpyStartupError';
  }
}

/**
 * 端口转发错误
 */
export class PortForwardError extends HosScrcpyError {
  constructor(operation: string, reason: string) {
    super(`Port forward ${operation} failed: ${reason}`, 'PORT_FORWARD_FAILED');
    this.name = 'PortForwardError';
  }
}

/**
 * UiTest 错误
 */
export class UiTestError extends HosScrcpyError {
  constructor(operation: string, reason: string) {
    super(`UiTest ${operation} failed: ${reason}`, 'UITEST_ERROR');
    this.name = 'UiTestError';
  }
}
