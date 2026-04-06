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
 * Development logger with pretty formatting
 */
const developmentLogger = pino({
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
 * Production logger (JSON output)
 */
const productionLogger = pino({
  ...baseOptions,
});

/**
 * Main logger instance
 */
export const logger = isDevelopment ? developmentLogger : productionLogger;

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
