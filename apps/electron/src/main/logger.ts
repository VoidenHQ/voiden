/**
 * Logger System
 * Tracks IPC calls, backend operations, plugin loading, and performance metrics
 */

import { ipcMain } from 'electron';
import { EventEmitter } from 'events';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'perf';
export type LogCategory = 'ipc' | 'git' | 'filesystem' | 'plugin' | 'system' | 'state' | 'other';

export interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  category: LogCategory;
  message: string;
  duration?: number; // milliseconds for performance logs
  data?: Record<string, any>;
  stack?: string; // for error logs
}

class Logger extends EventEmitter {
  private logs: LogEntry[] = [];
  private readonly maxLogs = 1000; // Keep last 1000 entries
  private performanceMarkers = new Map<string, number>();

  constructor() {
    super();
  }

  /**
   * Log a message
   */
  log(
    level: LogLevel,
    category: LogCategory,
    message: string,
    data?: Record<string, any>,
    duration?: number
  ): LogEntry {
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp: Date.now(),
      level,
      category,
      message,
      data,
      duration,
    };

    this.logs.push(entry);

    // Keep only last N logs
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    // Emit for real-time listeners
    this.emit('log', entry);

    // Also log to console in development
    if (process.env.NODE_ENV === 'development') {
      const prefix = `[${category.toUpperCase()}]`;
      const durationStr = duration ? ` (${duration}ms)` : '';
      // Map custom levels ('debug', 'perf') to real console methods
      const consoleMethod = (level === 'debug' || level === 'perf') ? 'log' : level;
      console[consoleMethod](prefix, message + durationStr, data || '');
    }

    return entry;
  }

  info(category: LogCategory, message: string, data?: Record<string, any>): LogEntry {
    return this.log('info', category, message, data);
  }

  warn(category: LogCategory, message: string, data?: Record<string, any>): LogEntry {
    return this.log('warn', category, message, data);
  }

  error(category: LogCategory, message: string, data?: Record<string, any>, error?: Error): LogEntry {
    return this.log('error', category, message, { ...data, error: error?.message }, undefined);
  }

  debug(category: LogCategory, message: string, data?: Record<string, any>): LogEntry {
    return this.log('debug', category, message, data);
  }

  /**
   * Log performance metrics
   */
  perf(category: LogCategory, message: string, duration: number, data?: Record<string, any>): LogEntry {
    return this.log('perf', category, message, data, duration);
  }

  /**
   * Start a performance timer
   */
  startTimer(markerId: string): void {
    this.performanceMarkers.set(markerId, Date.now());
  }

  /**
   * End a performance timer and log
   */
  endTimer(
    markerId: string,
    category: LogCategory,
    message: string,
    data?: Record<string, any>
  ): LogEntry | null {
    const startTime = this.performanceMarkers.get(markerId);
    if (!startTime) {
      console.warn(`Timer ${markerId} not found`);
      return null;
    }

    const duration = Date.now() - startTime;
    this.performanceMarkers.delete(markerId);

    return this.perf(category, message, duration, data);
  }

  /**
   * Get all logs
   */
  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  /**
   * Get logs filtered by category or level
   */
  filterLogs(
    category?: LogCategory,
    level?: LogLevel,
    sinceTimestamp?: number
  ): LogEntry[] {
    return this.logs.filter((log) => {
      if (category && log.category !== category) return false;
      if (level && log.level !== level) return false;
      if (sinceTimestamp && log.timestamp < sinceTimestamp) return false;
      return true;
    });
  }

  /**
   * Clear all logs
   */
  clearLogs(): void {
    this.logs = [];
    this.performanceMarkers.clear();
  }

  /**
   * Export logs as JSON
   */
  exportLogs(): string {
    return JSON.stringify(this.logs, null, 2);
  }

  /**
   * Get stats about logs
   */
  getStats(): Record<string, any> {
    const stats: Record<string, any> = {
      totalLogs: this.logs.length,
      byLevel: {} as Record<LogLevel, number>,
      byCategory: {} as Record<LogCategory, number>,
      avgDuration: 0,
      slowestOperations: [] as Array<{ message: string; duration: number }>,
    };

    const levels: LogLevel[] = ['info', 'warn', 'error', 'debug', 'perf'];
    const categories: LogCategory[] = ['ipc', 'git', 'filesystem', 'plugin', 'system', 'state', 'other'];

    // Count by level and category
    for (const level of levels) {
      stats.byLevel[level] = this.logs.filter((l) => l.level === level).length;
    }

    for (const category of categories) {
      stats.byCategory[category] = this.logs.filter((l) => l.category === category).length;
    }

    // Average duration
    const perfLogs = this.logs.filter((l) => l.level === 'perf' && l.duration);
    if (perfLogs.length > 0) {
      const totalDuration = perfLogs.reduce((sum, log) => sum + (log.duration || 0), 0);
      stats.avgDuration = Math.round(totalDuration / perfLogs.length);
    }

    // Slowest operations
    stats.slowestOperations = perfLogs
      .sort((a, b) => (b.duration || 0) - (a.duration || 0))
      .slice(0, 10)
      .map((log) => ({
        message: log.message,
        duration: log.duration,
      }));

    return stats;
  }
}

