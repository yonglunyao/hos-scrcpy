/**
 * Structured logging utility using pino
 *
 * Provides consistent logging across the application with
 * different log levels and pretty formatting in development.
 */

import pino from 'pino';

const isDevelopment = process.env.NODE_ENV !== 'production';

/**
 * Logger configuration
 */
const baseOptions = {
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
  formatters: {
    level: (label: string) => {
      return {
        level: label,
      };
    },
  },
  serializers: {
    error: pino.stdSerializers.err,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
};

/**
 * Production logger (JSON output)
 */
const productionLogger = pino({
  ...baseOptions,
});

/**
 * Development logger factory (creates logger with pretty formatting)
 * Only created when pino-pretty is available
 */
const createDevelopmentLogger = () => pino({
  ...baseOptions,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname',
    },
  },
});

/**
 * Main logger instance
 * Use development logger only in development mode and when pino-pretty is available
 */
export const logger = (() => {
  if (!isDevelopment) {
    return productionLogger;
  }
  try {
    // Check if pino-pretty is available
    require.resolve('pino-pretty');
    // Create development logger only when pino-pretty is available
    return createDevelopmentLogger();
  } catch {
    // pino-pretty not available, fall back to production logger
    return productionLogger;
  }
})();

/**
 * Create a child logger with additional context
 */
export function createChildLogger(context: string, bindings: Record<string, unknown> = {}) {
  return logger.child({ ...bindings, component: context });
}

/**
 * Log levels for type safety
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
