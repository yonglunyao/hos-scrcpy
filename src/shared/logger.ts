/**
 * Lightweight logging utility (console-based, pino-free)
 *
 * Provides consistent logging across the application with
 * different log levels and pretty formatting in development.
 */

const isDevelopment = process.env.NODE_ENV !== 'production';

/**
 * ANSI color codes for development mode
 */
const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
};

/**
 * Format timestamp as ISO string
 */
function getTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Format error object for logging
 */
function formatError(err: unknown): string {
  if (err instanceof Error) {
    return `${err.name}: ${err.message}\n${err.stack}`;
  }
  return String(err);
}

/**
 * Simple logger instance
 */
class LoggerImpl {
  private context: string;
  private bindings: Record<string, unknown>;

  constructor(context: string = '', bindings: Record<string, unknown> = {}) {
    this.context = context;
    this.bindings = bindings;
  }

  private formatMessage(mergingObject: Record<string, unknown> | string | Error, message?: string): string {
    const timestamp = isDevelopment ? getTimestamp() : '';
    const parts: string[] = [];

    if (timestamp) {
      parts.push(timestamp);
    }

    if (this.context) {
      parts.push(`[${this.context}]`);
    }

    if (Object.keys(this.bindings).length > 0) {
      const bindingsStr = Object.entries(this.bindings)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');
      parts.push(`{${bindingsStr}}`);
    }

    let msg = '';
    if (typeof mergingObject === 'string') {
      msg = mergingObject;
      if (message) msg += ` ${message}`;
    } else if (mergingObject instanceof Error) {
      msg = formatError(mergingObject);
      if (message) msg += ` ${message}`;
    } else {
      if (Object.keys(mergingObject).length > 0) {
        const objStr = JSON.stringify(mergingObject);
        if (objStr !== '{}') parts.push(objStr);
      }
      if (message) msg = message;
    }

    if (msg) parts.push(msg);
    return parts.join(' ');
  }

  private logToConsole(level: string, mergingObject: Record<string, unknown> | string, message?: string, color = colors.reset): void {
    const formatted = this.formatMessage(mergingObject, message);
    if (isDevelopment) {
      console.log(`${color}[${level.toUpperCase()}]${colors.reset} ${formatted}`);
    } else {
      console.log(`{"level":"${level}","timestamp":"${getTimestamp()}","message":${JSON.stringify(formatted)}}`);
    }
  }

  debug(mergingObject: Record<string, unknown> | string, message?: string): void {
    if (process.env.LOG_LEVEL === 'debug' || isDevelopment) {
      this.logToConsole('debug', mergingObject, message, colors.dim);
    }
  }

  info(mergingObject: Record<string, unknown> | string, message?: string): void {
    this.logToConsole('info', mergingObject, message, colors.blue);
  }

  warn(mergingObject: Record<string, unknown> | string, message?: string): void {
    this.logToConsole('warn', mergingObject, message, colors.yellow);
  }

  error(mergingObject: Record<string, unknown> | string | Error, message?: string): void {
    let logObj: Record<string, unknown> | string;
    if (mergingObject instanceof Error) {
      logObj = { error: formatError(mergingObject) };
      if (!message) message = mergingObject.message;
    } else {
      logObj = mergingObject;
    }
    this.logToConsole('error', logObj as Record<string, unknown> | string, message, colors.red);
  }

  /**
   * Create a child logger with additional context
   */
  child(bindings: Record<string, unknown>): LoggerImpl {
    return new LoggerImpl(this.context, { ...this.bindings, ...bindings });
  }
}

/**
 * Main logger instance
 */
export const logger = new LoggerImpl();

/**
 * Create a child logger with additional context
 */
export function createChildLogger(context: string, bindings: Record<string, unknown> = {}): LoggerImpl {
  return new LoggerImpl(context, bindings);
}

/**
 * Log levels for type safety
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
