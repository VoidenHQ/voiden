/**
 * Request Population Logic
 *
 * Extracts data from Tiptap editor nodes and populates Request objects
 */

import { Editor, JSONContent } from '@tiptap/core';
import { stripJsonComments } from './utils';

// Auth types (moved to voiden-advanced-auth extension, but kept here for backward compatibility)
type AuthType =
  | "inherit"
  | "none"
  | "bearer"
  | "basic"
  | "apiKey"
  | "oauth2"
  | "oauth1"
  | "digest"
  | "ntlm"
  | "awsSignature"
  | "hawk"
  | "atlassianAsap"
  | "netrc";

type KeyValueType = {
  key: string;
  value: string;
  enabled: boolean;
  importedFrom?: string;
  type?: "text" | "file";
};

type AuthConfig = {
  authType: AuthType;
  [key: string]: any;
};

/**
 * Extract table data (headers, query params, path params, etc.) from editor
 */
function extractTableData(
  editor: JSONContent,
  type: "headers-table" | "query-table" | "url-table" | "multipart-table" | "path-table" | "cookies-table"
): KeyValueType[] {
  const allKeyValues: KeyValueType[] = [];

  editor.content?.forEach((rootNode) => {
    if (rootNode.type === type) {
      rootNode.content?.forEach((node) => {
        if (node.type === "table") {
          node.content?.forEach((rowNode) => {
            if (rowNode.type === "tableRow") {
              const keyValuePair: KeyValueType = { key: "", value: "", enabled: true, type: "text" };
              rowNode.content?.forEach((cellNode, cellIndex) => {
                if (cellNode.type === "tableCell") {
                  const textContent = ((cellNode.content && cellNode.content[0].content && cellNode.content[0].content[0]?.text) || "")?.trim();
                  if (cellIndex === 0) {
                    keyValuePair.key = textContent || "";
                  } else if (cellIndex === 1) {
                    if (type === "multipart-table") {
                      // Prefer legacy cellNode.attrs.file, then look for a fileLink inline node
                      const legacyFile = cellNode.attrs?.file || "";
                      if (legacyFile) {
                        keyValuePair.value = legacyFile;
                        keyValuePair.type = "file";
                      } else {
                        const paragraphContent = cellNode.content?.[0]?.content;
                        const fileLinkNode = paragraphContent?.find((n: any) => n.type === "fileLink");
                        if (fileLinkNode?.attrs?.filePath) {
                          keyValuePair.value = fileLinkNode.attrs.filePath;
                          keyValuePair.type = "file";
                        } else {
                          // Plain text value
                          keyValuePair.value = textContent || "";
                          keyValuePair.type = "text";
                        }
                      }
                    } else {
                      keyValuePair.value = textContent || "";
                    }
                  }
                }
              });
              if (keyValuePair.key && keyValuePair.value) {
                allKeyValues.push({
                  ...keyValuePair,
                  enabled: !rowNode.attrs?.disabled,
                  importedFrom: rootNode.attrs?.importedFrom,
                });
              }
            }
          });
        }
      });
    }
  });

  return Object.values(
    allKeyValues
      .filter((item) => item.enabled)
      .reduce(
        (acc, val) => {
          const values = acc[val.key] || [];
          values.push(val);
          return {
            ...acc,
            [val.key]: values,
          };
        },
        {} as Record<string, KeyValueType[]>,
      ),
  ).map((item) => {
    if (item.length > 1) {
      const overriddenVal = item.find((item) => !item.importedFrom);
      if (overriddenVal) return overriddenVal;
    }
    return item[0];
  });
}

/**
 * Extract auth configuration from editor
 */
function extractAuthConfig(json: JSONContent): AuthConfig | null {
  if (!json.content) return null;

  const authNode = json.content.find((node: JSONContent) => node.type === 'auth');

  if (!authNode || !authNode.attrs) return null;

  const authType = authNode.attrs.authType || 'inherit';

  // Skip if inherit or none
  if (authType === 'inherit' || authType === 'none') {
    return null;
  }

  return {
    authType,
    ...authNode.attrs,
  };
}

/**
 * Convert auth configuration to the format expected by the request engine
 * Returns auth object in app's expected format
 */
function convertAuthToRequestFormat(authConfig: AuthConfig | null) {
  if (!authConfig) {
    return undefined;
  }

  // Map auth types to app's expected format
  const typeMapping: Record<string, string> = {
    bearer: "bearer-token",
    basic: "basic-auth",
    apiKey: "api-key",
    oauth2: "oauth",
    oauth1: "oauth",
  };

  const mappedType = typeMapping[authConfig.authType];
  if (!mappedType) {
    return undefined;
  }

  let config: any = {};

  switch (authConfig.authType) {
    case 'bearer':
      config = {
        token: authConfig.bearerToken || "",
      };
      break;

    case 'basic':
      config = {
        username: authConfig.basicUsername || "",
        password: authConfig.basicPassword || "",
      };
      break;

    case 'apiKey':
      config = {
        key: authConfig.apiKeyKey || "",
        value: authConfig.apiKeyValue || "",
        in: authConfig.apiKeyIn || "header",
      };
      break;

    case 'oauth2':
      config = {
        accessToken: authConfig.oauth2AccessToken || "",
        tokenType: authConfig.oauth2TokenType || "Bearer",
      };
      break;

    case 'oauth1':
      config = {
        consumerKey: authConfig.oauth1ConsumerKey || "",
        consumerSecret: authConfig.oauth1ConsumerSecret || "",
        token: authConfig.oauth1Token || "",
        tokenSecret: authConfig.oauth1TokenSecret || "",
      };
      break;

    default:
      return undefined;
  }

  return {
    enabled: true,
    type: mappedType,
    config,
  };
}

