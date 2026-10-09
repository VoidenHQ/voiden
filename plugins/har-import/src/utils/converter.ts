import type {
  HarContainer,
  HarEntry,
  HarLog,
  HarPage,
  HarPostData,
} from './types';
import { isHarObject } from './types';
import { isStaticAsset } from './staticAssets';
import { getVoidenApiHelpers } from './useVoidenApiHelpers';

/**
 * Sanitize folder/file names to be filesystem-safe
 */
export function sanitizeName(name: string): string {
  if (!name || !name.trim()) return 'unnamed-request';
  return name
    .trim()
    .replace(/\/+/g, '-') // Replace slashes with dash
    .replace(/[^a-zA-Z0-9-\s_.]/g, '') // Remove non-safe characters
    .replace(/\s+/g, '-') // Replace whitespace with dash
    .replace(/-+/g, '-') // Collapse multiple dashes
    .replace(/^-+/, '') // Trim leading dashes
    .replace(/-+$/, ''); // Trim trailing dashes
}

/**
 * Detect language / content type from postData
 */
function detectBodyLanguage(postData: HarPostData): 'json' | 'xml' | 'html' | 'text' {
  const mime = (postData.mimeType || '').toLowerCase();
  if (mime.includes('application/json') || mime.includes('+json')) return 'json';
  if (mime.includes('application/xml') || mime.includes('text/xml') || mime.includes('+xml')) return 'xml';
  if (mime.includes('text/html')) return 'html';

  if (postData.text) {
    const trimmed = postData.text.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
    if (trimmed.startsWith('<')) {
      if (trimmed.toLowerCase().includes('<!doctype html') || trimmed.toLowerCase().includes('<html')) {
        return 'html';
      }
      return 'xml';
    }
  }

  return 'text';
}

/**
 * Generate a descriptive name for a HAR entry request
 */
export function getEntryName(entry: HarEntry): string {
  if (entry.comment) return entry.comment;

  try {
    const parsedUrl = new URL(entry.request.url);
    const pathname = parsedUrl.pathname.replace(/\/$/, '');
    const segments = pathname.split('/').filter(Boolean);
    const lastSegment = segments.length > 0 ? segments[segments.length - 1] : parsedUrl.hostname;
    return `${entry.request.method} ${lastSegment}`;
  } catch {
    return `${entry.request.method} ${entry.request.url.slice(0, 30)}`;
  }
}

/**
 * Convert a HAR entry into Voiden .void file format
 */
export const convertHarEntryToVoidenSchema = async (entry: HarEntry): Promise<string> => {
  const helpers = getVoidenApiHelpers();
  const req = entry.request;
  const blocks: any[] = [];

  // 1. Request block (method + url)
  const method = (req.method || 'GET').toUpperCase();
  const requestBlock = {
    type: 'request',
    content: [
      helpers.createMethodNode(method),
      helpers.createUrlNode(req.url),
    ],
  };
  blocks.push(requestBlock);

  // 2. Headers (combine req.headers and req.cookies if cookie header isn't explicitly set)
  const headers: [string, string][] = [];
  const hasCookieHeader = (req.headers || []).some(
    (h) => h.name.toLowerCase() === 'cookie'
  );

  if (req.headers && req.headers.length > 0) {
    for (const h of req.headers) {
      if (h.name && h.value !== undefined) {
        // Filter out HTTP/2 pseudo-headers starting with ':'
        if (h.name.startsWith(':')) continue;
        headers.push([h.name, h.value]);
      }
    }
  }

  if (!hasCookieHeader && req.cookies && req.cookies.length > 0) {
    const cookieString = req.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    headers.push(['Cookie', cookieString]);
  }

  if (headers.length > 0) {
    blocks.push(helpers.createHeadersTableNode(headers));
  }

  // 3. Query parameters (req.queryString)
  if (req.queryString && req.queryString.length > 0) {
    const queryParams: [string, string][] = req.queryString.map((q) => [
      q.name,
      q.value || '',
    ]);
    blocks.push(helpers.createQueryTableNode(queryParams));
  }

  // 4. Request Body (req.postData)
  if (req.postData) {
    const postData = req.postData;
    const mime = (postData.mimeType || '').toLowerCase();

    // 4a. Form Data (application/x-www-form-urlencoded)
    if (
      mime.includes('application/x-www-form-urlencoded') &&
      postData.params &&
      postData.params.length > 0
    ) {
      const urlencodedParams: [string, string][] = postData.params.map((p) => [
        p.name,
        p.value || '',
      ]);
      blocks.push(helpers.createUrlTableNode(urlencodedParams));
    }
    // 4b. Multipart Form Data (multipart/form-data)
    else if (
      mime.includes('multipart/form-data') &&
      postData.params &&
      postData.params.length > 0
    ) {
      const multipartParams: [string, string][] = postData.params.map((p) => [
        p.name,
        p.value || p.fileName || '',
      ]);
      blocks.push(helpers.createMultipartTableNode(multipartParams));
    }
    // 4c. Raw Text / JSON / XML
    else if (postData.text) {
      const language = detectBodyLanguage(postData);
      if (language === 'json') {
        blocks.push(helpers.createJsonBodyNode(postData.text, 'json'));
      } else if (language === 'xml') {
        blocks.push(helpers.createXMLBodyNode(postData.text, 'xml'));
      } else if (language === 'html') {
        blocks.push(helpers.createXMLBodyNode(postData.text, 'html'));
      } else {
        blocks.push(helpers.createJsonBodyNode(postData.text, 'text'));
      }
    }
  }

  const title = getEntryName(entry);
  return helpers.convertBlocksToVoidFile(title, blocks);
};

