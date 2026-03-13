/**
 * cURL Command Generator
 *
 * Utilities for converting REST API request blocks into cURL commands
 */

interface RequestData {
    method?: string;
    url?: string;
    headers?: Array<{key: string, value: string}>;
    queryParams?: Array<{key: string, value: string}>;
    pathParams?: Array<{key: string, value: string}>;
    body?: string;
    bodyType?: 'json' | 'xml' | 'yaml' | 'form' | 'multipart' | 'text';
    multipartData?: Array<{key: string, value: string, type?: string}>;
}

/**
 * Generate cURL command from request data
 */
export const generateCurlCommand = (data: RequestData): string => {
    const parts: string[] = ['curl'];

    // Add method
    const method = (data.method || 'GET').toUpperCase();
    if (method !== 'GET') {
        parts.push(`-X ${method}`);
    }

    // Build URL with query parameters
    let url = data.url || '';

    if (data.queryParams && data.queryParams.length > 0) {
        const queryString = data.queryParams
            .filter(({key, value}) => key.trim())
            .map(({key, value}) => `${encodeURIComponent(key.trim())}=${encodeURIComponent(value?.trim() || '')}`)
            .join('&');

        if (queryString) {
            const separator = url.includes('?') ? '&' : '?';
            url = `${url}${separator}${queryString}`;
        }
    }

    // Add URL - use double quotes for better compatibility
    if (url) {
        parts.push(`"${url}"`);
    }

    // Add headers - BEFORE body/form data
    if (data.headers && data.headers.length > 0) {
        data.headers.forEach(({key, value}) => {
            if (key.trim()) {
                // Escape double quotes in header values
                const escapedValue = (value?.trim() || '').replace(/"/g, '\\"');
                parts.push(`-H "${key.trim()}: ${escapedValue}"`);
            }
        });
    }

    // Add body
    if (data.body) {
        // If body is a file reference (binary) send as --data-binary without quotes
        if (typeof data.body === 'string' && data.body.startsWith('@')) {
            parts.push(`--data-binary "${data.body}"`);
        } else if (data.bodyType === 'multipart' && data.multipartData && data.multipartData.length > 0) {
            // Multipart form data - use -F for each field
            data.multipartData.forEach(({key, value, type}) => {
                if (key.trim()) {
                    const trimmedValue = value?.trim() || '';
                    
                    // Check if it's a file reference (starts with @)
                    if (trimmedValue.startsWith('@')) {
                        // File upload
                        if (type) {
                            // With explicit content type
                            parts.push(`-F "${key.trim()}=${trimmedValue};type=${type}"`);
                        } else {
                            parts.push(`-F "${key.trim()}=${trimmedValue}"`);
                        }
                    } else {
                        // Regular field - escape double quotes
                        const escapedValue = trimmedValue.replace(/"/g, '\\"');
                        parts.push(`-F "${key.trim()}=${escapedValue}"`);
                    }
                }
            });
        } else {
            // Regular body (JSON, XML, form-urlencoded, or text)
            // Escape double quotes and backslashes
            const escapedBody = data.body
                .replace(/\\/g, '\\\\')
                .replace(/"/g, '\\"');
            parts.push(`-d "${escapedBody}"`);

            // Add content-type header if not already present
            const hasContentType = data.headers?.some(({key}) =>
                key.toLowerCase() === 'content-type'
            );

            if (!hasContentType) {
                if (data.bodyType === 'json') {
                    parts.push(`-H "Content-Type: application/json"`);
                } else if (data.bodyType === 'xml') {
                    parts.push(`-H "Content-Type: application/xml"`);
                } else if (data.bodyType === 'yaml') {
                    parts.push(`-H "Content-Type: application/yaml"`);
                } else if (data.bodyType === 'form') {
                    parts.push(`-H "Content-Type: application/x-www-form-urlencoded"`);
                }
            }
        }
    }

    return parts.join(' \\\n  ');
};

/**
 * Adapt a full request object (from `getRequest`) to the internal `RequestData` shape
 * and generate a cURL command.
 */
export const generateCurlFromRequestObject = (req: any): string => {
    if (!req) return '';

    const data: RequestData = {} as RequestData;

    data.method = (req.method || req.verb || 'GET').toUpperCase();
    data.url = req.url || req.uri || req.request?.url || req.urlWithPathParams || req.urlWithPath || '';

    // Headers: expect array of { key, value, enabled? }
    const headersSrc = req.headers || req.request?.headers || [];
    data.headers = (headersSrc || [])
        .filter((h: any) => h && h.key && (h.enabled === undefined || h.enabled))
        .map((h: any) => ({ key: h.key, value: h.value || '' }));

    // Query params: support arrays from getRequest (params) or request.query
    const paramsSrc = req.params || req.query || req.request?.params || [];
    data.queryParams = (paramsSrc || [])
        .filter((p: any) => p && p.key && (p.enabled === undefined || p.enabled))
        .map((p: any) => ({ key: p.key, value: p.value || '' }));

    // Path params (not used by generateCurlCommand directly, but keep for completeness)
    const pathSrc = req.path_params || req.pathParams || req.request?.path_params || [];
    data.pathParams = (pathSrc || []).filter((p: any) => p && p.key).map((p: any) => ({ key: p.key, value: p.value || '' }));

    // Handle auth shortcuts
    if (req.auth) {
        const type = req.auth.type;
        const cfg = req.auth.config || {};
        if (type === 'bearer-token' && cfg.token) {
            data.headers = data.headers || [];
            data.headers.push({ key: 'Authorization', value: `${cfg.headerPrefix || 'Bearer'} ${cfg.token}` });
        } else if (type === 'basic-auth' && (cfg.username || cfg.password)) {
            const token = Buffer.from(`${cfg.username || ''}:${cfg.password || ''}`).toString('base64');
            data.headers = data.headers || [];
            data.headers.push({ key: 'Authorization', value: `Basic ${token}` });
        } else if (type === 'api-key') {
            // api-key: config.key, config.value, config.in
            if (cfg.in === 'query') {
                data.queryParams = data.queryParams || [];
                data.queryParams.push({ key: cfg.key || '', value: cfg.value || '' });
            } else {
                data.headers = data.headers || [];
                data.headers.push({ key: cfg.key || '', value: cfg.value || '' });
            }
        }
    }

    // Body handling - priority: binary > body > body_params
    const contentType: string = (req.content_type || req.contentType || '').toLowerCase();

    // Priority 1: Binary file (binary takes precedence)
    if (req.binary) {
        if (typeof req.binary === 'string') {
            data.body = req.binary.startsWith('@') ? req.binary : `@${req.binary}`;
            data.bodyType = 'text';
        }
    }
    // Priority 2: Explicit body string (JSON/XML/text)
    else if (req.body && typeof req.body === 'string' && req.body.trim()) {
        if (req.body.startsWith('@')) {
            // binary file reference
            data.body = req.body;
            data.bodyType = 'text';
        } else if (contentType.includes('application/json')) {
            data.body = req.body;
            data.bodyType = 'json';
        } else if (contentType.includes('application/xml') || contentType.includes('text/xml')) {
            data.body = req.body;
            data.bodyType = 'xml';
        } else if (contentType.includes('yaml')) {
            data.body = req.body;
            data.bodyType = 'yaml';
        } else {
            data.body = req.body;
            data.bodyType = 'text';
        }
    }
    // Priority 3: Body parameters (form, multipart, or reconstructed JSON)
    else if (req.body_params && Array.isArray(req.body_params) && req.body_params.length > 0) {
        const enabledParams = req.body_params.filter((p: any) => p && p.key && (p.enabled === undefined || p.enabled));
        
        if (contentType.includes('multipart')) {
            data.bodyType = 'multipart';
            data.multipartData = enabledParams.map((p: any) => {
                // File parameters: ensure @ prefix for curl -F
                const val = p.type === 'file' && typeof p.value === 'string'
                    ? (p.value.startsWith('@') ? p.value : `@${p.value}`)
                    : (p.value || '');
                return { 
                    key: p.key, 
                    value: val,
                    type: p.contentType || p.mimeType // Include content type if specified
                };
            });
        } else if (contentType.includes('application/x-www-form-urlencoded')) {
            data.bodyType = 'form';
            data.body = enabledParams
                .map((p: any) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value || '')}`)
                .join('&');
        } else if (contentType.includes('application/json')) {
            data.bodyType = 'json';
            // Reconstruct JSON object from key-value params
            const obj: Record<string, any> = {};
            enabledParams.forEach((p: any) => {
                obj[p.key] = p.value;
            });
            try {
                data.body = JSON.stringify(obj, null, 2);
            } catch (e) {
                console.error('Failed to construct JSON from params:', e);
                data.body = '';
            }
        } else {
            // Default to form-urlencoded
            data.bodyType = 'form';
            data.body = enabledParams
                .map((p: any) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value || '')}`)
                .join('&');
        }
    }

    // For multipart, DO NOT add Content-Type header manually
    // curl -F automatically sets it with the boundary
    const hasContentType = (data.headers || []).some(h => h.key && h.key.toLowerCase() === 'content-type');
    if (!hasContentType && data.bodyType !== 'multipart') {
        if (data.bodyType === 'json') {
            data.headers = [...(data.headers||[]), { key: 'Content-Type', value: 'application/json' }];
        } else if (data.bodyType === 'xml') {
            data.headers = [...(data.headers||[]), { key: 'Content-Type', value: 'application/xml' }];
        } else if (data.bodyType === 'yaml') {
            const yamlMime = (req.content_type || req.contentType || '').includes('x-yaml') ? 'application/x-yaml' : 'application/yaml';
            data.headers = [...(data.headers||[]), { key: 'Content-Type', value: yamlMime }];
        } else if (data.bodyType === 'form') {
            data.headers = [...(data.headers||[]), { key: 'Content-Type', value: 'application/x-www-form-urlencoded' }];
        }
    }

    return generateCurlCommand(data);
};

/**
 * Generate cURL command directly from ProseMirror JSON content
 * @param editor - ProseMirror Doc containing the request definition
 * @param activeDocKey - Document key/identifier
 * @param environment - Optional environment variables for variable substitution
 */
export const generateCurlFromJson = async (
    editor: any
): Promise<string> => {
    // Dynamic import of getRequest function from app
    // @ts-ignore - Path resolved at runtime in app context
    const { getRequest } = await import(/* @vite-ignore */ '@/core/request-engine/getRequestFromJson');
    const requestData = await getRequest(editor);
    return generateCurlFromRequestObject(requestData);
};