export const logger = new Logger();

/**
 * Setup IPC handlers for logger
 */
export function setupLoggerIPC(): void {
  // Get all logs
  ipcMain.handle('logger:getLogs', () => {
    return logger.getLogs();
  });

  // Get filtered logs
  ipcMain.handle('logger:filterLogs', (_, category?: LogCategory, level?: LogLevel, sinceTimestamp?: number) => {
    return logger.filterLogs(category, level, sinceTimestamp);
  });

  // Get stats
  ipcMain.handle('logger:getStats', () => {
    return logger.getStats();
  });

  // Clear logs
  ipcMain.handle('logger:clearLogs', () => {
    logger.clearLogs();
    return true;
  });

  // Export logs
  ipcMain.handle('logger:exportLogs', () => {
    return logger.exportLogs();
  });

  // Track one log handler per renderer process to prevent accumulation
  // when the LogsPanel tab is opened, closed, and reopened.
  const activeSubscribers = new Map<number, (logEntry: LogEntry) => void>();

  // Listen for real-time log updates
  ipcMain.on('logger:subscribe', (event) => {
    const senderId = event.sender.id;

    // Remove any previous handler for this sender before registering a new one
    const existing = activeSubscribers.get(senderId);
    if (existing) {
      logger.removeListener('log', existing);
    }

    const handler = (logEntry: LogEntry) => {
      if (!event.sender.isDestroyed()) {
        event.reply('logger:logAdded', logEntry);
      }
    };

    activeSubscribers.set(senderId, handler);
    logger.on('log', handler);

    // Send existing logs on first subscribe
    event.reply('logger:logsBatch', logger.getLogs());

    // Clean up when renderer process is destroyed
    event.sender.once('destroyed', () => {
      logger.removeListener('log', handler);
      activeSubscribers.delete(senderId);
    });
  });
}

/**
 * Wrapper for IPC call logging and timing
 */
export function createIPCHandler<T extends any[], R>(
  channel: string,
  handler: (event: any, ...args: T) => Promise<R>,
  category: LogCategory = 'ipc'
) {
  return async (event: any, ...args: T): Promise<R> => {
    const timerId = `ipc-${channel}-${Date.now()}-${Math.random()}`;
    logger.startTimer(timerId);

    try {
      const result = await handler(event, ...args);
      logger.endTimer(timerId, category, `IPC: ${channel}`, { status: 'success' });
      return result;
    } catch (error) {
      const duration = Date.now() - (logger['performanceMarkers'].get(timerId) || Date.now());
      logger.log(
        'error',
        category,
        `IPC: ${channel}`,
        { status: 'failed', error: (error as Error).message },
        duration
      );
      throw error;
    }
  };
}
