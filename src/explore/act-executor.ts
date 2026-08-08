import type { Locator } from '../screen-model';
import { resolveLocator } from '../screen-model';
import { computeFingerprint, normalizeSkeleton, detectPopup, stripPopup } from '../page-graph';
import type { PopupInfo } from '../page-graph';
import type { DevicePrimitives, SenseResult } from './types';
import { LocatorUnresolved } from './types';
import { sleep } from '../mcp/session';

export interface ActExecutorOptions {
  stallMs?: number;          // 稳定检测两次 dump 间隔,默认 150
  maxStallTries?: number;    // senseStable 最大尝试,默认 3
}

export interface PerformResult {
  after: SenseResult;        // 落地页感知(含 model 供 Explorer 提 frontier)
  popup: PopupInfo | null;
  usedFallback: boolean;
}

/** 横切执行原语(spec §4.2):dump→stripPopup→指纹→resolveLocator→tap→核验。 */
export class ActExecutor {
  constructor(private dev: DevicePrimitives, private opts: ActExecutorOptions = {}) {}

  /** dump + 弹窗剥离 + 底层页指纹 + 规范化骨架(archive)。 */
  async sense(): Promise<SenseResult> {
    const m = await this.dev.dump();
    const input = { elements: m.elements, screenSize: this.dev.screenSize };
    const popup = detectPopup(input);
    const stripped = stripPopup(input);
    return { model: m, fingerprint: computeFingerprint(stripped), skeleton: normalizeSkeleton(stripped), popup };
  }

  /** 稳定检测:连续两次指纹一致(或耗尽 maxTries),防加载过渡态(spec §4.2)。 */
  async senseStable(maxTries?: number): Promise<SenseResult> {
    const tries = maxTries ?? this.opts.maxStallTries ?? 3;
    const stall = this.opts.stallMs ?? 150;
    let prev = await this.sense();
    for (let i = 1; i < tries; i++) {
      if (stall > 0) await sleep(stall);
      const cur = await this.sense();
      if (cur.fingerprint.skeletonHash === prev.fingerprint.skeletonHash) return cur;
      prev = cur;
    }
    return prev;
  }

  /** 基于已知 before(cur)解析+act+感知 after。before 由调用方传入,消除冗余 sense。 */
  async perform(cur: SenseResult, loc: Locator, fallbackCoord?: { x: number; y: number }): Promise<PerformResult> {
    const target = resolveLocator(cur.model, loc);
    let usedFallback = false;
    if (target) {
      await this.dev.tapRef(target.ref);
    } else if (fallbackCoord) {
      await this.dev.tapCoord(fallbackCoord.x, fallbackCoord.y);
      usedFallback = true;
    } else {
      throw new LocatorUnresolved(loc);
    }
    const after = await this.senseStable();
    return { after, popup: after.popup, usedFallback };
  }
}
