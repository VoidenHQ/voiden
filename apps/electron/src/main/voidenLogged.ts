/**
 * IPC Handlers with Integrated Logging
 * 
 * This file shows how to wrap existing IPC handlers with logging.
 * Copy these patterns to instrument other IPC handlers in your codebase.
 */

import { ipcMain } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { logger, createIPCHandler } from './logger';
import { performanceMonitor, logFileOperation } from './loggerIntegration';

/**
 * Example: Log and instrument the getApyFiles IPC handler
 * This is a refactoring of the existing voiden.ts handler to include logging
 */
export function setupLoggedIPCHandlers() {
  // =====================================================================
  // File Operations with Logging
  // =====================================================================

  ipcMain.handle(
    'voiden-wrapper:getApyFiles',
    createIPCHandler(
      'voiden-wrapper:getApyFiles',
      async (_, directory: string) => {
        const timerId = `getApyFiles-${directory}`;
        performanceMonitor.start(timerId);

        try {
          logger.debug('filesystem', `Starting to fetch .void files from ${directory}`, {
            directory,
          });

          async function getFilesRecursively(dir: string): Promise<
            Array<{ filePath: string; filename: string; content: string }>
          > {
            let results: Array<{ filePath: string; filename: string; content: string }> = [];
            const entries = await fs.readdir(dir, { withFileTypes: true });

            logger.debug('filesystem', `Reading directory: ${dir}`, {
              entryCount: entries.length,
            });

            for (const entry of entries) {
              const fullPath = path.join(dir, entry.name);

              if (entry.isDirectory()) {
                results = results.concat(await getFilesRecursively(fullPath));
              } else if (entry.isFile() && entry.name.endsWith('.void')) {
                try {
                  const readStart = Date.now();
                  const content = await fs.readFile(fullPath, 'utf8');
                  const readDuration = Date.now() - readStart;

                  if (readDuration > 100) {
                    logger.warn('filesystem', `Slow file read: ${fullPath}`, {
                      duration: readDuration,
                      size: content.length,
                    });
                  }

                  results.push({ filePath: fullPath, filename: entry.name, content });
                } catch (error) {
                  logger.error('filesystem', `Failed to read file: ${fullPath}`, 
                    { path: fullPath }, error as Error);
                }
              }
            }

            return results;
          }

          const documents = await getFilesRecursively(directory);

          const duration = performanceMonitor.endTimer(timerId);
          logger.perf('filesystem', `Fetched .void files from ${directory}`, duration, {
            directory,
            fileCount: documents.length,
            totalSize: documents.reduce((sum, doc) => sum + doc.content.length, 0),
          });

          return documents;
        } catch (error) {
          logger.error('filesystem', `Failed to fetch .void files from ${directory}`, 
            { directory }, error as Error);
          throw error;
        }
      },
      'filesystem'
    )
  );

  // =====================================================================
  // Block Content Reading with Logging
  // =====================================================================

  ipcMain.handle(
    'voiden-wrapper:getBlockContent',
    createIPCHandler(
      'voiden-wrapper:getBlockContent',
      async (_, filePath: string) => {
        const timerId = `getBlockContent-${filePath}`;
        performanceMonitor.start(timerId);

        try {
          logger.debug('filesystem', `Reading block content from ${filePath}`, {
            filePath,
          });

          const content = await fs.readFile(filePath, 'utf8');

          const duration = performanceMonitor.endTimer(timerId);

          if (duration > 500) {
            logger.warn('filesystem', `Slow block content read: ${filePath}`, {
              duration,
              size: content.length,
            });
          } else {
            logger.perf('filesystem', `Read block content from ${filePath}`, duration, {
              filePath,
              size: content.length,
            });
          }

          return content;
        } catch (error) {
          logger.error('filesystem', `Failed to read block content from ${filePath}`, 
            { filePath }, error as Error);
          throw error;
        }
      },
      'filesystem'
    )
  );

  // =====================================================================
  // Save File with Logging
  // =====================================================================

  ipcMain.handle(
    'voiden-wrapper:saveFile',
    createIPCHandler(
      'voiden-wrapper:saveFile',
      async (_, filePath: string, content: string) => {
        const timerId = `saveFile-${filePath}`;
        performanceMonitor.start(timerId);

        try {
          logger.debug('filesystem', `About to save file: ${filePath}`, {
            filePath,
            size: content.length,
          });

          // Ensure directory exists
          const dir = path.dirname(filePath);
          try {
            await fs.mkdir(dir, { recursive: true });
          } catch (mkdirError) {
            logger.warn('filesystem', `Failed to create directory: ${dir}`, 
              { dir }, mkdirError as Error);
          }

          await fs.writeFile(filePath, content, 'utf8');

          const duration = performanceMonitor.endTimer(timerId);
          logger.perf('filesystem', `Saved file: ${filePath}`, duration, {
            filePath,
            size: content.length,
          });

          return { success: true, filePath };
        } catch (error) {
          logger.error('filesystem', `Failed to save file: ${filePath}`, 
            { filePath, size: content.length }, error as Error);
          throw error;
        }
      },
      'filesystem'
    )
  );

  // =====================================================================
  // Delete File with Logging
  // =====================================================================

  ipcMain.handle(
    'voiden-wrapper:deleteFile',
    createIPCHandler(
      'voiden-wrapper:deleteFile',
      async (_, filePath: string) => {
        const timerId = `deleteFile-${filePath}`;
        performanceMonitor.start(timerId);

        try {
          logger.debug('filesystem', `About to delete file: ${filePath}`, {
            filePath,
          });

          await fs.unlink(filePath);

          const duration = performanceMonitor.endTimer(timerId);
          logger.perf('filesystem', `Deleted file: ${filePath}`, duration, {
            filePath,
          });

          return { success: true, filePath };
        } catch (error) {
          logger.error('filesystem', `Failed to delete file: ${filePath}`, 
            { filePath }, error as Error);
          throw error;
        }
      },
      'filesystem'
    )
  );

  logger.info('system', 'Logged IPC handlers registered', {
    handlers: [
      'voiden-wrapper:getApyFiles',
      'voiden-wrapper:getBlockContent',
      'voiden-wrapper:saveFile',
      'voiden-wrapper:deleteFile',
    ],
  });
}

/**
 * Export for use in main process
 */
export default setupLoggedIPCHandlers;
