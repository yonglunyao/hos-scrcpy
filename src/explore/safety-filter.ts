import type { Element } from '../screen-model';

export type SafetyReason = 'allow-all';

export interface SafetyVerdict {
  allow: boolean;
  reason: SafetyReason;
}

/**
 * 全放行(用户指令:去掉黑白名单)。Explorer 会点所有可点控件,含危险按钮(支付/删除/退出)。
 * 仅适合隔离测试设备。纯函数。恢复 FAIL-SAFE 过滤见 git 历史(黑白名单版本)。
 */
export function classifySafety(_el: Element): SafetyVerdict {
  return { allow: true, reason: 'allow-all' };
}
