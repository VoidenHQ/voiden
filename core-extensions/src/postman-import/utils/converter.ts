import type {
  PostmanCollection,
  PostmanRequest,
  PostmanRequestBody,
  PostmanItem,
} from "./types";
import { isPostmanFolder, normalizePostmanUrl } from "./types";
import { getVoidenApiHelpers } from "./useVoidenApiHelpers";


/**
 * Sanitize folder/file names to be filesystem-safe
 */
export function sanitizeName(name: string): string {
  return name
    .trim()
    .replace(/\/+/g, "-") // Replace one or more slashes with a dash
    .replace(/[^a-zA-Z0-9-\s]/g, "") // Remove any character that is not alphanumeric, a dash, or whitespace
    .replace(/\s+/g, "-") // Replace whitespace with a dash
    .replace(/-+/g, "-") // Collapse multiple dashes into one
    .replace(/^-+/, "") // Remove leading dashes
    .replace(/-+$/, ""); // Remove trailing dashes
}

/**
 * Convert Postman auth to HTTP headers
 */
function convertAuthToHeaders(auth: PostmanRequest['request']['auth']): Array<{ key: string; value: string }> {
  if (!auth) return [];

  const headers: Array<{ key: string; value: string }> = [];

  if (auth.type === 'basic' && auth.basic) {
    // Basic auth: base64 encode username:password
    const credentials = `${auth.basic.username}:${auth.basic.password}`;
    const encoded = btoa(credentials);
    headers.push({ key: 'Authorization', value: `Basic ${encoded}` });
  } else if (auth.type === 'bearer' && auth.bearer) {
    // Bearer token
    headers.push({ key: 'Authorization', value: `Bearer ${auth.bearer.token}` });
  } else if (auth.type === 'apikey' && auth.apikey) {
    // API key - add as header with specified key
    headers.push({ key: auth.apikey.key, value: auth.apikey.value });
  }

  return headers;
}

/**
 * Detect language from raw body
 */