/**
 * Group entries by Page or Domain Hostname
 */
export function groupEntries(
  log: HarLog,
  ignoreStaticAssets: boolean = true
): Record<string, HarEntry[]> {
  const groups: Record<string, HarEntry[]> = {};
  const pageMap = new Map<string, string>();

  if (log.pages && log.pages.length > 0) {
    for (const page of log.pages) {
      pageMap.set(page.id, sanitizeName(page.title || page.id));
    }
  }

  for (const entry of log.entries) {
    if (!entry.request || !entry.request.url) continue;

    // Check static asset filter
    if (ignoreStaticAssets) {
      const mimeType = entry.response?.content?.mimeType || entry.request.postData?.mimeType;
      if (isStaticAsset(entry.request.url, mimeType)) {
        continue;
      }
    }

    let folderName = 'general-requests';

    if (entry.pageref && pageMap.has(entry.pageref)) {
      folderName = pageMap.get(entry.pageref)!;
    } else {
      try {
        const urlObj = new URL(entry.request.url);
        folderName = sanitizeName(urlObj.hostname) || 'general-requests';
      } catch {
        folderName = 'general-requests';
      }
    }

    if (!groups[folderName]) {
      groups[folderName] = [];
    }
    groups[folderName].push(entry);
  }

  return groups;
}

/**
 * Create a single .void file for a HAR entry
 */
export const createSingleHarFile = async (
  entry: HarEntry,
  currentPath: string
) => {
  const content = await convertHarEntryToVoidenSchema(entry);
  const entryName = sanitizeName(getEntryName(entry));

  const result = await (window as any).electron?.files?.createVoid(
    currentPath,
    entryName
  );

  if (result?.path) {
    await (window as any).electron?.files?.write(result.path, content);
  }
};

/**
 * Main import controller for HAR files
 */
export const importHarLog = async (
  harJsonString: string,
  activeProject: string,
  options: { ignoreStaticAssets?: boolean } = {},
  onProgress?: (current: number, total: number) => void,
  onError?: (itemName: string, error: unknown) => void,
  signal?: { cancelled: boolean }
) => {
  const parsedData = JSON.parse(harJsonString);
  const log: HarLog = isHarObject(parsedData) ? parsedData.log : parsedData;

  if (!log || !Array.isArray(log.entries)) {
    throw new Error('Invalid HAR file format: missing log entries');
  }

  const ignoreStatic = options.ignoreStaticAssets ?? true;
  const groups = groupEntries(log, ignoreStatic);

  let totalItems = 0;
  for (const folderName in groups) {
    totalItems += groups[folderName].length;
  }

  if (totalItems === 0) {
    return {
      success: true,
      message: 'No requests found to import (check static asset filter settings).',
    };
  }

  // Create root HAR import directory in active project
  const rootFolderName = sanitizeName(
    log.creator?.name ? `har-${log.creator.name}` : 'har-import'
  );
  const actualRootPath =
    (await (window as any).electron?.files?.createDirectory(
      activeProject,
      rootFolderName
    )) || rootFolderName;
  const rootPath = `${activeProject}/${actualRootPath}`;

  let currentCount = 0;

  for (const folderName in groups) {
    if (signal?.cancelled) return;

    const entries = groups[folderName];
    const actualFolderName =
      (await (window as any).electron?.files?.createDirectory(
        rootPath,
        folderName
      )) || folderName;
    const folderPath = `${rootPath}/${actualFolderName}`;

    for (const entry of entries) {
      if (signal?.cancelled) return;

      const itemName = getEntryName(entry);
      try {
        await createSingleHarFile(entry, folderPath);
      } catch (err) {
        onError?.(itemName, err);
      } finally {
        currentCount++;
        onProgress?.(currentCount, totalItems);
      }

      await new Promise((r) => setTimeout(r, 15));
    }
  }

  return {
    success: true,
    message: `Imported ${currentCount} requests successfully`,
  };
};
