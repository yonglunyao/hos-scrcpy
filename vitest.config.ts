import { defineConfig } from 'vitest/config';

// 显式 config 存在即阻断 vitest 向上查找 agent-auto-click-oh 的 vitest.config。
// 不设 include:用 vitest 默认(** 匹配 test/unit 根+子目录),配合命令行 --dir test/unit。
export default defineConfig({
  test: {},
});