function detectBodyLanguage(body: PostmanRequestBody): 'json' | 'xml' | 'html' | 'text' {
  // Check explicit language setting
  const language = body.options?.raw?.language;
  if (language === 'json' || language === 'xml' || language === 'html' || language === 'text') {
    return language;
  }

  // Try to detect from content
  if (body.raw) {
    const trimmed = body.raw.trim();
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
 * Convert a Postman request to Voiden .void file format
 * Uses voiden-rest-api helpers to create blocks properly
 */
export const convertPostmanRequestToVoidenSchema = async (data: PostmanRequest): Promise<string> => {
  try {
    const helpers = getVoidenApiHelpers();

    // Build voiden blocks using the exposed helpers
    const blocks: any[] = [];

    // 1. Request block (method + url)
    const requestBlock = {
      type: 'request',
      content: [
        helpers.createMethodNode(data.request.method),
        helpers.createUrlNode(normalizePostmanUrl(data.request.url))
      ]
    };
    blocks.push(requestBlock);

    // 2. Headers (merge auth headers with existing headers)
    // Filter out disabled headers
    const authHeaders = convertAuthToHeaders(data.request.auth);
    const activeHeaders = (data.request.header || []).filter(h => !h.disabled);
    const allHeaders = [...authHeaders, ...activeHeaders];

    if (allHeaders.length > 0) {
      const headersBlock = helpers.createHeadersTableNode(
        allHeaders.map(h => [h.key, h.value] as [string, string])
      );
      blocks.push(headersBlock);
    }

    // 3. Query parameters (v2.1.0 format)
    // Filter out disabled query params
    if (typeof data.request.url === 'object' && data.request.url.query && data.request.url.query.length > 0) {
      const activeQueries = data.request.url.query.filter(q => !q.disabled);
      if (activeQueries.length > 0) {
        const queryBlock = helpers.createQueryTableNode(
          activeQueries.map(q => [q.key, q.value] as [string, string])
        );
        blocks.push(queryBlock);
      }
    }

    // 4. Request Body
    if (data.request.body) {
      const body = data.request.body;

      // 4a. Raw body (JSON, XML, HTML, Text)
      if (body.mode === "raw" && body.raw) {
        const language = detectBodyLanguage(body);

        if (language === 'json') {
          blocks.push(helpers.createJsonBodyNode(body.raw, "json"));
        } else if (language === 'xml') {
          blocks.push(helpers.createXMLBodyNode(body.raw, "xml"));
        } else if (language === 'html') {
          blocks.push(helpers.createXMLBodyNode(body.raw, "html"));
        } else {
          // For plain text, use JSON body node with text type
          blocks.push(helpers.createJsonBodyNode(body.raw, "text"));
        }
      }

      // 4b. URL-encoded form data (application/x-www-form-urlencoded)
      else if (body.mode === "urlencoded" && body.urlencoded && body.urlencoded.length > 0) {
        const activeParams = body.urlencoded.filter(f => !f.disabled);
        if (activeParams.length > 0) {
          const urlencodedBlock = helpers.createUrlTableNode(
            activeParams.map(f => [f.key, f.value] as [string, string])
          );
          blocks.push(urlencodedBlock);
        }
      }

      // 4c. Multipart form data
      else if (body.mode === "formdata" && body.formdata && body.formdata.length > 0) {
        const activeFormData = body.formdata.filter(f => !f.disabled);
        if (activeFormData.length > 0) {
          const multipartBlock = helpers.createMultipartTableNode(
            activeFormData.map(f => [f.key, f.value] as [string, string])
          );
          blocks.push(multipartBlock);
        }
      }
    }

    // Use helper to convert blocks to .void file format
    return helpers.convertBlocksToVoidFile(data.name, blocks);
  } catch (error) {
    const method = data.request?.method ?? 'UNKNOWN';
    const url = typeof data.request?.url === 'string' ? data.request.url : data.request?.url?.raw ?? 'unknown url';
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to convert "${data.name}" (${method} ${url}): ${detail}`);
  }
};

/**
 * Create a single .void file from a Postman request
 * Uses createVoid API to handle duplicate file names properly
 */
export const createSingleFile = async (request: PostmanRequest, currentPath: string, fileName: string) => {
  let content = await convertPostmanRequestToVoidenSchema(request);
  // Adds the request level description at end of void blocks
  if (request.request.description) {
    content += request.request.description;
  }
  // Use createVoid to handle deduplication (adds " 1", " 2", etc. if file exists)
  const result = await (window as any).electron?.files?.createVoid(currentPath, fileName);

  if (result?.path) {
    // Write content to the created file
    await (window as any).electron?.files?.write(result.path, content);
  }
};

/**
 * Count total items (requests) in a collection for progress tracking
 */
export const countTotalItems = (items: PostmanItem[]): number => {
  let total = 0;

  for (const item of items) {
    if (isPostmanFolder(item)) {
      // Add folder contents recursively
      total += countTotalItems(item.item);
    } else {
      // Count single file
      total += 1;
    }
  }

  return total;
};

/**
 * Process items recursively, creating folders and files
 */
export const processItems = async (
  items: PostmanItem[],
  currentPath: string,
  onProgress?: (current: number, total: number) => void,
  progressState = { current: 0, total: 0 },
  onError?: (itemName: string, error: unknown) => void,
  signal?: { cancelled: boolean },
) => {
  for (let i = 0; i < items.length; i++) {
    if (signal?.cancelled) return;

    const item = items[i];

    try {
      if (isPostmanFolder(item)) {
        const folderName = sanitizeName(item.name);

        // createDirectory returns the actual folder name (might be "folder-1", "folder-2" if duplicates)
        const actualFolderName = await (window as any).electron?.files?.createDirectory(currentPath, folderName);
        const folderPath = `${currentPath}/${actualFolderName}`;

        // Pass the same progressState object to nested calls
        await processItems(item.item, folderPath, onProgress, progressState, onError, signal);
      } else if (item.request) {
        try {
          await createSingleFile(item, currentPath, sanitizeName(item.name));
        } catch (error) {
          onError?.(item.name, error);
          progressState.current += 1;
          onProgress?.(progressState.current, progressState.total);
          continue;
        }

        // Increment progress counter
        progressState.current += 1;
        onProgress?.(progressState.current, progressState.total);
      }

      await new Promise((resolve) => setTimeout(resolve, 20));
    } catch (error) {
      throw error;
    }
  }
};

/**
 * Main function to import a Postman collection
 * @param collection - JSON string of the Postman collection
 * @param activeProject - Path to the active project directory
 * @param onProgress - Optional callback for progress updates
 */
export const importPostmanCollection = async (
  collection: string,
  activeProject: string,
  onProgress?: (current: number, total: number) => void,
  onError?: (itemName: string, error: unknown) => void,
  signal?: { cancelled: boolean },
) => {
  try {
    const json: PostmanCollection = JSON.parse(collection);

    if (!activeProject) {
      throw new Error("No active project found");
    }

    // Count total items first
    const totalItems = countTotalItems(json.item);

    // Create progress state object
    const progressState = { current: 0, total: totalItems };

    // Create root collection folder
    const rootFolderName = sanitizeName(json.info.name);
    const actualRootFolderName = await (window as any).electron?.files?.createDirectory(activeProject, rootFolderName);
    // Create root void file for collection documentation
    if (json.info.description) {
      const result = await (window as any).electron?.files?.createVoid(`${activeProject}/${actualRootFolderName}`, rootFolderName);
      if (result?.path) {
        // Write content to the created file
        await (window as any).electron?.files?.write(result.path, json.info.description);
      }
    }
    if (json && json.variable && json.variable.length > 0) {
      //@ts-ignore
      await (window as any).electron?.env?.extendEnvs(`${rootFolderName} collection variables`, json.variable);
    }

    // Process items with global progress tracking
    await processItems(json.item, `${activeProject}/${actualRootFolderName}`, onProgress, progressState, onError, signal);

    return {
      success: true,
      message: "Collection imported successfully",
    };
  } catch (error) {
    throw error;
  }
};
