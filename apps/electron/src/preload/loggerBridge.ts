/**
 * Logger IPC Bridge
 * Exposes logger methods to the renderer process
 */

import { ipcRenderer } from 'electron';
import type { LogEntry } from '../main/logger';

type LogCallback = (log: LogEntry) => void;

export const loggerAPI = {
  /**
   * Get all logs
   */
  async getLogs(): Promise<LogEntry[]> {
    return ipcRenderer.invoke('logger:getLogs');
  },

  /**
   * Filter logs by category, level, or timestamp
   */
  async filterLogs(
    category?: string,
    level?: string,
    sinceTimestamp?: number
  ): Promise<LogEntry[]> {
    return ipcRenderer.invoke('logger:filterLogs', category, level, sinceTimestamp);
  },

  /**
   * Get logger statistics
   */
  async getStats(): Promise<Record<string, any>> {
    return ipcRenderer.invoke('logger:getStats');
  },

  /**
   * Clear all logs
   */
  async clearLogs(): Promise<boolean> {
    return ipcRenderer.invoke('logger:clearLogs');
  },

  /**
   * Export logs as JSON
   */
  async exportLogs(): Promise<string> {
    return ipcRenderer.invoke('logger:exportLogs');
  },

  /**
   * Subscribe to real-time log updates
   * Returns unsubscribe function
   */
  subscribe(callback: LogCallback): () => void {
    // Send subscribe request
    ipcRenderer.send('logger:subscribe');

    // Listen for new logs
    const handler = (_: any, logEntry: LogEntry) => {
      callback(logEntry);
    };

    ipcRenderer.on('logger:logAdded', handler);

    // Return unsubscribe function
    return () => {
      ipcRenderer.removeListener('logger:logAdded', handler);
    };
  },
};

export const processMonitorAPI = {
  getActive(): Promise<any[]> {
    return ipcRenderer.invoke('process:getActive');
  },
  clearHistory(): Promise<boolean> {
    return ipcRenderer.invoke('process:clearHistory');
  },
  subscribe(callback: (processes: any[]) => void): () => void {
    const handler = (_: any, data: any[]) => callback(data);
    ipcRenderer.on('process:update', handler);
    return () => ipcRenderer.removeListener('process:update', handler);
  },
};

// Expose to window
declare global {
  interface Window {
    electron?: {
      logger?: typeof loggerAPI;
      processMonitor?: typeof processMonitorAPI;
      [key: string]: any;
    };
  }
}
