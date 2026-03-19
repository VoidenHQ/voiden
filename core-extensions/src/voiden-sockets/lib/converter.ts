/**
 * Socket Request Command Converters
 *
 * Utilities for converting websocat and grpcurl commands to socket-request JSON
 * with support for headers, query params, authorization, and path params
 */

import { Editor, JSONContent } from "@tiptap/core";

type OneDimensionalArray = any[];
type TwoDimensionalArray = OneDimensionalArray[];

/**
 * Auth types supported
 */
export type AuthType =
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

/**
 * Socket request node types
 */
export const REQUEST_NODES = [
  "smethod",
  "surl",
  "headers-table",
  "query-table",
  "path-table",
  "auth",
  "proto",
];

/**
 * Convert 2D array to table node structure
 */
export const convertDataToTableNode = (data: TwoDimensionalArray) => {
  return [
    {
      type: "table",
      content: data.map((row: OneDimensionalArray) => {
        return {
          type: "tableRow",
          attrs: {
            disabled: false,
          },
          content: row.map((col) => {
            return {
              type: "tableCell",
              attrs: {
                colspan: 1,
                rowspan: 1,
                colwidth: null,
              },
              content: [
                {
                  type: "paragraph",
                  content: col
                    ? [
                      {
                        type: "text",
                        text: col,
                      },
                    ]
                    : [],
                },
              ],
            };
          }),
        };
      }),
    },
  ];
};

/**
 * Create socket headers table node
 */
export const convertToSocketHeadersTableNode = (data: TwoDimensionalArray) => {
  return {
    type: "headers-table",
    content: convertDataToTableNode(data),
  };
};

/**
 * Create socket query params table node
 */
export const convertToSocketQueryTableNode = (data: TwoDimensionalArray) => {
  return {
    type: "query-table",
    content: convertDataToTableNode(data),
  };
};

/**
 * Create socket path params table node
 */
export const convertToSocketPathTableNode = (data: TwoDimensionalArray) => {
  return {
    type: "path-table",
    content: convertDataToTableNode(data),
  };
};



/**
 * Parse authorization header and determine auth type and details
 */
const parseAuthorizationHeader = (authValue: string): {
  authType: AuthType;
  authData: TwoDimensionalArray;
} => {
  const trimmedValue = authValue.trim();

  // Bearer token
  if (trimmedValue.toLowerCase().startsWith("bearer ")) {
    const token = trimmedValue.substring(7).trim();
    return {
      authType: "bearer",
      authData: [["token", token || null]],
    };
  }

  // Basic auth
  if (trimmedValue.toLowerCase().startsWith("basic ")) {
    const credentials = trimmedValue.substring(6).trim();
    try {
      const decoded = atob(credentials);
      const [username, password] = decoded.split(":");
      return {
        authType: "basic",
        authData: [
          ["username", username || null],
          ["password", password || null],
        ],
      };
    } catch {
      return {
        authType: "basic",
        authData: [
          ["username", null],
          ["password", null],
        ],
      };
    }
  }

  // API Key (fallback if not Bearer or Basic)
  return {
    authType: "apiKey",
    authData: [
      ["key", null],
      ["value", trimmedValue || null],
    ],
  };
};

/**
 * Create socket authorization node with proper auth structure
 */
export const convertToSocketAuthNode = (authValue: string): JSONContent => {
  const { authType, authData } = parseAuthorizationHeader(authValue);
  const uid = crypto.randomUUID();

  return {
    type: "auth",
    attrs: {
      uid,
      authType,
      importedFrom: "",
    },
    content: convertDataToTableNode(authData),
  };
};

/**
 * Parse websocat command and extract components
 */
const parseWebsocatCommand = (command: string): {
  url: string;
  headers: TwoDimensionalArray;
  queryParams: TwoDimensionalArray;
  pathParams: TwoDimensionalArray;
} => {
  const headers: TwoDimensionalArray = [];
  const queryParams: TwoDimensionalArray = [];
  const pathParams: TwoDimensionalArray = [];
  let url = "";

  // Extract headers (-H or --header)
  const headerRegex = /(?:-H|--header)\s+["']([^"']+)["']/g;
  let match;
  while ((match = headerRegex.exec(command)) !== null) {
    const headerLine = match[1];
    const [key, ...valueParts] = headerLine.split(":");
    const value = valueParts.join(":").trim();
    headers.push([key.trim(), value]);
  }

  // Extract URL (last argument, typically quoted)
  const urlMatch = command.match(/["'](wss?:\/\/[^"']+)["']|wss?:\/\/\S+$/);
  if (urlMatch) {
    url = urlMatch[1] || urlMatch[0];

    // Parse query params from URL
    const urlObj = new URL(url);
    urlObj.searchParams.forEach((value, key) => {
      queryParams.push([key, value]);
    });

    // Extract path params (variables in URL like :id or {id})
    const pathParamMatches = url.matchAll(/[:/]{([^}]+)}|:([a-zA-Z_][a-zA-Z0-9_]*)/g);
    for (const match of pathParamMatches) {
      const paramName = match[1] || match[2];
      pathParams.push([paramName, ""]);
    }
  }

  return { url, headers, queryParams, pathParams };
};

