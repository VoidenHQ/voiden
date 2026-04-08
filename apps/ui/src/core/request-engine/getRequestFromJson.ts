import { JSONContent } from "@tiptap/core";
import { BodyParam, ContentType, PreRequestResult, Request, RequestParam, TestResult } from "@/core/types";
import { v4 } from "uuid";

import { executeScriptInContext as preRequestExecutor } from "@/core/request-engine/components/worker";

/**
 * Strip comments from JSONC (JSON with Comments)
 * Removes both single-line (//) and multi-line (/* *\/) comments
 */
function stripJsonComments(jsonc: string): string {
  let result = '';
  let i = 0;
  let inString = false;
  let stringChar = '';

  while (i < jsonc.length) {
    const char = jsonc[i];
    const nextChar = jsonc[i + 1];

    // Handle string boundaries
    if ((char === '"' || char === "'") && (i === 0 || jsonc[i - 1] !== '\\')) {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
        stringChar = '';
      }
      result += char;
      i++;
      continue;
    }

    // If we're inside a string, just copy the character
    if (inString) {
      result += char;
      i++;
      continue;
    }

    // Handle single-line comments //
    if (char === '/' && nextChar === '/') {
      // Skip until end of line
      i += 2;
      while (i < jsonc.length && jsonc[i] !== '\n' && jsonc[i] !== '\r') {
        i++;
      }
      // Keep the newline for formatting
      if (i < jsonc.length && (jsonc[i] === '\n' || jsonc[i] === '\r')) {
        result += jsonc[i];
        i++;
      }
      continue;
    }

    // Handle multi-line comments /* */
    if (char === '/' && nextChar === '*') {
      i += 2;
      // Skip until we find */
      while (i < jsonc.length - 1) {
        if (jsonc[i] === '*' && jsonc[i + 1] === '/') {
          i += 2;
          break;
        }
        i++;
      }
      continue;
    }

    // Regular character
    result += char;
    i++;
  }

  return result;
}

interface CliReqObject {
  isCli: boolean;
  documentId: string;
  cliToken: string;
}

export const getFileExtension = (contentType: string): string => {
  const extensionMap: { [key: string]: string } = {
    "application/json": ".json",
    "text/plain": ".txt",
    "application/xml": ".xml",
    "application/pdf": ".pdf",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "audio/mpeg": ".mp3",
    "video/mp4": ".mp4",
    "text/csv": ".csv",
    "text/html": ".html",
    "application/zip": ".zip",
    "application/octet-stream": "",
    "audio/wav": ".wav",
    "video/webm": ".webm",
    "image/gif": ".gif",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/epub+zip": ".epub",
    "text/css": ".css",
    "application/javascript": ".js",
    "audio/aac": ".aac",
    "video/x-msvideo": ".avi",
    "application/java-archive": ".jar",
    "image/bmp": ".bmp",
    "application/vnd.oasis.opendocument.text": ".odt",
    "application/vnd.oasis.opendocument.spreadsheet": ".ods",
    "application/vnd.oasis.opendocument.presentation": ".odp",
    "audio/ogg": ".ogg",
    "video/ogg": ".ogv",
    "application/rtf": ".rtf",
    "application/x-tar": ".tar",
    "image/tiff": ".tiff",
    "audio/webm": ".weba",
    "image/webp": ".webp",
    "audio/flac": ".flac",
    "font/woff": ".woff",
    "font/woff2": ".woff2",
    "application/xhtml+xml": ".xhtml",
    "application/x-shockwave-flash": ".swf",
    "text/calendar": ".ics",
    "application/x-7z-compressed": ".7z",
    "video/x-matroska": ".mkv",
    "video/3gp": ".3gp",
  };
  return extensionMap[contentType] || "";
};

export const createNewRequestObject = ({
  _id,
  tabId,
  collection_id,
  parent_id,
  name,
  method,
  url,
  path_params,
  params,
  headers,
  content_type,
  body,
  body_params,
  auth,
  prescript,
  postscript,
  isModified,
}: Partial<Request> = {}): Request => {
  return {
    tabId: v4(),
    _id: _id,
    collection_id: undefined,
    parent_id: undefined,
    path_params: path_params || [],
    name: "Undefined",
    method: method || "GET",
    url: url || "",
    params: params || [],
    headers: headers || [],
    content_type: content_type || "none",
    body: body || "",
    body_params: body_params || [],
    auth: auth || {
      enabled: false,
      type: "none",
      config: undefined,
    },
    prescript: prescript || "",
    postscript: postscript || "",
    isModified: false,
  };
};

export function prepareRequest(editor: Doc) {
  let body = undefined;
  let body_params = undefined;
  let content_type = undefined;

  const contentArray = editor.content;

  for (let i = contentArray.length - 1; i >= 0; i--) {
    const node = contentArray[i];
    if (node.type === "json_body") {
      body = node.attrs?.body;
      content_type = "application/json";
      break;
    } else if (node.type === "multipart-table") {
      body_params = node.attrs?.body_params;
      content_type = "multipart/form-data";
      break;
    }
  }

  return {
    body,
    body_params,
    content_type,
  };
}