/**
 * Get request data from editor by extracting request block content
 */
export function getRequestFromEditor(editor: Editor) {
  const json = editor.getJSON();

  if (!json.content) {
    return null;
  }

  // Find the request block (support both "request" and legacy "api")
  const requestBlock = json.content.find((node: JSONContent) => node.type === 'request' || node.type === 'api');

  if (!requestBlock) {
    return null;
  }

  // Extract method and URL from request block content
  let method = 'GET';
  let url = '';

  if (requestBlock.content && Array.isArray(requestBlock.content)) {
    const methodNode = requestBlock.content.find((node: JSONContent) => node.type === 'method');
    const urlNode = requestBlock.content.find((node: JSONContent) => node.type === 'url');

    if (methodNode?.content) {
      const textNode = methodNode.content.find((n: JSONContent) => n.type === 'text');
      if (textNode?.text) {
        method = textNode.text.toUpperCase();
      }
    }

    if (urlNode?.content) {
      const textNode = urlNode.content.find((n: JSONContent) => n.type === 'text');
      if (textNode?.text) {
        url = textNode.text;
      }
    }
  }

  // Extract tables using the common extraction function
  const headers = extractTableData(json, 'headers-table');
  const queryParams = extractTableData(json, 'query-table');
  const pathParams = extractTableData(json, 'path-table');

  // Extract cookies and merge into headers as a Cookie header
  const cookies = extractTableData(json, 'cookies-table');
  if (cookies.length > 0) {
    const cookieString = cookies
      .filter((c) => c.enabled)
      .map((c) => `${c.key}=${c.value}`)
      .join("; ");
    if (cookieString) {
      const existingCookieIdx = headers.findIndex(
        (h) => h.key.toLowerCase() === "cookie"
      );
      if (existingCookieIdx !== -1) {
        headers[existingCookieIdx] = {
          ...headers[existingCookieIdx],
          value: headers[existingCookieIdx].value + "; " + cookieString,
        };
      } else {
        headers.push({ key: "Cookie", value: cookieString, enabled: true });
      }
    }
  }

  // Extract auth configuration
  const authConfig = extractAuthConfig(json);
  const auth = convertAuthToRequestFormat(authConfig);

  // Determine content type by checking what body nodes exist
  let contentType = 'none';
  let body: string | undefined = undefined;
  let bodyParams: KeyValueType[] = [];

  // Check for JSON body
  const jsonBodyNode = json.content.find((node: JSONContent) => node.type === 'json_body');
  if (jsonBodyNode?.attrs?.body) {
    const rawBody = jsonBodyNode.attrs.body;
    const storedType = jsonBodyNode.attrs.contentType;
    if (storedType === 'html') {
      body = rawBody;
      contentType = 'text/html';
    } else if (storedType === 'text') {
      body = rawBody;
      contentType = 'text/plain';
    } else {
      // Default: strip JSONC comments and send as JSON
      body = stripJsonComments(rawBody);
      contentType = 'application/json';
    }
  }

  // Check for XML body
  const xmlBodyNode = json.content.find((node: JSONContent) => node.type === 'xml_body');
  if (xmlBodyNode?.attrs?.body) {
    body = xmlBodyNode.attrs.body;
    const xmlMimeTypes = ['application/xml', 'text/xml', 'application/xhtml+xml'];
    contentType = xmlMimeTypes.includes(xmlBodyNode.attrs.contentType) ? xmlBodyNode.attrs.contentType : 'application/xml';
  }

  // Check for YAML body
  const ymlBodyNode = json.content.find((node: JSONContent) => node.type === 'yml_body');
  if (ymlBodyNode?.attrs?.body) {
    body = ymlBodyNode.attrs.body;
    const yamlMimeTypes = ['application/x-yaml', 'application/yaml', 'text/yaml', 'text/x-yaml'];
    contentType = yamlMimeTypes.includes(ymlBodyNode.attrs.contentType) ? ymlBodyNode.attrs.contentType : 'application/x-yaml';
  }

  // Check for multipart form data
  const hasMultipartTable = json.content.some((node: JSONContent) => node.type === 'multipart-table');
  if (hasMultipartTable) {
    contentType = 'multipart/form-data';
    bodyParams = extractTableData(json, 'multipart-table');
  }

  // Check for URL-encoded form data
  const hasUrlTable = json.content.some((node: JSONContent) => node.type === 'url-table');
  if (hasUrlTable) {
    contentType = 'application/x-www-form-urlencoded';
    bodyParams = extractTableData(json, 'url-table');
  }

  // Build request object
  return {
    method,
    url,
    headers,
    queryParams,
    pathParams,
    body,
    bodyParams,
    contentType,
    auth,
  };
}

/**
 * Populate request state from editor content
 * This matches the RestApiRequestState interface from the SDK
 */
export function populateRequestState(editor: Editor) {
  const request = getRequestFromEditor(editor);

  if (!request) {
    return null;
  }

  return {
    method: request.method,
    url: request.url,
    headers: request.headers.map((h) => ({
      key: h.key,
      value: h.value,
      enabled: h.enabled,
    })),
    queryParams: request.queryParams.map((q) => ({
      key: q.key,
      value: q.value,
      enabled: q.enabled,
    })),
    pathParams: request.pathParams.map((p) => ({
      key: p.key,
      value: p.value,
      enabled: p.enabled,
    })),
    body: request.body,
    bodyParams: request.bodyParams.map((bp) => ({
      key: bp.key,
      value: bp.value,
      enabled: bp.enabled,
      type: bp.type,
    })),
    contentType: request.contentType,
    auth: request.auth,
    metadata: {
      source: 'voiden-rest-api',
    },
  };
}