/**
 * Parse grpcurl command and extract components
 */
const parseGrpcurlCommand = (command: string): {
  url: string;
  metadata: TwoDimensionalArray;
  queryParams: TwoDimensionalArray;
  pathParams: TwoDimensionalArray;
  protoPath?: string;
  packageName?: string;
  service?: string;
  method?: string;
  usesReflection: boolean;
  methodText: string;
} => {
  const metadata: TwoDimensionalArray = [];
  const queryParams: TwoDimensionalArray = [];
  const pathParams: TwoDimensionalArray = [];
  let url = "";
  let protoPath: string | undefined;
  let usesReflection = false;

  // Check if using reflection (plaintext without proto file)
  if (command.includes("-plaintext") && !command.includes("-proto")) {
    usesReflection = true;
  }

  // Determine if it's secure connection (default is secure unless -plaintext or -insecure)
  const isInsecure = command.includes("-plaintext") || command.includes("-insecure");
  const protocol = isInsecure ? "grpc" : "grpcs";
  const methodText = isInsecure ? "GRPC" : "GRPCS";

  // Extract metadata (-H)
  const metadataRegex = /-H\s+["']([^"']+)["']/g;
  let match;
  while ((match = metadataRegex.exec(command)) !== null) {
    const headerLine = match[1];
    const [key, ...valueParts] = headerLine.split(":");
    const value = valueParts.join(":").trim();
    metadata.push([key.trim(), value]);
  }

  // Extract -import-path dir and -proto file, then combine into full path
  const importPathMatch = command.match(/-import-path\s+["']([^"']+)["']|-import-path\s+(\S+)/);
  const importDir = importPathMatch ? (importPathMatch[1] || importPathMatch[2]) : null;

  const protoMatch = command.match(/-proto\s+["']([^"']+)["']|-proto\s+(\S+)/);
  const protoFile = protoMatch ? (protoMatch[1] || protoMatch[2]) : null;

  if (protoFile) {
    if (importDir) {
      // Combine import dir + proto filename into absolute path
      const sep = importDir.endsWith('/') ? '' : '/';
      protoPath = `${importDir}${sep}${protoFile}`;
    } else {
      protoPath = protoFile;
    }
  }

  // Extract host:port (can be in various positions)
  // Try to match host:port pattern
  const hostPortMatch = command.match(/([a-zA-Z0-9.-]+:\d+)/);
  if (hostPortMatch) {
    const hostPort = hostPortMatch[1];
    url = `${protocol}://${hostPort}`;
  }

  const rpcMatch = command.match(/([A-Za-z0-9_.]+)\/([A-Za-z0-9_]+)\s*$/);
  const fullService = rpcMatch?.[1] || '';
  const method = rpcMatch?.[2] || '';
  const serviceParts = fullService ? fullService.split('.') : [];
  const service = serviceParts.length > 0 ? serviceParts[serviceParts.length - 1] : '';
  const packageName = serviceParts.length > 1 ? serviceParts.slice(0, -1).join('.') : '';

  return {
    url,
    metadata,
    queryParams,
    pathParams,
    protoPath,
    packageName,
    service,
    method,
    usesReflection,
    methodText,
  };
};

/**
 * Determine stream type from method name
 */
const determineStreamType = (
  method?: string
): "unary" | "server" | "client" | "bidirectional" => {
  if (!method) return "unary";

  const methodLower = method.toLowerCase();

  if (methodLower.includes("bidi") || methodLower.includes("bidirectional")) {
    return "bidirectional";
  }

  if (methodLower.includes("stream")) {
    if (methodLower.startsWith("stream") || methodLower.includes("serverstream")) {
      return "server";
    }
    if (methodLower.includes("clientstream")) {
      return "client";
    }
  }

  return "unary";
};

/**
 * Convert websocat command to socket request JSON
 * Returns array of nodes: socket-request node followed by headers, query params, path params, and auth tables
 */
export const convertWebsocatToSocketRequest = (websocatCommand: string): JSONContent[] => {
  const parsed = parseWebsocatCommand(websocatCommand);

  const nodes: JSONContent[] = [
    {
      type: "socket-request",
      content: [
        {
          type: "smethod",
          attrs: {
            method: "WSS",
          },
          content: [
            {
              type: "text",
              text: "WSS",
            },
          ],
        },
        {
          type: "surl",
          content: [
            {
              type: "text",
              text: parsed.url,
            },
          ],
        },
      ],
    },
  ];

  // Add headers table if present
  if (parsed.headers.length > 0) {
    nodes.push(convertToSocketHeadersTableNode(parsed.headers));
  }

  // Add query params table if present
  if (parsed.queryParams.length > 0) {
    nodes.push(convertToSocketQueryTableNode(parsed.queryParams));
  }

  // Add path params table if present
  if (parsed.pathParams.length > 0) {
    nodes.push(convertToSocketPathTableNode(parsed.pathParams));
  }

  return nodes;
};

