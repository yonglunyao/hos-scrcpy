import type { Element } from '../screen-model';

export type SafetyReason = 'whitelist-navigate' | 'whitelist-view' | 'blacklist' | 'default-deny';

export interface SafetyVerdict {
  allow: boolean;
  reason: SafetyReason;
}

// 危险词(提交语义/不可逆)。词表待 spike 回填。
const BLACKLIST = /(支付|付款|删除|清除|清空|退出|注销|登出|拨号|呼叫|发送|发布|提交|确认|开通|绑定|授权|重置|恢复出厂|续费|转账|upgrade|delete|pay|submit|confirm|send|publish|reset|unbind)/i;

// type 导航类(覆盖纯图标页:Tab/导航/菜单)。
const WHITELIST_NAV_TYPE = /(^tab$|navigation|navigator|.*menu.*|bottombar|tabbar|^tabs?$)/i;

// text 探索目标类(只读场景常见入口)。控制类(返回/关闭/取消/我知道了)刻意排除。
const WHITELIST_VIEW_TEXT = /(首页|主页|我的|设置|更多|管理|详情|查看|展开|收起|全部|搜索|筛选|分类|上一页|下一页|关于|声音|显示|电池|存储|应用|通知)/;

/** 白名单为主 + 黑名单 + 默认拒(FAIL-SAFE)。纯函数。 */
export function classifySafety(el: Element): SafetyVerdict {
  const text = el.texts.join(' ');
  const type = el.attrs.type ?? '';
  if (BLACKLIST.test(text)) return { allow: false, reason: 'blacklist' };
  if (WHITELIST_NAV_TYPE.test(type)) return { allow: true, reason: 'whitelist-navigate' };
  if (WHITELIST_VIEW_TEXT.test(text)) return { allow: true, reason: 'whitelist-view' };
  return { allow: false, reason: 'default-deny' };
}