export const createRequestObject = ({ activeDocKey, editor, method, url }: { activeDocKey: string; editor: Doc; method: string; url: string }) => {
  const preparedRequest = editor && prepareRequest(editor);

  const findNode = (content: JSONContent[], nodeName: string) => {
    return content.find((node) => node.type === nodeName);
  };

  const headers = findNode(editor.content, "headers-table")?.attrs?.headers;
  const params = findNode(editor.content, "query_params")?.attrs?.params;

  return createNewRequestObject({
    _id: activeDocKey,
    method: method,
    url,
    headers: headers || [],
    params: params || [],
    content_type: (preparedRequest?.content_type as ContentType) || "none",
    body_params: preparedRequest?.body_params,
    body: preparedRequest?.body,
  });
};

export const REQUEST_NODES = [
  "api",        // New container block type
  "request",    // Legacy container block type (backward compatibility)
  "method",
  "url",
  "headers-table",
  "query-table",
  "url-table",
  "multipart-table",
  "cookies-table",
  "options-table",
  "json_body",
  "xml_body",
  "yml_body",
  "auth",       // Authorization block
  "pre_request_block",
  "post_request_block",
  "documentation",
];

export type Doc = {
  type: "doc";
  content: JSONContent[];
};

export const findNode = (editor: Doc, nodeName: string) => {
  return editor.content.find((node) => node.type === nodeName);
};
export const findNodes = (editor: Doc, nodeName: string) => {
  return editor.content.filter((node) => node.type === nodeName);
};
const getTable = (type: "headers-table" | "query-table" | "url-table" | "multipart-table" | "path-table" | "cookies-table" | "options-table" | "file" | "runtime-variables", editor: Doc, environment?: Record<string, string>) => {
  type KeyValueType = {
    key: string;
    value: string;
    enabled: boolean;
    importedFrom?: string;
    type?: "text" | "file";
  };
  const allKeyValues: KeyValueType[] = [];

  editor?.content.forEach((rootNode) => {
    if (rootNode.type === type) {

      rootNode.content?.forEach((node) => {
        if (node.type === "table") {
          node.content?.forEach((rowNode) => {
            if (rowNode.type === "tableRow") {
              const keyValuePair: KeyValueType = { key: "", value: "", enabled: true, type: "text" };
              rowNode.content?.forEach((cellNode, cellIndex) => {
                if (cellNode.type === "tableCell") {
                  const textContent = ((cellNode.content && cellNode.content[0].content && cellNode.content[0].content[0]?.text) || "").trim();
                  if (cellIndex === 0) {
                    keyValuePair.key = textContent || "";
                  } else if (cellIndex === 1) {
                    if (type === "multipart-table") {
                      keyValuePair.value = cellNode.attrs?.file || "";
                      keyValuePair.type = "file";
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



  // Replace environment variables in values
  const replaceEnv = (text: string) => (environment ? replaceEnvVariables(text, environment) : text);

  // Group by key
  const groupedByKey = allKeyValues
    .filter((item) => item.enabled)
    .reduce(
      (acc, val) => {
        const values = acc[val.key] || [];
        values.push({ ...val, value: replaceEnv(val.value) });
        return {
          ...acc,
          [val.key]: values,
        };
      },
      {} as Record<string, KeyValueType[]>,
    );



  // Apply override logic: local values (without importedFrom) override imported ones
  const result = Object.values(groupedByKey).map((items) => {
    if (items.length > 1) {

      const localValue = items.find((item) => !item.importedFrom);
      if (localValue) {

        return localValue;
      }

    }
    return items[0];
  });


  return result;
};

// Add this type definition
interface GrpcConfig {
  fileName: string;
  filePath: string;
  service: string;
  package:string;
  method: string;
  callType: 'unary' | 'server_streaming' | 'client_streaming' | 'bidirectional_streaming';
  requestType: string;
  responseType: string;
}

// Full updated section in context:

export const getRequest = async (
  editor: Doc,
  activeDocKey: string,
  environment?: Record<string, string>,
  cliReqObject?: CliReqObject,
  base_url?: string,
  getFileIfNotExistFn?: (docId: string, fileId: string, fileName: string) => Promise<File | null>,
) => {
  const preRequestCodeBlock = findNode(editor, "pre_request_block")?.attrs?.body;
  const postRequestCodeBlock = findNodes(editor, "post_request_block")
    ?.map((node) => node?.attrs?.body)
    .join(`\n`);

  // Detect protocol type from editor
  const getProtocolType = (editor: Doc)=> {
    // Check for GraphQL query node
    const gqlQueryNode = findNode(editor, "gqlquery");
    if (gqlQueryNode) {
      return 'graphql';
    }
    
    // Check for socket node
    const endpointNode = findNode(editor, "socket-request");
    const method = endpointNode?.content?.find((node) => node.type === "smethod")?.content?.[0]?.text || "GET";
    if(method.toLowerCase() === "wss" || method.toLowerCase() === "ws" || method.toLowerCase()==='grpc' || method.toLowerCase()==='grpcs') {
      return method.toLowerCase();
    }
    // Default to REST
    return 'rest';
  };

  const protocolType = getProtocolType(editor);

  const getMethod = (editor: Doc): string => {
    // Support both "api" (new) and "request" (legacy) block types
    const endpointNode = findNode(editor, "api") || findNode(editor, "request") || findNode(editor, "socket-request");
    const method = endpointNode?.content?.find((node) => node.type === "method")?.content?.[0]?.text || "GET";
    return method;
  };

  const getUrl = (editor: Doc): string => {
    // Support both "api" (new) and "request" (legacy) block types
    const endpointNode = findNode(editor, "api") || findNode(editor, "request") || findNode(editor, "socket-request");
    const url = endpointNode?.content?.find((node) => node.type === "url")?.content?.[0]?.text || endpointNode?.content?.find((node) => node.type === "surl")?.content?.[0]?.text || "";
    return url;
  };

  // WebSocket specific getters
  const getWebSocketUrl = (editor: Doc): string => {
    const wsNode = findNode(editor, "socket-request");
    const url = wsNode?.content?.find((node) => node.type === "surl")?.content?.[0]?.text || "";
    return url;
  };

  // gRPC specific getters
  const getGrpcConfig = (editor: Doc): GrpcConfig | null => {
    const protoNode = findNode(editor, "socket-request")?.content?.find((node) => node.type === "proto");
    
    if (!protoNode || !protoNode.attrs) {
      return null;
    }

    const { fileName, selectedService,packageName, selectedMethod, callType, services } = protoNode.attrs;

    if (!fileName || !selectedService || !selectedMethod) {
      return null;
    }

    // Find the selected service and method details
    const service = services?.find((s: any) => s.name === selectedService);
    const method = service?.methods?.find((m: any) => m.name === selectedMethod);

    return {
      fileName,
      package:packageName,
      filePath: protoNode.attrs.filePath || fileName,
      service: selectedService,
      method: selectedMethod,
      callType: callType || method?.callType || 'unary',
      requestType: method?.request || '',
      responseType: method?.response || '',
    };
  };

  const getGrpcMetadata = (editor: Doc): Record<string, string> => {
    const metadata: Record<string, string> = {};

    editor.content?.forEach((node) => {
      if (node.type === "headers-table") {
        node.content?.forEach((rowNode) => {
          if (rowNode.type === "tableRow" && !rowNode.attrs?.disabled) {
            const keyCol = rowNode.content?.[0];
            const valCol = rowNode.content?.[1];

            if (keyCol && valCol && keyCol.type === "tableCell" && valCol.type === "tableCell") {
              const key = ((keyCol.content && keyCol.content[0]?.content && keyCol.content[0].content[0]?.text) || "").trim();
              const value = ((valCol.content && valCol.content[0]?.content && valCol.content[0].content[0]?.text) || "").trim();

              if (key && value) {
                metadata[key] = value;
              }
            }
          }
        });
      }
    });

    return metadata;
  };

  const getAuth = (editor: Doc) => {
    const authNode = findNode(editor, "auth");

    if (!authNode || !authNode.attrs) {
      return undefined;
    }

    const authType = authNode.attrs.authType;

    // Skip if inherit or none
    if (authType === "inherit" || authType === "none") {
      return undefined;
    }

    // Map auth types from AuthNode to app's expected format
    const typeMapping: Record<string, string> = {
      bearer: "bearer-token",
      basic: "basic-auth",
      apiKey: "api-key",
      oauth2: "oauth2",
      oauth1: "oauth1",
      digest: "digest-auth",
      ntlm: "ntlm",
      awsSignature: "aws-signature",
      hawk: "hawk",
      atlassianAsap: "atlassian-asap",
      netrc: "netrc",
    };

    const mappedType = typeMapping[authType];
    if (!mappedType) {
      return undefined;
    }

    // Extract auth parameters from table
    const config: Record<string, string> = {};

    // Look for table inside auth node
    if (authNode.content) {
      authNode.content.forEach((node) => {
        if (node.type === "table") {
          node.content?.forEach((rowNode) => {
            if (rowNode.type === "tableRow") {
              let key = "";
              let value = "";

              rowNode.content?.forEach((cellNode, cellIndex) => {
                if (cellNode.type === "tableCell") {
                  const textContent = ((cellNode.content && cellNode.content[0]?.content && cellNode.content[0].content[0]?.text) || "").trim();
                  if (cellIndex === 0) {
                    key = textContent;
                  } else if (cellIndex === 1) {
                    value = textContent;
                  }
                }
              });

              if (key) {
                config[key] = value;
              }
            }
          });
        }
      });
    }

    // Map table keys to expected config keys based on auth type
    let finalConfig: any = {};

    switch (authType) {
      case "bearer":
        finalConfig = {
          token: config.token || "",
        };
        break;

      case "basic":
        finalConfig = {
          username: config.username || "",
          password: config.password || "",
        };
        break;

      case "apiKey":
        finalConfig = {
          key: config.key || "",
          value: config.value || "",
          in: config.add_to || "header",
        };
        break;

      case "oauth2": {
        // Read extended config from oauth2Config node attribute if available
        let oauth2Attrs: Record<string, any> = {};
        try {
          const rawAttr = authNode.attrs?.oauth2Config;
          if (rawAttr && typeof rawAttr === "string") oauth2Attrs = JSON.parse(rawAttr);
          else if (rawAttr && typeof rawAttr === "object") oauth2Attrs = rawAttr;
        } catch { /* ignore parse errors */ }

        const varPrefix = oauth2Attrs.variablePrefix || "oauth2";
        finalConfig = {
          accessToken: `{{process.${varPrefix}_access_token}}`,
          tokenType: `{{process.${varPrefix}_token_type}}`,
          headerPrefix: oauth2Attrs.headerPrefix || "Bearer",
          addTokenTo: oauth2Attrs.addTokenTo || "header",
          autoRefresh: oauth2Attrs.autoRefresh === true,
          variablePrefix: varPrefix,
          grantType: oauth2Attrs.grantType || "authorization_code",
          // Read from table cells with fallback to oauth2Config attrs for backward compat
          tokenUrl: config.token_url || oauth2Attrs.tokenUrl || "",
          clientId: config.client_id || oauth2Attrs.clientId || "",
          clientSecret: config.client_secret || oauth2Attrs.clientSecret || "",
          scope: config.scope || "",
          refreshToken: `{{process.${varPrefix}_refresh_token}}`,
          // Additional fields for auto-acquisition during pipeline execution
          authUrl: config.auth_url || "",
          callbackUrl: config.callback_url || "",
          state: config.state || "",
          username: config.username || "",
          password: config.password || "",
          clientAuthMethod: oauth2Attrs.clientAuthMethod || "client_secret_post",
          customParams: oauth2Attrs.customParams || "",
        };
        break;
      }

      case "oauth1":
        finalConfig = {
          consumerKey: config.consumer_key || "",
          consumerSecret: config.consumer_secret || "",
          token: config.access_token || "",
          tokenSecret: config.token_secret || "",
          signatureMethod: config.signature_method || "HMAC-SHA1",
        };
        break;

      case "digest":
        finalConfig = {
          username: config.username || "",
          password: config.password || "",
          realm: config.realm || "",
          algorithm: config.algorithm || "MD5",
        };
        break;

      case "ntlm":
        finalConfig = {
          username: config.username || "",
          password: config.password || "",
          domain: config.domain || "",
          workstation: config.workstation || "",
        };
        break;

      case "awsSignature":
        finalConfig = {
          accessKey: config.access_key || "",
          secretKey: config.secret_key || "",
          region: config.region || "us-east-1",
          service: config.service || "execute-api",
        };
        break;

      default:
        // For other types, pass through the config as-is
        finalConfig = config;
        break;
    }

    const authResult = {
      enabled: true,
      type: mappedType,
      config: finalConfig,
    };

    return authResult;
  };

  // Get appropriate URL and method based on protocol type
  let method: string;
  let rawUrl: string;

  if (protocolType === 'wss' || protocolType === 'ws') {
    method = 'CONNECT'; // WebSocket uses CONNECT
    rawUrl = getWebSocketUrl(editor);
  } else if (protocolType === 'grpc' || protocolType === 'grpcs') {
    const grpcConfig = getGrpcConfig(editor);
    method = grpcConfig?.method || 'UnknownMethod';
    rawUrl = getUrl(editor); // gRPC server URL
  } else if (protocolType === 'graphql') {
    method = 'POST'; // GraphQL uses POST
    rawUrl = getUrl(editor);
  } else {
    method = getMethod(editor);
    rawUrl = getUrl(editor);
  }

  const auth = getAuth(editor);
  const pathParams = getTable("path-table", editor, environment);

  const urlWithPathParams = pathParams.reduce((acc, param) => {
    if (param.enabled && param.key && param.value) {
      const regex = new RegExp(`{${param.key}}`, "g");
      return acc.replace(regex, encodeURIComponent(param.value));
    }
    return acc;
  }, rawUrl);

  const request =
    (editor &&
      createRequestObject({
        activeDocKey,
        editor,
        method,
        url: urlWithPathParams,
      })) ??
    undefined;

  /**
   * Get content type from editor nodes
   */
  const getContentType = () => {
    const normalizedHeaderContentType = (() => {
      const headersTable = getTable("headers-table", editor, environment);
      const contentTypeHeader = headersTable.find((h) => h.key?.toLowerCase() === "content-type");
      return contentTypeHeader?.value?.split(";")[0]?.trim()?.toLowerCase() || "";
    })();

    if (normalizedHeaderContentType) {
      if (["application/json", "application/hal+json", "text/json"].includes(normalizedHeaderContentType)) {
        return "application/json";
      }
      if (["application/xml", "text/xml"].includes(normalizedHeaderContentType)) {
        return "application/xml";
      }
      if (["application/x-yaml", "application/yaml", "text/yaml", "text/x-yaml"].includes(normalizedHeaderContentType)) {
        return "application/x-yaml";
      }
    }

    let contentType = "none";

    editor.content?.forEach((node) => {
      if (node.type === "multipart-table") {
        contentType = "multipart/form-data";
      } else if (node.type === "url-table") {
        contentType = "application/x-www-form-urlencoded";
      } else if (node.type === "json_body") {
        contentType = "application/json";
      } else if (node.type === "xml_body") {
        contentType = "application/xml";
      } else if (node.type === "yml_body") {
        contentType = "application/x-yaml";
      } else if (node.type === "file") {
        contentType = getFileExtension(node.attrs?.extension || "");
      }
    });

    return contentType;
  };

  const getBodyParams = async () => {
    const contentType = getContentType();
    const nodeType = (() => {
      switch (contentType) {
        case "multipart/form-data":
          return "multipart-table";
        case "application/x-www-form-urlencoded":
          return "url-table";
        case "application/json":
        case "text/plain":
        default:
          return "json_body";
      }
    })();

    type BodyParamWithImport = BodyParam & { importedFrom?: string };
    const allBodyParams: BodyParamWithImport[] = [];

    for (const node of editor.content || []) {
      if (node.type === nodeType) {
        const importedFrom = node.attrs?.importedFrom;

        for (const bodyNode of node.content || []) {
          if (bodyNode.type === "table") {
            for (const row of bodyNode.content || []) {
              if (row.type !== "tableRow") continue;

              const keyCol = row.content?.[0];
              const valCol = row.content?.[1];

              if (!keyCol || keyCol.type !== "tableCell") continue;
              if (!valCol || valCol.type !== "tableCell") continue;

              const key = ((keyCol.content && keyCol.content[0]?.content && keyCol.content[0].content[0]?.text) || "").trim();

              let value: string | File;
              let type: "text" | "file" = "text";

              if (nodeType === "multipart-table") {
                const filePath = valCol.attrs?.file;
                if (filePath) {
                  value = filePath;
                  type = "file";
                } else {
                  const fileLinkNode = valCol.content?.[0]?.content?.find((node: JSONContent) => node.type === "fileLink");
                  if (fileLinkNode?.attrs?.filePath) {
                    value = fileLinkNode.attrs.filePath;
                    type = "file";
                  } else {
                    const fileNode = valCol.content?.[0]?.content?.find((node: JSONContent) => node.type === "file");
                    if (fileNode?.attrs?.filePath) {
                      value = fileNode.attrs.filePath;
                      type = "file";
                    } else if (fileNode?.attrs?.actualFile) {
                      value = fileNode.attrs.actualFile;
                      type = "file";
                    } else {
                      const tableFileNode = valCol.content?.[0]?.content?.find((node: JSONContent) => node.type === "table-file");
                      if (tableFileNode?.attrs?.file) {
                        value = tableFileNode.attrs.file;
                        type = "file";
                      } else {
                        value = ((valCol.content && valCol.content[0]?.content && valCol.content[0].content[0]?.text) || "").trim();
                        type = "text";
                      }
                    }
                  }
                }
              } else {
                value = ((valCol.content && valCol.content[0]?.content && valCol.content[0].content[0]?.text) || "").trim();
                type = "text";
              }

              if (!key || !value) {
                continue;
              }

              allBodyParams.push({
                enabled: !row.attrs?.disabled,
                type,
                key,
                value: value,
                importedFrom,
              });
            }
          }
        }
      }
    }

    const paramsByKey = allBodyParams.reduce(
      (acc, param) => {
        const params = acc[param.key] || [];
        params.push(param);
        return {
          ...acc,
          [param.key]: params,
        };
      },
      {} as Record<string, BodyParamWithImport[]>,
    );

    const bodyParams: BodyParam[] = Object.values(paramsByKey).map((params) => {
      if (params.length > 1) {
        const localParam = params.find((p) => !p.importedFrom);
        if (localParam) {
          const { importedFrom, ...rest } = localParam;
          return rest;
        }
      }
      const { importedFrom, ...rest } = params[0];
      return rest;
    });

    return bodyParams;
  };

  const getBinary = () => {
    let file: File | string | undefined;
    editor.content?.forEach((node) => {
      if (node.type === "restFile") {
        node.content?.forEach((child) => {
          if (child.type === "file" && child?.attrs?.filePath) {
            file = child.attrs.filePath;
          } else if (child.type === "fileLink" && child?.attrs?.filePath) {
            file = child.attrs.filePath;
          } else if (child.type === "file" && (child?.attrs?.actualFile || child?.attrs?.file)) {
            file = (child?.attrs?.actualFile as any as File) || (child?.attrs?.file as any as File);
          }
        });
      }
    });
    return file;
  };

  const deepMergeJSON = (imported: any, local: any): any => {
    if (local === null || typeof local !== "object" || Array.isArray(local)) {
      return local;
    }

    if (imported === null || typeof imported !== "object" || Array.isArray(imported)) {
      return local;
    }

    const result: any = { ...imported };

    for (const key in local) {
      if (local.hasOwnProperty(key)) {
        if (result.hasOwnProperty(key) && typeof result[key] === "object" && !Array.isArray(result[key]) &&
          typeof local[key] === "object" && !Array.isArray(local[key])) {
          result[key] = deepMergeJSON(result[key], local[key]);
        } else {
          result[key] = local[key];
        }
      }
    }

    return result;
  };

  const getRequestBody = () => {
    const getHeaderContentType = () => {
      const headersTable = getTable("headers-table", editor, environment);
      const contentTypeHeader = headersTable.find((h) => h.key?.toLowerCase() === "content-type");
      return contentTypeHeader?.value?.split(";")[0]?.trim()?.toLowerCase() || "";
    };

    const pickBodyNode = (type: "json_body" | "xml_body" | "yml_body") => {
      const nodes = editor.content?.filter((val) => val.type === type);
      if (!nodes || nodes.length === 0) return null;
      const local = nodes.find((item) => !item?.attrs?.importedFrom);
      if (local) return local;
      return nodes.find((item) => item?.attrs?.importedFrom) || null;
    };

    const pickLatestBodyNode = () => {
      const bodyNodeTypes = new Set(["json_body", "xml_body", "yml_body"]);
      for (let i = (editor.content?.length || 0) - 1; i >= 0; i--) {
        const node = editor.content?.[i];
        if (node?.type && bodyNodeTypes.has(node.type)) {
          return node;
        }
      }
      return null;
    };

    const headerContentType = getHeaderContentType();

    let selectedNode: JSONContent | null = null;
    if (["application/json", "application/hal+json", "text/json"].includes(headerContentType)) {
      selectedNode = pickBodyNode("json_body");
    } else if (["application/xml", "text/xml"].includes(headerContentType)) {
      selectedNode = pickBodyNode("xml_body");
    } else if (["application/x-yaml", "application/yaml", "text/yaml", "text/x-yaml"].includes(headerContentType)) {
      selectedNode = pickBodyNode("yml_body");
    } else {
      selectedNode = pickLatestBodyNode();
    }

    if (!selectedNode) {
      selectedNode = pickLatestBodyNode();
    }

    if (selectedNode?.type === "xml_body" || selectedNode?.type === "yml_body") {
      return selectedNode.attrs?.body || "";
    }

    // Collect ALL json_body nodes so imported + local bodies can be deep merged
    const content = editor.content?.filter((val: any) => val.type === "json_body");

    const importedBodies = content?.filter((item) => item?.attrs?.importedFrom);
    const localBodies = content?.filter((item) => !item?.attrs?.importedFrom);


    if (!content || content.length === 0) {
      return "";
    }

    if (localBodies && localBodies.length > 0 && (!importedBodies || importedBodies.length === 0)) {
      const body = localBodies[0]?.attrs?.body || "";
      return stripJsonComments(body);
    }

    if (importedBodies && importedBodies.length > 0 && (!localBodies || localBodies.length === 0)) {
      const body = importedBodies[0]?.attrs?.body || "";
      return stripJsonComments(body);
    }

    try {
      const importedBody = stripJsonComments(importedBodies?.[0]?.attrs?.body || "{}");
      const localBody = stripJsonComments(localBodies?.[0]?.attrs?.body || "{}");

      const importedJSON = JSON.parse(importedBody);
      const localJSON = JSON.parse(localBody);

      const mergedJSON = deepMergeJSON(importedJSON, localJSON);

      return JSON.stringify(mergedJSON, null, 2);
    } catch (error) {
      const fallbackBody = localBodies?.[0]?.attrs?.body || importedBodies?.[0]?.attrs?.body || "";
      return stripJsonComments(fallbackBody);
    }
  };

  // Helper to get GraphQL data
  const getGraphQLData = () => {
    const gqlQueryNode = findNode(editor, "gqlquery");
    if (!gqlQueryNode) return null;

    const query = gqlQueryNode.attrs?.body || '';
    let operationType = gqlQueryNode.attrs?.operationType || 'query';
    
    // Use operationName from node attributes if present, otherwise parse from query
    let operationName: string | undefined = gqlQueryNode.attrs?.operationName;
    
    if (!operationName) {
      // Parse operation details from query text as fallback
      const operationMatch = query.match(/^\s*(query|mutation|subscription)\s+([\w]+)?/);
      if (operationMatch) {
        operationType = operationMatch[1];
        operationName = operationMatch[2];
      }
    }

    // Get variables
    const gqlVariablesNode = findNode(editor, "gqlvariables");
    let variables: any = {};
    if (gqlVariablesNode) {
      try {
        variables = JSON.parse(gqlVariablesNode.attrs?.body || '{}');
      } catch (e) {
        console.error('Failed to parse GraphQL variables:', e);
      }
    }

    return {
      query,
      variables,
      operationType,
      operationName,
    };
  };

  // Build headers with cookies merged in
  const getHeadersWithCookies = () => {
    const headers = [...getTable("headers-table", editor, environment)];
    const cookies = getTable("cookies-table", editor, environment);
    if (cookies.length > 0) {
      const cookieString = cookies
        .map((c) => `${c.key}=${c.value}`)
        .join("; ");
      const existingCookieIdx = headers.findIndex(
        (h) => h.key.toLowerCase() === "cookie"
      );
      if (existingCookieIdx !== -1) {
        // Append to existing Cookie header
        headers[existingCookieIdx] = {
          ...headers[existingCookieIdx],
          value: headers[existingCookieIdx].value + "; " + cookieString,
        };
      } else {
        headers.push({ key: "Cookie", value: cookieString, enabled: true });
      }
    }
    return headers;
  };

  // Build protocol-specific output
  let output: any;

  if (protocolType === 'wss' || protocolType==='ws') {
    output = {
      ...request,
      protocolType: 'wss',
      url: urlWithPathParams,
      headers: getHeadersWithCookies(),
      params: getTable("query-table", editor, environment),
      auth: auth || request.auth,
    };
  } else if (protocolType === 'graphql') {
    const graphqlData = getGraphQLData();
    output = {
      ...request,
      protocolType: 'graphql',
      operationType: graphqlData?.operationType || 'query',
      url: urlWithPathParams,
      headers: getHeadersWithCookies(),
      body: JSON.stringify({
        query: graphqlData?.query || '',
        variables: graphqlData?.variables || {},
        operationName: graphqlData?.operationName,
      }),
      content_type: 'application/json',
      prescript: preRequestCodeBlock,
      postscript: postRequestCodeBlock,
      auth: auth || request.auth,
    };
  } else if (protocolType === 'grpc' || protocolType === 'grpcs') {
    const grpcConfig = getGrpcConfig(editor);
    output = {
      ...request,
      protocolType: 'grpc',
      url: urlWithPathParams,
      body: getRequestBody(),
      auth: auth || request.auth,
      prescript: preRequestCodeBlock,
      postscript: postRequestCodeBlock,
      grpc: grpcConfig ? {
        // Proto file information
        protoFile: grpcConfig.fileName,
        protoFilePath: grpcConfig.filePath,
        package:grpcConfig.package,
        // Service and method
        service: grpcConfig.service,
        method: grpcConfig.method,
        
        // Call type information (unary, server_streaming, client_streaming, bidirectional_streaming)
        callType: grpcConfig.callType,
        
        // Message types for validation/debugging
        requestType: grpcConfig.requestType,
        responseType: grpcConfig.responseType,
        
        // Metadata (gRPC headers)
        metadata: getGrpcMetadata(editor),
        
        // Request payload (JSON that will be serialized to protobuf)
        payload: getRequestBody(),
      } : null,
    };
  } else {
    // Extract per-request options from options-table
    const optionsTable = getTable("options-table", editor, environment);
    const options: Record<string, string> = {};
    for (const opt of optionsTable) {
      if (opt.enabled) {
        options[opt.key] = opt.value;
      }
    }

    output = {
      ...request,
      protocolType: 'rest',
      headers: getHeadersWithCookies(),
      params: getTable("query-table", editor, environment),
      path_params: getTable("path-table", editor, environment),
      content_type: getContentType(),
      body_params: await getBodyParams(),
      binary: getBinary(),
      body: getRequestBody(),
      prescript: preRequestCodeBlock,
      postscript: postRequestCodeBlock,
      auth: auth || request.auth,
      options,
    } as Request;
  }

  // Convert the environment record to an array for pre-request execution
  const scriptEnvs: TestResult["envs"] = {
    global: [],
    selected: environment
      ? Object.entries(environment).map(([key, value]) => ({
        key,
        value,
        secret: false,
      }))
      : [],
  };

  let preRequestResult: PreRequestResult | undefined = undefined;
  preRequestResult = environment ? preRequestExecutor(output.prescript, scriptEnvs) : undefined;

  const updatedEnvValues =
    preRequestResult?.right?.selected?.map(({ key, value }) => ({
      key,
      value,
    })) || [];

  const updatedEnvRecord: Record<string, string> = updatedEnvValues.reduce(
    (acc, { key, value }) => {
      acc[key] = value;
      return acc;
    },
    {} as Record<string, string>,
  );

  // Only replace environment variables if we actually have an environment
  const newOutput = Object.keys(updatedEnvRecord).length > 0
    ? replaceEnvVariablesInRequest({ ...output, preRequestResult: preRequestResult }, updatedEnvRecord)
    : { ...output, preRequestResult: preRequestResult };

  return newOutput;
};

export const getRuntimeVariablesMap = async (editor: Doc, environment?: Record<string, string>) => {
  return getTable("runtime-variables", editor, environment);

}

export function replaceEnvVariables(text: string, environment?: Record<string, string>): string {
  // Don't replace if no environment or empty environment
  if (!environment || Object.keys(environment).length === 0) return text;
  const regex = /\{\{(.+?)\}\}/g;
  return text.replace(regex, (match, variable) => {
    // Skip faker variables - they'll be processed by the faker plugin
    if (variable.startsWith('$faker.')) {
      return match; // Return the original {{$faker.xxx()}} untouched
    }

    if (environment.hasOwnProperty(variable)) {
      return environment[variable];
    } else {
      return "null";
    }
  });
}

export function applyPathParamsToUrl(url: string, pathParams: RequestParam[], environment?: Record<string, string>): string {
  return pathParams.reduce(
    (acc, param) => {
      if (param.enabled && param.key) {
        const key = replaceEnvVariables(param.key, environment);
        const value = replaceEnvVariables(param.value, environment);
        const regex = new RegExp(`\\{${key}\\}`, "g");
        return acc.replace(regex, encodeURIComponent(value));
      }
      return acc;
    },
    replaceEnvVariables(url, environment),
  );
}

export function injectPathParamsIntoRequest(request: Request, environment?: Record<string, string>): Request {
  const updatedUrl = applyPathParamsToUrl(request.url, request.path_params || [], environment);
  return {
    ...request,
    url: updatedUrl,
  };
}
export async function getRequestWithPathParams(request: Request, environment?: Record<string, string>): Promise<Request> {
  const updated = injectPathParamsIntoRequest(request, environment);
  return updated;
}
export function replaceEnvVariablesInRequest(data: Request, environment?: Record<string, string>): Request {
  const replaceInString = (text: string) => replaceEnvVariables(text, environment);

  const replaceInParams = (params: RequestParam[]) =>
    params.map((param) => ({
      ...param,
      key: replaceInString(param.key),
      value: replaceInString(param.value),
    }));

  const replacedHeaders = replaceInParams(data.headers);
  const replacedParams = replaceInParams(data.params);
  const replacedPathParams = replaceInParams(data.path_params || []);

  const replacedBody = replaceInString(data.body);
  const replacedBodyParams = data.body_params.map((param) => ({
    ...param,
    value: typeof param.value === "string" ? replaceInString(param.value) : param.value,
  }));

  const replaceInAuthConfig = (authConfig: Record<string, string>, authType: string) => {
    switch (authType) {
      case "basic-auth":
        return {
          ...authConfig,
          username: replaceInString(authConfig.username),
          password: replaceInString(authConfig.password),
        };
      case "bearer-token":
        return {
          ...authConfig,
          token: replaceInString(authConfig.token),
        };
      case "oauth2":
        return {
          ...authConfig,
          accessToken: replaceInString(authConfig.accessToken),
          tokenType: authConfig.tokenType ? replaceInString(authConfig.tokenType) : authConfig.tokenType,
          headerPrefix: authConfig.headerPrefix,
          addTokenTo: authConfig.addTokenTo,
          refreshToken: authConfig.refreshToken ? replaceInString(authConfig.refreshToken) : authConfig.refreshToken,
          tokenUrl: authConfig.tokenUrl ? replaceInString(authConfig.tokenUrl) : authConfig.tokenUrl,
          clientId: authConfig.clientId ? replaceInString(authConfig.clientId) : authConfig.clientId,
          clientSecret: authConfig.clientSecret ? replaceInString(authConfig.clientSecret) : authConfig.clientSecret,
        };
      case "oauth1":
        return {
          ...authConfig,
          consumerKey: authConfig.consumerKey ? replaceInString(authConfig.consumerKey) : authConfig.consumerKey,
          consumerSecret: authConfig.consumerSecret ? replaceInString(authConfig.consumerSecret) : authConfig.consumerSecret,
          token: authConfig.token ? replaceInString(authConfig.token) : authConfig.token,
          tokenSecret: authConfig.tokenSecret ? replaceInString(authConfig.tokenSecret) : authConfig.tokenSecret,
        };
      case "oauth":
        // Legacy support: treat as oauth2
        return {
          ...authConfig,
          accessToken: replaceInString(authConfig.accessToken),
          tokenType: authConfig.tokenType ? replaceInString(authConfig.tokenType) : authConfig.tokenType,
        };
      case "api-key":
        return {
          ...authConfig,
          key: replaceInString(authConfig.key),
          value: replaceInString(authConfig.value),
          in: authConfig.in, // 'in' doesn't need env var replacement
        };
      default:
        return authConfig;
    }
  };

  const replacedAuth = data.auth
    ? {
      ...data.auth,
      config: replaceInAuthConfig(data.auth.config, data.auth.type),
    }
    : undefined;

  const replacedUrl = replaceInString(data.url);

  return {
    ...data,
    url: replacedUrl,
    headers: replacedHeaders,
    params: replacedParams,
    path_params: replacedPathParams,
    body: replacedBody,
    body_params: replacedBodyParams,
    auth: replacedAuth,
  };
}
