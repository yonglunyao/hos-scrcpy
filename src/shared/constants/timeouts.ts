/** HTTP/2 和 gRPC */
export const HTTP2_CONNECT_TIMEOUT_MS = 10000;
export const HTTP2_INITIAL_WINDOW_SIZE = 16 * 1024 * 1024; // 16MB
export const GRPC_MAX_RECEIVE_MESSAGE_LENGTH = 104857600; // 100MB

/** HDC 命令默认超时 */
export const HDC_EXEC_DEFAULT_TIMEOUT_SEC = 8;
export const HDC_SHELL_DEFAULT_TIMEOUT_SEC = 8;
export const HDC_PUSH_FILE_TIMEOUT_SEC = 30;
export const HDC_PULL_FILE_TIMEOUT_SEC = 30;

/** 设备操作超时 */
export const UITEM_PIDS_TIMEOUT_SEC = 5;
export const UITEM_VERSION_TIMEOUT_SEC = 5;
export const UITEM_TYPE_CHECK_TIMEOUT_SEC = 5;
export const UITEM_START_TIMEOUT_SEC = 5;
export const UITEM_START_DELAY_MS = 1000;
export const SCRPCY_PIDS_TIMEOUT_SEC = 8;
export const FILE_CHECK_TIMEOUT_SEC = 3;
export const FILE_DELETE_TIMEOUT_SEC = 5;
export const SCREENSHOT_TIMEOUT_SEC = 5;
export const WAKEUP_TIMEOUT_SEC = 5;
export const UITEST_LAYOUT_REQUEST_TIMEOUT_MS = 10000;

/** UiTest 捕获 */
export const UITEST_CAPTURE_INTERVAL_MS = 500; // 2 FPS
export const UINPUT_MONITOR_TIMEOUT_SEC = 3;
export const UINPUT_TOUCH_TIMEOUT_SEC = 3;

/** 启动延迟 */
export const SCRPCY_KILL_DELAY_MS = 500;
export const SCRPCY_START_RETRY_DELAY_MS = 1000;
