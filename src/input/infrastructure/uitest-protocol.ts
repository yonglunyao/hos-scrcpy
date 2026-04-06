/**
 * UiTest 协议编解码 — HEAD/TAIL 帧封装、请求构建
 */

export const HEAD = Buffer.from('_uitestkit_rpc_message_head_', 'utf-8');
export const TAIL = Buffer.from('_uitestkit_rpc_message_tail_', 'utf-8');
export const AUX_MAGIC = 1145141919;

export function buildGesturesRequest(api: string, args: Record<string, number>): string {
  return JSON.stringify({
    module: 'com.ohos.devicetest.hypiumApiHelper',
    method: 'Gestures',
    params: { api, args },
  });
}

export function buildModuleRequest(method: string, params: Record<string, unknown>): string {
  return JSON.stringify({
    module: 'com.ohos.devicetest.hypiumApiHelper',
    method,
    params,
  });
}

export function buildCallHypiumRequest(api: string, args: unknown): string {
  return JSON.stringify({
    module: 'com.ohos.devicetest.hypiumApiHelper',
    method: 'callHypiumApi',
    params: { api, args, this: 'Driver#0' },
  });
}

/**
 * 构建 HEAD/TAIL 帧用于布局查询
 */
export function buildLayoutFrame(request: string): Buffer {
  const body = Buffer.from(request, 'utf-8');
  const header = Buffer.alloc(4 + 4);
  header.writeUInt32BE(AUX_MAGIC, 0);
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([HEAD, header, body, TAIL]);
}

/**
 * 从 HEAD/TAIL 响应中提取 JSON 结果
 */
export function parseLayoutResponse(text: string): string {
  const startIdx = text.indexOf('{"result');
  const endIdx = text.indexOf('_uitestkit_rpc_message_tail_');
  if (startIdx >= 0 && endIdx > startIdx) {
    const jsonStr = text.substring(startIdx, endIdx);
    try {
      const resp = JSON.parse(jsonStr);
      if (resp.result) {
        return typeof resp.result === 'string' ? resp.result : JSON.stringify(resp.result);
      }
      return jsonStr;
    } catch {
      return text;
    }
  }
  return text;
}
