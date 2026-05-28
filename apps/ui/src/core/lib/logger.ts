/**
 * Centralized logging utility for Voiden
 *
 * Features:
 * - Log levels (debug, info, warn, error)
 * - Automatic stripping in production (except errors)
 * - Colored output for easy debugging
 * - Namespace support for filtering
 * - Feature-based log toggling
 *
 * Usage:
 * - Enable specific logs: localStorage.setItem('voiden:log', 'Request,Editor')
 * - Enable all logs: localStorage.setItem('voiden:log', '*')
 * - Disable all logs: localStorage.removeItem('voiden:log')
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const isDevelopment = import.meta.env.DEV;

// Parse enabled namespaces from localStorage
function getEnabledNamespaces(): Set<string> | null {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return null;
  }

  const logConfig = localStorage.getItem('voiden:log');
  if (!logConfig) return null;

  // '*' means enable all
  if (logConfig === '*') return new Set(['*']);

  // Parse comma-separated list: 'Request,Editor,Extension'
  return new Set(logConfig.split(',').map(s => s.trim()).filter(Boolean));
}

class Logger {
  private namespace: string;
  private static enabledNamespaces: Set<string> | null = getEnabledNamespaces();

  constructor(namespace: string = 'App') {
    this.namespace = namespace;
  }

  /**
   * Check if this logger's namespace is enabled
   */
  private isNamespaceEnabled(): boolean {
    if (!Logger.enabledNamespaces) return true; // No filter = all enabled
    if (Logger.enabledNamespaces.has('*')) return true; // Wildcard = all enabled

    // Check if any part of the namespace matches
    // e.g., "Request:Pipeline" matches if "Request" or "Request:Pipeline" is enabled
    const parts = this.namespace.split(':');
    for (let i = 0; i < parts.length; i++) {
      const partial = parts.slice(0, i + 1).join(':');
      if (Logger.enabledNamespaces.has(partial)) return true;
    }

    return false;
  }

  private shouldLog(level: LogLevel): boolean {
    // Always log errors in production
    if (!isDevelopment && level !== 'error') {
      return false;
    }

    // In development, check if namespace is enabled
    if (isDevelopment && !this.isNamespaceEnabled()) {
      return false;
    }

    return true;
  }

  private formatMessage(level: LogLevel, message: string, ...args: any[]) {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    const levelIcon = {
      debug: '🔍',
      info: 'ℹ️',
      warn: '⚠️',
      error: '❌',
    }[level];

    const prefix = `${levelIcon} [${timestamp}] [${this.namespace}]`;

    return [prefix, message, ...args];
  }

  debug(message: string, ...args: any[]) {
    if (!this.shouldLog('debug')) return;
    console.debug(...this.formatMessage('debug', message, ...args));
  }

  info(message: string, ...args: any[]) {
    if (!this.shouldLog('info')) return;
    console.info(...this.formatMessage('info', message, ...args));
  }

  warn(message: string, ...args: any[]) {
    if (!this.shouldLog('warn')) return;
    console.warn(...this.formatMessage('warn', message, ...args));
  }

  error(message: string, ...args: any[]) {
    if (!this.shouldLog('error')) return;
    console.error(...this.formatMessage('error', message, ...args));
  }

  /**
   * Create a child logger with a sub-namespace
   * Example: logger.child('RequestEngine') creates "Voiden:RequestEngine"
   */
  child(subNamespace: string): Logger {
    return new Logger(`${this.namespace}:${subNamespace}`);
  }

  /**
   * Refresh enabled namespaces from localStorage
   * Call this after changing localStorage.setItem('voiden:log', ...)
   */
  static refresh(): void {
    Logger.enabledNamespaces = getEnabledNamespaces();
  }
}

// Global helper to enable/disable logs at runtime
if (typeof window !== 'undefined') {
  (window as any).voidenLog = {
    enable: (namespaces: string) => {
      localStorage.setItem('voiden:log', namespaces);
      Logger.refresh();
    },
    disable: () => {
      localStorage.removeItem('voiden:log');
      Logger.refresh();
    },
    enableAll: () => {
      localStorage.setItem('voiden:log', '*');
      Logger.refresh();
    },
    list: () => {
      const current = localStorage.getItem('voiden:log') || 'none';
    },
  };
}

// Export singleton instances for common namespaces
export const logger = new Logger('Voiden');
export const createLogger = (namespace: string) => new Logger(namespace);

// Convenience exports for common areas
export const uiLogger = logger.child('UI');
export const requestLogger = logger.child('Request');
export const extensionLogger = logger.child('Extension');
export const editorLogger = logger.child('Editor');
export const pasteLogger = logger.child('Paste');
export const fileSystemLogger = logger.child('FileSystem');
