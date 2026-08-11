import type { ScreenModel } from '../screen-model';

/**
 * 设备原语接口(依赖注入)。生产由 mcp-device 实现,测试由 Fake 实现。
 * hos-scrcpy 暴露给上层(agent-auto-click)的设备会话契约。
 */
export interface DevicePrimitives {
  screenSize: { w: number; h: number };
  /** dump 当前屏 → ScreenModel(实现须更新 MVP 代际,保证后续 tapRef 代际校验通过)。 */
  dump(): Promise<ScreenModel>;
  /** 按 ref 触摸(代际校验由实现保证,MVP actByRef)。 */
  tapRef(ref: string): Promise<void>;
  /** 坐标兜底触摸(fallbackCoord)。 */
  tapCoord(x: number, y: number): Promise<void>;
  pressBack(): Promise<void>;
  launchApp(bundle: string, ability?: string): Promise<void>;
  /** 强制停止 app(冷启动回 root,绕开 launchApp 幂等不重置状态)。 */
  forceStop(bundle: string): Promise<void>;
  shell(cmd: string, timeoutSec?: number): Promise<string>;
  /** daemon 卡死/丢失时的恢复(kill + reconnect)。 */
  recover(): Promise<void>;
  /** 截图(CV/self-drawn 定位用);走 uitest screenCap 命令行 → pull → base64 → Buffer。 */
  screenshot(): Promise<Buffer>;
}
