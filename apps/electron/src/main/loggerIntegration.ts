/**
 * Logger Integration
 * Sets up logging for all major operations: IPC, filesystem, git, plugins, etc.
 */

import { ipcMain } from 'electron';
import { logger } from './logger';

/**
 * Wrap an IPC handler with automatic logging and timing
 */
export function createLoggedIPCHandler<T extends any[], R>(
  channel: string,
  handler: (...args: T) => Promise<R>,
  category: 'ipc' | 'git' | 'filesystem' | 'plugin' | 'system' | 'state' | 'other' = 'ipc'
) {
  return async (...args: T): Promise<R> => {
    const timerId = `${channel}-${Date.now()}-${Math.random()}`;
    logger.startTimer(timerId);

    try {
      const result = await handler(...args);
      const entry = logger.endTimer(timerId, category, `IPC Call: ${channel}`, {
        status: 'success',
        args: sanitizeArgs(args),
      });
      return result;
    } catch (error) {
      const duration = Date.now() - (Date.now() - 0);
      logger.error(category, `IPC Call Failed: ${channel}`, {
        status: 'failed',
        args: sanitizeArgs(args),
      } as any, error as Error);
      throw error;
    }
  };
}

/**
 * Remove sensitive data from logged arguments
 */
function sanitizeArgs(args: any[]): any[] {
  const sensitivePaths = ['password', 'token', 'apiKey', 'secret', 'auth'];
  
  return args.map((arg) => {
    if (typeof arg === 'string' && arg.length > 200) {
      return arg.substring(0, 200) + '...';
    }
    if (typeof arg === 'object' && arg !== null) {
      const sanitized: Record<string, any> = {};
      for (const [key, value] of Object.entries(arg)) {
        if (sensitivePaths.some((path) => key.toLowerCase().includes(path))) {
          sanitized[key] = '[REDACTED]';
        } else if (typeof value === 'string' && value.length > 100) {
          sanitized[key] = value.substring(0, 100) + '...';
        } else {
          sanitized[key] = value;
        }
      }
      return sanitized;
    }
    return arg;
  });
}

/**
 * Log plugin loading lifecycle
 */
export function logPluginLoading(pluginName: string, stage: 'start' | 'complete' | 'error', data?: Record<string, any>) {
  const messages: Record<string, string> = {
    start: `Loading plugin: ${pluginName}`,
    complete: `Plugin loaded: ${pluginName}`,
    error: `Plugin failed: ${pluginName}`,
  };

  if (stage === 'error') {
    logger.error('plugin', messages[stage], data);
  } else {
    logger.info('plugin', messages[stage], data);
  }
}

/**
 * Log filesystem operations
 */
export function logFileOperation(
  operation: 'read' | 'write' | 'delete' | 'mkdir' | 'list',
  filePath: string,
  duration?: number,
  error?: Error
) {
  if (error) {
    logger.error('filesystem', `File ${operation}: ${filePath}`, { operation, filePath }, error);
  } else if (duration) {
    logger.perf('filesystem', `File ${operation}: ${filePath}`, duration, { operation, filePath });
  } else {
    logger.info('filesystem', `File ${operation}: ${filePath}`, { operation, filePath });
  }
}

/**
 * Log git operations
 */
export function logGitOperation(
  operation: string,
  repo: string,
  duration?: number,
  error?: Error,
  data?: Record<string, any>
) {
  if (error) {
    logger.error('git', `Git ${operation} in ${repo}`, { operation, repo, ...data }, error);
  } else if (duration) {
    logger.perf('git', `Git ${operation} in ${repo}`, duration, { operation, repo, ...data });
  } else {
    logger.info('git', `Git ${operation} in ${repo}`, { operation, repo, ...data });
  }
}

/**
 * Log state changes
 */
export function logStateChange(category: string, action: string, data?: Record<string, any>) {
  logger.info('state', `State: ${category} - ${action}`, data);
}

/**
 * Performance monitoring utility
 */
export class PerformanceMonitor {
  private timers = new Map<string, number>();

  start(label: string): void {
    logger.startTimer(label);
    this.timers.set(label, Date.now());
  }

  end(label: string, category: 'ipc' | 'git' | 'filesystem' | 'plugin' | 'system' | 'state' | 'other' = 'system', data?: Record<string, any>): void {
    const endTime = Date.now();
    const startTime = this.timers.get(label);

    if (!startTime) {
      logger.warn('system', `Timer ${label} not found`);
      return;
    }

    const duration = endTime - startTime;
    logger.perf(category, label, duration, data);
    this.timers.delete(label);

    // Log warning if operation took longer than expected
    if (duration > 1000) {
      logger.warn('system', `Slow operation: ${label} took ${duration}ms`, { duration, label });
    }
  }

  endTimer(label: string): number {
    const startTime = this.timers.get(label);
    if (!startTime) return 0;

    const duration = Date.now() - startTime;
    this.timers.delete(label);
    return duration;
  }
}

export const performanceMonitor = new PerformanceMonitor();

/**
 * Initialize logging for all IPC handlers
 * This function should be called during app initialization
 */
export function initializeIntegratedLogging() {
  // Log app startup
  logger.info('system', 'Voiden app starting', { timestamp: Date.now() });

  // Listen for renderer process log messages
  ipcMain.on('logger:log', (_, level, category, message, data) => {
    if (level === 'error') {
      logger.error(category, message, data);
    } else if (level === 'warn') {
      logger.warn(category, message, data);
    } else if (level === 'debug') {
      logger.debug(category, message, data);
    } else {
      logger.info(category, message, data);
    }
  });

  logger.info('system', 'Integrated logging initialized', {});
}