/**
 * Convert grpcurl command to socket request JSON
 * Returns array of nodes: socket-request node followed by metadata, query params, path params, and auth tables
 */
export const convertGrpcurlToSocketRequest = (grpcurlCommand: string): JSONContent[] => {
  const parsed = parseGrpcurlCommand(grpcurlCommand);
  const protoFileName = parsed.protoPath
    ? parsed.protoPath.split(/[\\/]/).pop() || parsed.protoPath
    : null;

  const nodes: JSONContent[] = [
    {
      type: "socket-request",
      content: [
        {
          type: "smethod",
          attrs: {
            method: parsed.methodText,
          },
          content: [
            {
              type: "text",
              text: parsed.methodText,
            },
          ],
        },
        {
          type: "surl",
          content: [
            {
              type: "text",
              text: parsed.url,
            },
          ],
        },
        {
          type: "proto",
          attrs: {
            fileName: protoFileName,
            // Store the full path (absolute from -import-path/-proto combination).
            // ProtoSelectorNode's auto-load effect will relativize it if inside project.
            filePath: parsed.protoPath || null,
            packageName: parsed.packageName || null,
            services: [],
            selectedService: parsed.service || null,
            selectedMethod: parsed.method || null,
            callType: null,
          },
        },
      ],
    },
  ];

  // Add metadata (headers) table if present
  if (parsed.metadata.length > 0) {
    nodes.push(convertToSocketHeadersTableNode(parsed.metadata));
  }

  // Add query params table if present
  if (parsed.queryParams.length > 0) {
    nodes.push(convertToSocketQueryTableNode(parsed.queryParams));
  }

  // Add path params table if present
  if (parsed.pathParams.length > 0) {
    nodes.push(convertToSocketPathTableNode(parsed.pathParams));
  }

  return nodes;
};

/**
 * Auto-detect and convert socket command (websocat or grpcurl)
 * Returns array of nodes
 */
export const convertSocketCurlToRequest = (command: string): JSONContent[] => {
  command = command.trim();

  if (command.startsWith("websocat") || command.includes("ws://") || command.includes("wss://")) {
    return convertWebsocatToSocketRequest(command);
  } else if (command.startsWith("grpcurl") || command.includes("grpc://")) {
    return convertGrpcurlToSocketRequest(command);
  }

  throw new Error("Unsupported socket command format. Use websocat or grpcurl commands.");
};

/**
 * Update editor content with transformation function
 */
type EditorContentUpdater = (content: JSONContent[]) => JSONContent[];

export const updateEditorContent = (editor: Editor, updateContent: EditorContentUpdater) => {
  const editorJson = editor.getJSON();
  const editorJsonContent = editorJson.content || [];

  try {
    editor
      .chain()
      .setContent(
        {
          ...editorJson,
          content: updateContent(editorJsonContent),
        },
        true,
      )
      .run();
  } catch (error) {
    // console.debug(error);
  }
};

/**
 * Replace node of specific type
 */
export const replaceNode = (editorContent: JSONContent[], nodeType: string, nodeContent: JSONContent): JSONContent[] => {
  return editorContent.map((node) => (node.type === nodeType && !node.attrs?.importedFrom ? nodeContent : node));
};

/**
 * Add node at specific index
 */
export const addNode = (editorContent: JSONContent[], nodeContent: JSONContent, addIndex?: number): JSONContent[] => {
  if (addIndex) {
    return [...editorContent.slice(0, addIndex), nodeContent, ...editorContent.slice(addIndex)];
  }
  return [...editorContent, nodeContent];
};

/**
 * Find and replace node or add if not exists
 */
export const findAndReplaceOrAddNode = (
  editorContent: JSONContent[],
  nodeType: string,
  nodeContent: JSONContent,
  addIndex?: number,
): JSONContent[] => {
  const existingNodes = editorContent.filter((node) => node.type === nodeType);
  const existingDocNode = existingNodes?.find((node) => !node.attrs?.importedFrom);
  if (existingDocNode) {
    return replaceNode(editorContent, nodeType, nodeContent);
  } else {
    return addNode(editorContent, nodeContent, addIndex);
  }
};

/**
 * Insert paragraph after request blocks for better formatting
 */
export const insertParagraphAfterRequestBlocks = (editorContentJson: JSONContent[]) => {
  const paragraphNode = {
    type: "paragraph",
  };

  const result = [];

  for (let i = 0; i < editorContentJson.length; i++) {
    const node = editorContentJson[i];
    result.push(node);

    // If request block node, add paragraph after
    if (REQUEST_NODES.filter((n) => !["smethod", "surl"].includes(n)).includes(node.type || "")) {
      result.push(paragraphNode);
    }
  }

  return result;
};
