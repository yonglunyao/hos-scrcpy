/**
 * hos-scrcpy MCP server — 把 HarmonyOS 设备控制能力暴露为 LLM agent 工具。
 *
 * 设计:
 *  - 不引入视频流;agent 基于截图(uitest screenCap)决策。
 *  - 全程设备坐标系(不碰 WebSocket 路径的 scale 缩放)。
 *  - 与 Web 投屏路径同源:触摸/按键复用 UitestServer(socket),
 *    不另起炉灶;仅布局因 socket getLayout 在部分 agent 版本无响应,改用 uitest dumpLayout。
 *  - 单活动设备会话,见 ./session。
 *
 * 工具描述(description)为中文、面向 agent:说明用途、前置条件、坐标来源、与其他工具的衔接。
 *
 * 用法(编程式):
 *   import { createMcpServer } from 'hos-scrcpy';
 *   const server = createMcpServer();
 *   await server.connect(new StdioServerTransport());
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getHdcKeyCode } from '../input/keycode';
import { UINPUT_TOUCH_TIMEOUT_SEC } from '../constants';
import {
  actByRef,
  captureScreenshot,
  captureScreenModel,
  connectSession,
  disconnectSession,
  exportScript,
  findByLocator,
  getSession,
  importScript,
  listDevices,
  requireSession,
  replayActions,
  sleep,
  startReplayActions,
  startRecord,
  stopRecord,
  stopReplayActions,
} from './session';
import type { Locator } from '../screen-model';

const READ_ONLY = { readOnlyHint: true } as const;
const DESTRUCTIVE = { destructiveHint: true } as const;

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

const SWIPE_STEP_MS = 16;

const actionSchema = z.object({
  op: z.string().describe('click/doubleClick/longClick/fling/drag'),
  x: z.number().int(),
  y: z.number().int(),
  x2: z.number().int().optional(),
  y2: z.number().int().optional(),
  velocity: z.number().int().optional(),
});

const locatorSchema = z.object({
  text: z.string().optional(),
  textMode: z.enum(['equals', 'contains', 'regex']).optional(),
  hint: z.string().optional(),
  index: z.number().int().optional(),
  enabled: z.boolean().optional(),
});

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'hos-scrcpy-mcp', version: '1.0.0' });

  // ── 设备发现与会话 ──

  server.registerTool(
    'list_devices',
    {
      description:
        '列出 hdc 已连接的 HarmonyOS 设备序列号(sn)。无设备时返回空数组。' +
        '通常是自动化流程的第一步——用返回的 sn 调用 connect_device 建立会话。',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const devices = await listDevices();
      return text(JSON.stringify({ count: devices.length, devices }, null, 2));
    },
  );

  server.registerTool(
    'connect_device',
    {
      description:
        '连接指定设备并启动控制会话(启动 uitest daemon + 建立 socket)。' +
        '在使用截图/布局/触摸/按键等任何控制工具之前必须调用一次。' +
        '幂等:已连接时自动断开重连。sn 取自 list_devices。',
      inputSchema: { sn: z.string().describe('设备序列号(来自 list_devices)') },
      annotations: DESTRUCTIVE,
    },
    async ({ sn }) => {
      await connectSession(sn);
      return text(`已连接设备 ${sn},现在可以使用截图/控制工具。`);
    },
  );

  server.registerTool(
    'disconnect_device',
    {
      description:
        '断开当前设备,释放 uitest 会话与端口转发。任务结束后调用;' +
        '断开后需重新 connect_device 才能继续控制。无活动会话时安全返回。',
      inputSchema: {},
      annotations: DESTRUCTIVE,
    },
    async () => {
      const sn = getSession()?.sn;
      await disconnectSession();
      return text(sn ? `已断开设备 ${sn}。` : '没有活动会话可断开。');
    },
  );

  // ── 信息 / 只读 ──

  server.registerTool(
    'device_info',
    {
      description:
        '查询当前设备:在线状态、屏幕分辨率(width x height,设备坐标系)、uitest 版本、是否云设备。' +
        '用于换算坐标前确认屏幕尺寸,或在操作前确认设备就绪。',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const { device } = requireSession();
      const [online, screenSize, uitestVersion, isCloud] = await Promise.all([
        device.isOnline(),
        device.getScreenSize().catch(() => ({ width: 0, height: 0 })),
        device.getUitestVersion().catch(() => 'unknown'),
        device.isCloudDevice().catch(() => false),
      ]);
      return text(
        JSON.stringify(
          { sn: device.getSn(), online, screenSize, uitestVersion, isCloudDevice: isCloud },
          null,
          2,
        ),
      );
    },
  );

  server.registerTool(
    'take_screenshot',
    {
      description:
        '截取当前屏幕,返回全分辨率 PNG 图像(设备坐标,不缩放)。' +
        '适合用视觉判断界面状态、定位元素。若要拿到可点击元素的精确坐标,用 dump_ui 更直接。',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const shot = await captureScreenshot();
      return {
        content: [{ type: 'image' as const, data: shot.base64, mimeType: shot.mimeType }],
      };
    },
  );

  server.registerTool(
    'dump_ui',
    {
      description:
        '【感知·快照】dump 当前屏幕为统一模型,返回 @eN 引用的元素列表(可点击控件+text,省坐标)。' +
        '每行格式 @eN#sN [type] text → 相关text。用 act("@eN#sN","click") 操作引用,find 查找特定元素。' +
        'format=compact(默认,给agent看)/json(结构化,含 bounds)。@eN 跨 dump 失效,操作后需重新 dump_ui。',
      inputSchema: {
        format: z.enum(['compact', 'json']).default('compact').describe('输出格式'),
      },
      annotations: READ_ONLY,
    },
    async ({ format }) => {
      const { model, render } = await captureScreenModel();
      if (format === 'json') {
        return text(
          JSON.stringify(
            { generation: model.generation, count: model.elements.length, elements: model.elements },
            null,
            2,
          ),
        );
      }
      return text(render);
    },
  );

  server.registerTool(
    'act',
    {
      description:
        '【操作·引用】用 dump_ui 返回的 @eN#sN 引用操作元素(免坐标)。op:click/longClick/doubleClick。' +
        'ref 必须来自最近一次 dump_ui(跨 dump 失效,过期会报错提示重 dump)。',
      inputSchema: {
        ref: z.string().describe('dump_ui 返回的 @eN#sN 引用'),
        op: z.enum(['click', 'longClick', 'doubleClick']).describe('操作类型'),
        duration_ms: z.number().int().min(50).max(10000).default(800).describe('longClick 时长(毫秒)'),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ ref, op, duration_ms }) => text(await actByRef(ref, op, duration_ms)),
  );

  server.registerTool(
    'find',
    {
      description:
        '【查找】按 Locator(text/hint/index/enabled)在当前屏幕模型查找元素,返回其 @eN#sN 引用(供 act 使用)。' +
        '用于 dump_ui 渲染被截断/视口外的元素。需先 dump_ui 建立模型。',
      inputSchema: { locator: locatorSchema },
      annotations: READ_ONLY,
    },
    async ({ locator }) => text(findByLocator(locator as Locator)),
  );

  // ── 触摸 / 手势(复用 UitestServer socket,与 Web 同源) ──

  server.registerTool(
    'tap',
    {
      description:
        '【设备操作·点击】在设备坐标 (x, y) 点击屏幕(这是"点击设备",不是录制/回放控制)。' +
        '坐标为设备像素(非视频缩放坐标),取自 dump_ui 元素的 center 或由截图估算。需先 connect_device。',
      inputSchema: {
        x: z.number().int().describe('设备 X 坐标'),
        y: z.number().int().describe('设备 Y 坐标'),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ x, y }) => {
      const { uitest } = requireSession();
      await uitest.touchDown(x, y);
      await uitest.touchUp(x, y);
      return text(`已点击 (${x}, ${y})。`);
    },
  );

  server.registerTool(
    'long_press',
    {
      description:
        '在 (x, y) 长按 duration_ms 毫秒,用于触发长按菜单、拖拽预备等。坐标含义同 tap。',
      inputSchema: {
        x: z.number().int(),
        y: z.number().int(),
        duration_ms: z.number().int().min(50).max(10000).default(800).describe('长按时长(毫秒)'),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ x, y, duration_ms }) => {
      const { uitest } = requireSession();
      await uitest.touchDown(x, y);
      await sleep(duration_ms);
      await uitest.touchUp(x, y);
      return text(`已在 (${x}, ${y}) 长按 ${duration_ms}ms。`);
    },
  );

  server.registerTool(
    'swipe',
    {
      description:
        '从 (x1, y1) 滑动到 (x2, y2),耗时 duration_ms 毫秒。用于滚动列表、翻页、滑动解锁、手势导航等。' +
        '方向参考:左滑 x1>x2、右滑 x1<x2、上滑 y1>y2、下滑 y1<y2。坐标为设备像素。',
      inputSchema: {
        x1: z.number().int(),
        y1: z.number().int(),
        x2: z.number().int(),
        y2: z.number().int(),
        duration_ms: z.number().int().min(50).max(10000).default(400).describe('滑动时长(毫秒)'),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ x1, y1, x2, y2, duration_ms }) => {
      const { uitest } = requireSession();
      const steps = Math.max(2, Math.round(duration_ms / SWIPE_STEP_MS));
      await uitest.touchDown(x1, y1);
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        await uitest.touchMove(Math.round(x1 + (x2 - x1) * t), Math.round(y1 + (y2 - y1) * t));
        await sleep(duration_ms / steps);
      }
      await uitest.touchUp(x2, y2);
      return text(`已从 (${x1},${y1}) 滑动到 (${x2},${y2}),耗时 ${duration_ms}ms。`);
    },
  );

  // ── 文本 / 按键 ──

  server.registerTool(
    'input_text',
    {
      description:
        '先点击 (x, y) 聚焦输入框,再输入文本 text。坐标必须提供(用 dump_ui 找到对应输入元素的 center)。' +
        '用于在搜索框/登录框等输入内容。注意:text 内不要包含双引号。',
      inputSchema: {
        text: z.string().describe('要输入的文本(不含双引号)'),
        x: z.number().int().describe('输入框 X 坐标'),
        y: z.number().int().describe('输入框 Y 坐标'),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ text: content, x, y }) => {
      const { uitest } = requireSession();
      await uitest.touchDown(x, y);
      await uitest.touchUp(x, y);
      await sleep(200);
      await uitest.inputText(x, y, content);
      return text(`已在 (${x}, ${y}) 输入 ${content.length} 个字符。`);
    },
  );

  server.registerTool(
    'press_key',
    {
      description:
        '按硬件键。key 为键名,常用:HOME、BACK、VOLUME_UP、VOLUME_DOWN、POWER、ENTER、ESCAPE、MENU、TAB、SPACE,' +
        '以及数字 0-9、字母 A-Z 等(完整见 KEY_CODE_MAP)。HOME/BACK 走 uitest,其余走 uinput。未知键名会报错。',
      inputSchema: { key: z.string().describe('键名,如 HOME / BACK / VOLUME_UP') },
      annotations: DESTRUCTIVE,
    },
    async ({ key }) => {
      const { uitest, device } = requireSession();
      const code = getHdcKeyCode(key);
      if (code === null) {
        throw new Error(`未知按键: ${key}。可用 HOME、BACK、VOLUME_UP、VOLUME_DOWN、POWER、ENTER、ESCAPE 等。`);
      }
      const handled = await uitest.pressKey(code);
      if (!handled) {
        await device.shell(`uinput -K -d ${code} -u ${code}`, UINPUT_TOUCH_TIMEOUT_SEC);
      }
      return text(`已按 ${key}(码 ${code},经 ${handled ? 'uitest' : 'uinput'})。`);
    },
  );

  server.registerTool(
    'home',
    { description: '按 HOME 键回到桌面。等价 press_key("HOME")。', inputSchema: {}, annotations: DESTRUCTIVE },
    async () => {
      const { uitest } = requireSession();
      await uitest.pressKey(3);
      return text('已按 HOME。');
    },
  );

  server.registerTool(
    'back',
    { description: '按 BACK 键返回上一级。等价 press_key("BACK")。', inputSchema: {}, annotations: DESTRUCTIVE },
    async () => {
      const { uitest } = requireSession();
      await uitest.pressKey(4);
      return text('已按 BACK。');
    },
  );

  // ── 应用 / 系统 ──

  server.registerTool(
    'launch_app',
    {
      description:
        '用 aa start 启动应用。bundle=包名(如 com.example.app),ability=Ability 名(默认 EntryAbility,多数应用适用)。' +
        '用于拉起指定应用;若不知 ability 名,用默认值即可。',
      inputSchema: {
        bundle: z.string().describe('应用包名,如 com.example.app'),
        ability: z.string().default('EntryAbility').describe('Ability 名(默认 EntryAbility)'),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ bundle, ability }) => {
      const { device } = requireSession();
      await device.shell(`aa start -a ${ability} -b ${bundle}`);
      return text(`已启动 ${bundle}/${ability}。`);
    },
  );

  server.registerTool(
    'run_shell',
    {
      description:
        '在设备上执行任意 hdc shell 命令,返回 stdout/stderr 合并。功能强大但有风险,' +
        '仅用于抓日志、查进程、改系统设置等截图/布局/触摸工具做不到的场景。' +
        '不要用它替代 tap/swipe 等专用工具(后者更快更可靠)。可选 timeout_sec 限定超时(1-120 秒)。',
      inputSchema: {
        command: z.string().describe('要在设备执行的 shell 命令'),
        timeout_sec: z.number().int().min(1).max(120).optional().describe('超时(秒)'),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ command, timeout_sec }) => {
      const { device } = requireSession();
      const output = await device.shell(command, timeout_sec);
      return text(output || '(无输出)');
    },
  );

  server.registerTool(
    'push_file',
    {
      description: '推送本地文件到设备(hdc file send)。local_path=宿主机路径,remote_path=设备路径。用于传脚本/配置/安装包等。',
      inputSchema: {
        local_path: z.string().describe('宿主机本地文件路径'),
        remote_path: z.string().describe('设备目标路径'),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ local_path, remote_path }) => {
      const { device } = requireSession();
      await device.getHdc().pushFile(local_path, remote_path);
      return text(`已推送 ${local_path} -> ${remote_path}。`);
    },
  );

  server.registerTool(
    'pull_file',
    {
      description: '从设备拉取文件到本地(hdc file recv)。remote_path=设备路径,local_path=宿主机保存路径。用于取日志/截图/应用数据等。',
      inputSchema: {
        remote_path: z.string().describe('设备源文件路径'),
        local_path: z.string().describe('宿主机保存路径'),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ remote_path, local_path }) => {
      const { device } = requireSession();
      await device.getHdc().pullFile(remote_path, local_path);
      return text(`已拉取 ${remote_path} -> ${local_path}。`);
    },
  );

  // ── 脚本录制 / 回放(复用系统 uiRecord + uiInput) ──

  server.registerTool(
    'start_record',
    {
      description:
        '【录制·启动】启动系统 UI 录制(注意:这是"开始录制脚本",不是点击设备,也不是回放)。' +
        '录制期间设备上的操作(手动或 tap/swipe 注入)会被记录。需先 connect_device;同一时间只能一个录制。流程:start_record → 操作 → stop_record。',
      inputSchema: {},
      annotations: DESTRUCTIVE,
    },
    async () => {
      await startRecord();
      return text('录制已启动。现在操作设备(手动或用 tap/swipe),完成后调用 stop_record 取回操作列表。');
    },
  );

  server.registerTool(
    'stop_record',
    {
      description:
        '【录制·停止】停止录制,解析系统 record.csv 返回操作列表(注意:这是"结束录制",不是点击或回放)。' +
        '每步含 op(click/fling/drag 等)与坐标。该列表可传给 replay/start_replay 回放,或保存复用。',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const actions = await stopRecord();
      return text(JSON.stringify({ count: actions.length, actions }, null, 2));
    },
  );

  server.registerTool(
    'replay',
    {
      description:
        '【回放·同步】按顺序回放操作列表(一次执行完,不可中断;区别于 start_replay 的可控回放)。' +
        '每步映射到系统 uitest uiInput 执行。actions 来自 stop_record、手写或导入。op 支持:click/doubleClick/longClick/fling/drag。',
      inputSchema: {
        actions: z.array(actionSchema).describe('操作列表(来自 stop_record 或手写)'),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ actions }) => {
      const cmds = await replayActions(actions);
      return text(`已回放 ${cmds.length} 步:\n${cmds.join('\n')}`);
    },
  );

  server.registerTool(
    'export_script',
    {
      description:
        '把操作列表导出为本地 JSON 文件,可保存复用、手写编辑、版本管理、跨工具兼容。' +
        'actions 来自 stop_record;path 为宿主机保存路径(如 ./login.json)。',
      inputSchema: {
        actions: z.array(actionSchema).describe('要导出的操作列表'),
        path: z.string().describe('宿主机保存路径,如 ./login.json'),
      },
      annotations: READ_ONLY,
    },
    async ({ actions, path: p }) => {
      exportScript(actions, p);
      return text(`已导出 ${actions.length} 步到 ${p}`);
    },
  );

  server.registerTool(
    'start_replay',
    {
      description:
        '【回放·启动】启动可控回放(后台异步、可被 stop_replay 中断;注意:这是"开始回放脚本",不是点击或录制)。' +
        '入参二选一:actions 直接传操作列表,或 path 从本地脚本文件导入(简化 JSON 或系统 csv)。' +
        '同一时刻仅一个回放。文件格式与 export_script 导出的一致。',
      inputSchema: {
        actions: z.array(actionSchema).optional().describe('操作列表(与 path 二选一)'),
        path: z.string().optional().describe('脚本文件路径(与 actions 二选一)'),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ actions, path: p }) => {
      const list = actions ?? (p ? importScript(p) : undefined);
      if (!list || list.length === 0) {
        throw new Error('需提供 actions 或 path(且非空)');
      }
      startReplayActions(list);
      return text(`已启动可控回放 ${list.length} 步(后台执行),用 stop_replay 中断。`);
    },
  );

  server.registerTool(
    'stop_replay',
    {
      description: '【回放·停止】停止正在进行的可控回放(由 start_replay 启动;注意:这是"停止回放",不是停止录制 stop_record)。',
      inputSchema: {},
      annotations: DESTRUCTIVE,
    },
    async () => {
      await stopReplayActions();
      return text('已停止回放。');
    },
  );

  return server;
}

/** 启动 stdio MCP server(进程级入口使用)。 */
export async function runMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
