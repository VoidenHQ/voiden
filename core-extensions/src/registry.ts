/**
 * Auto-generated extension registry
 * DO NOT EDIT MANUALLY - run 'yarn generate-registry' to update
 * Generated on: 2026-03-04T19:37:08.177Z
 */

export interface ExtensionMetadata {
  id: string;
  type: "core" | "community";
  name: string;
  description: string;
  author: string;
  version: string;
  enabled: boolean;
  priority?: number;
  readme: string;
  repo?: string;
  installedPath?: string;
  capabilities?: any;
  dependencies?: any;
  features?: string[];
  mainProcess?: boolean;
}

// Metadata-only export for Electron main process (no React/DOM dependencies)
export const coreExtensions: ExtensionMetadata[] = [
  {
    "id": "voiden-rest-api",
    "name": "Voiden REST API",
    "description": "HTTP/REST API testing toolkit with extensible request pipeline, custom blocks for headers/body, environment variables, response visualization, and support for all HTTP methods including multipart file uploads",
    "version": "1.0.1",
    "author": "Voiden Team",
    "enabled": true,
    "priority": 10,
    "readme": "Complete REST API testing extension with HTTP methods, headers, query params, body, and response visualization. Built on the new SDK pipeline architecture.",
    "capabilities": {
      "blocks": {
        "owns": [
          "method",
          "url",
          "request",
          "headers-table",
          "query-table",
          "path-table",
          "url-table",
          "multipart-table",
          "cookies-table",
          "json_body",
          "xml_body",
          "yml_body",
          "response-status",
          "response-headers",
          "response-body"
        ],
        "allowExtensions": true,
        "description": "Owns 14 block types for HTTP request/response building and visualization"
      },
      "paste": {
        "patterns": [
          {
            "name": "cURL",
            "description": "Parses cURL commands and populates editor with request details",
            "pattern": "/^curl\\s+/i",
            "handles": "Complete cURL command parsing including headers, auth, query params, and body"
          }
        ],
        "blockHandlers": [
          {
            "blockType": "method",
            "description": "Strips formatting from pasted content, inserts as plain text"
          },
          {
            "blockType": "url",
            "description": "Strips formatting from pasted content, inserts as plain text"
          }
        ]
      },
      "requestPipeline": {
        "buildHandler": true,
        "responseHandler": true,
        "description": "Registers handlers for building requests and processing responses"
      },
      "slashCommands": {
        "groups": [
          {
            "name": "REST API",
            "commands": [
              "Insert request block",
              "Insert headers table",
              "Insert query parameters",
              "Insert request body"
            ]
          }
        ]
      }
    },
    "dependencies": {
      "core": "^1.0.0",
      "sdk": "^1.0.0"
    },
    "features": [
      "HTTP method selection (GET, POST, PUT, DELETE, PATCH, etc.)",
      "URL building with path parameters and query strings",
      "Headers management with autocomplete",
      "Multiple body types: JSON, XML, form-data, URL-encoded, multipart",
      "File uploads via multipart/form-data",
      "Environment variable substitution",
      "cURL import via paste",
      "Response visualization with status, headers, and body",
      "Collapsible response sections",
      "Syntax highlighting for JSON and XML responses",
      "Request/response pipeline integration"
    ],
    "type": "core"
  },
  {
    "id": "voiden-graphql",
    "name": "Voiden GraphQL",
    "description": "GraphQL client with schema importer for building queries through a dedicated UI or editing manually. Supports queries, mutations, subscriptions with variables. Leverages voiden-rest-api for request execution",
    "version": "1.0.0",
    "author": "Voiden Team",
    "enabled": true,
    "priority": 15,
    "dependencies": {
      "voiden-rest-api": "^1.0.0"
    },
    "readme": "GraphQL extension with schema file importer and visual query builder UI. Select operations and fields from your schema or write queries manually. Supports queries, mutations, and subscriptions with variables. Depends on voiden-rest-api for request execution.",
    "capabilities": {
      "blocks": {
        "owns": [
          "gqlquery",
          "gqlvariables"
        ],
        "allowExtensions": true,
        "description": "Owns 2 block types for GraphQL query and variables"
      },
      "requestPipeline": {
        "buildHandler": true,
        "responseHandler": true,
        "streamingHandler": true,
        "description": "Registers handlers for building GraphQL requests, processing responses, and managing subscriptions"
      },
      "slashCommands": {
        "groups": [
          {
            "name": "graphql",
            "commands": [
              "Insert GraphQL Query",
              "Insert GraphQL Variables"
            ]
          }
        ]
      }
    },
    "features": [
      "Schema file importer - load .graphql/.gql schema files",
      "Visual query builder UI with operation and field selection",
      "Field-level argument selection with automatic variable generation",
      "Separate query and variables blocks",
      "Operation type support (query/mutation/subscription)",
      "Variable editor with JSON validation",
      "Depends on voiden-rest-api for URL handling and request execution",
      "Schema viewer with tabs for Query/Mutation/Subscription operations",
      "Auto-generation of queries from UI selections"
    ],
    "type": "core"
  },
  {
    "id": "simple-assertions",
    "name": "Simple Assertions",
    "description": "Add simple assertion testing to your HTTP requests with an easy-to-use table interface",
    "author": "Voiden Team",
    "version": "1.0.0",
    "enabled": true,
    "priority": 20,
    "readme": "Simple Assertions provides an easy way to write and execute assertions against HTTP responses. Use the `/assertions` slash command to insert an assertion table, then write your test cases using a simple two-column format: 'Description | Field | Operator' and 'Expected Value'. Assertion results are displayed as a sub-panel in the response tab.",
    "capabilities": {
      "blocks": {
        "owns": [
          "assertions-table"
        ],
        "allowExtensions": false
      },
      "requestPipeline": {
        "postProcessingHandler": true
      },
      "responseEnhancements": {
        "assertionResults": true
      }
    },
    "features": [
      "Two-column assertion table for writing tests",
      "Support for JSONPath, XPath, and form field assertions",
      "Multiple assertion operators (equals, contains, exists, matches, etc.)",
      "Assertion results displayed as sub-panel in response",
      "Color-coded pass/fail indicators"
    ],
    "type": "core"
  },
  {
    "id": "voiden-advanced-auth",
    "name": "Advanced Authentication",
    "description": "Advanced authentication support for HTTP/REST APIs including Bearer Token, Basic Auth, API Key, OAuth 1.0/2.0, Digest, AWS Signature, and more",
    "version": "2.0.0",
    "author": "Voiden Team",
    "enabled": true,
    "priority": 20,
    "mainProcess": true,
    "readme": "Comprehensive authentication extension providing support for multiple authentication methods used by REST APIs.",
    "capabilities": {
      "blocks": {
        "owns": [
          "auth"
        ],
        "allowExtensions": true,
        "description": "Owns 1 block type for authentication configuration"
      },
      "slashCommands": {
        "groups": [
          {
            "name": "Advanced Authentication",
            "commands": [
              "Insert authorization block",
              "Insert Bearer Token auth",
              "Insert Basic Auth",
              "Insert API Key auth",
              "Insert OAuth 2.0 auth",
              "Insert OAuth 1.0 auth",
              "Insert Digest Auth",
              "Insert AWS Signature auth"
            ]
          }
        ]
      }
    },
    "dependencies": {
      "core": "^1.0.0",
      "sdk": "^1.0.0"
    },
    "features": [
      "Bearer Token authentication",
      "Basic authentication (username/password)",
      "API Key authentication (header or query parameter)",
      "OAuth 2.0 with customizable token types",
      "OAuth 1.0 with signature generation",
      "Digest authentication",
      "AWS Signature v4",
      "NTLM, Hawk, Atlassian ASAP, Netrc support",
      "Environment variable substitution in auth values",
      "Inherit authentication from parent collections",
      "Quick auth type switching via dropdown"
    ],
    "type": "core"
  },
  {
    "id": "voiden-sockets-grpcs",
    "name": "Sockets & gRPC APIs",
    "description": "Voiden Sockets provide comprehensive support for WebSocket (WSS) and gRPC communication with unary, server streaming, client streaming, and bidirectional streaming patterns",
    "version": "1.0.0",
    "author": "Voiden Team",
    "enabled": true,
    "priority": 20,
    "readme": "Voiden Sockets provide support for WSS and gRPC Sockets with real-time communication capabilities",
    "capabilities": {
      "blocks": {
        "owns": [
          "socket-request",
          "surl",
          "smethod",
          "messages-node",
          "grpc-messages-node",
          "proto"
        ],
        "allowExtensions": true,
        "description": "Owns 6 block types for WebSocket and gRPC socket connections"
      },
      "requestPipeline": {
        "buildHandler": true,
        "responseHandler": true,
        "streamingHandler": true,
        "description": "Registers handlers for building requests, processing streaming connections, and managing bidirectional communication"
      },
      "slashCommands": {
        "groups": [
          {
            "name": "sockets",
            "commands": [
              "Insert WebSocket block",
              "Insert gRPC socket block"
            ]
          }
        ]
      },
      "paste": {
        "patterns": [
          {
            "name": "websocat",
            "description": "Parses websocat commands and populates editor with WebSocket connection details",
            "pattern": "/^websocat\\s+/i",
            "handles": "WebSocket URL parsing including headers, protocols, and connection options"
          },
          {
            "name": "grpcurl",
            "description": "Parses grpcurl commands and populates editor with gRPC request details",
            "pattern": "/^grpcurl\\s+/i",
            "handles": "gRPC service parsing including proto files, metadata, request body, and service endpoints"
          }
        ],
        "blockHandlers": [
          {
            "blockType": "smethod",
            "description": "Strips formatting from pasted content, inserts as plain text"
          },
          {
            "blockType": "surl",
            "description": "Strips formatting from pasted content, inserts as plain text"
          },
          {
            "blockType": "proto",
            "description": "Strips formatting from pasted content, inserts services and method"
          }
        ]
      },
      "panels": {
        "responsePanel": {
          "enabled": true,
          "features": [
            "Real-time message streaming",
            "Bidirectional communication log",
            "Connection status indicator",
            "Message history viewer"
          ],
          "description": "Dedicated response panel for monitoring WebSocket and gRPC communication between Voiden and server"
        }
      },
      "fileHandlers": {
        "protoFiles": {
          "extensions": [
            ".proto"
          ],
          "parser": true,
          "description": "Parse and import Protocol Buffer definition files for gRPC service discovery"
        }
      }
    },
    "dependencies": {
      "core": "^1.0.0",
      "sdk": "^1.0.0",
      "voiden-rest-api": "^1.0.0"
    },
    "features": [
      "WebSocket (WSS) connection support",
      "gRPC with unary, server streaming, client streaming, and bidirectional streaming patterns",
      "Proto file import and parsing",
      "Dynamic service and method selection from proto files",
      "Real-time message exchange",
      "Connection state management",
      "Message history and logging",
      "Dedicated response panel for socket communication",
      "Support for multiple concurrent connections"
    ],
    "type": "core"
  },
  {
    "id": "voiden-scripting",
    "name": "Voiden Scripting",
    "version": "1.1.0",
    "description": "Pre-request and post-response scripting in JavaScript, Python, and Shell (bash) with a unified voiden.* API",
    "author": "Voiden Team",
    "enabled": true,
    "mainProcess": true,
    "priority": 25,
    "readme": "Add pre-request and post-response scripts to your API requests in JavaScript, Python, or Shell (bash). All languages share the same voiden.* API: read/write request data, access environment and runtime variables, log output, run assertions, and cancel requests. Script runners (Node.js, Python, bash) are exposed as plugin IPC channels (ext:voiden-scripting:script:executeNode/executePython/executeShell) so other plugins can reuse them. Insert scripts with /pre-script and /post-script slash commands.",
    "capabilities": {
      "blocks": {
        "owns": [
          "pre_script",
          "post_script"
        ],
        "allowExtensions": false
      },
      "pipeline": {
        "hooks": [
          "pre-processing",
          "pre-send",
          "post-processing"
        ]
      },
      "slashCommands": {
        "groups": [
          {
            "name": "Scripting",
            "commands": [
              "Insert Pre-Request Script",
              "Insert Post-Response Script"
            ]
          }
        ]
      },
      "sidebar": {
        "tabs": [
          {
            "id": "script-logs",
            "title": "Script Logs",
            "side": "right",
            "icon": "Logs"
          }
        ]
      }
    },
    "dependencies": {
      "core": "^1.0.0",
      "sdk": "^1.0.0"
    },
    "features": [
      "Pre-request and post-response scripts in JavaScript, Python, or Shell (bash)",
      "Unified voiden.* API across all three languages (voiden.request, voiden.response, voiden.env, voiden.variables)",
      "voiden.request.url/method/headers/body/queryParams/pathParams — read/write",
      "voiden.response.status/statusText/headers/body/time/size — read (post-script only)",
      "voiden.env.get(key) — synchronous environment variable access",
      "voiden.variables.get/set — synchronous runtime variable access, persisted to .voiden/.process.env.json",
      "voiden.log() for script output logging with level support (log/info/debug/warn/error)",
      "voiden.assert(actual, operator, expected, message?) for script-based assertions",
      "voiden.cancel() to cancel request from pre-script",
      "Shell scripts use the same voiden.* dot-notation (bash supports dot function names)",
      "Plugin IPC channels exposed for other plugins: ext:voiden-scripting:script:executeNode, executePython, executeShell",
      "Inline ghost-text autocomplete for voiden.* API in all three languages",
      "CodeMirror editor with syntax highlighting, linting, and prettify for JS/Python"
    ],
    "type": "core"
  },
  {
    "id": "voiden-faker",
    "name": "Voiden Faker",
    "version": "1.1.0",
    "description": "Generate fake data using Faker.js in your API requests",
    "author": "Voiden Team",
    "enabled": true,
    "priority": 30,
    "readme": "Generates fake data using Faker.js in your HTTP requests. Use {{$faker.person.firstName()}} or {{$faker.number.int({\"min\":1,\"max\":10})}} syntax in headers, query params, path params, and request bodies.",
    "capabilities": {
      "pipeline": {
        "hooks": [
          "pre-send"
        ]
      },
      "editor": {
        "autocomplete": true,
        "suggestions": true
      }
    },
    "type": "core"
  },
  {
    "id": "md-preview",
    "name": "Markdown Preview",
    "description": "Live preview and rendering for Markdown files with full GitHub Flavored Markdown (GFM) support including tables, syntax highlighting, task lists, and strikethrough formatting",
    "version": "1.0.1",
    "author": "Voiden Team",
    "enabled": true,
    "priority": 40,
    "readme": "Toggle between edit and preview modes for markdown files. Supports GFM tables, strikethrough, task lists, and more.",
    "capabilities": {
      "editorActions": {
        "actions": [
          {
            "id": "md-preview-toggle",
            "name": "Preview Markdown",
            "description": "Opens markdown preview in read-only Voiden tab with panel toggle",
            "icon": "BookOpen",
            "fileTypes": [
              ".md",
              ".markdown"
            ]
          }
        ],
        "description": "Registers preview button for markdown files in code editor toolbar"
      }
    },
    "dependencies": {
      "core": "^1.0.0",
      "sdk": "^1.0.0"
    },
    "features": [
      "Live markdown preview in read-only Voiden tab",
      "GitHub Flavored Markdown (GFM) support",
      "Tables with proper cell formatting",
      "Strikethrough text formatting",
      "Task lists and checkboxes",
      "Inline and reference-style links",
      "Inline and reference-style images",
      "YAML frontmatter support",
      "Custom YAML blocks (cube blocks)",
      "Proper blank line preservation",
      "Toggle preview panel visibility",
      "Self-contained markdown parser (unified/remark)",
      "Automatic heading IDs",
      "Blockquotes",
      "Ordered and unordered lists",
      "Inline code and code blocks with syntax highlighting"
    ],
    "type": "core"
  },
  {
    "id": "openapi-import",
    "name": "OpenAPI Collection Importer",
    "description": "Seamlessly migrate from OpenAPI by importing v3.0 collections and converting them to native Voiden request files with full support for nested folders, environment variables, headers, auth, and all request body types",
    "version": "1.0.0",
    "author": "Voiden Team",
    "enabled": true,
    "priority": 50,
    "readme": "Import OpenAPI collections (v3.0) and convert them into Voiden .void request files. Supports nested folders, headers, request bodies, and query parameters.",
    "capabilities": {
      "ui": {
        "buttons": [
          {
            "id": "openapi-import-btn",
            "location": "sidebar-left",
            "icon": "PackageImport",
            "tooltip": "Import OpenAPI Collection",
            "description": "Opens file picker to select and import OpenAPI v3.0 JSON collections"
          }
        ],
        "description": "Adds import button to left sidebar for easy collection import"
      },
      "fileSystem": {
        "operations": [
          "create-directory",
          "write-file"
        ],
        "description": "Creates folder structure and .void files from OpenAPI collection hierarchy"
      },
      "integration": {
        "dependencies": [
          {
            "extension": "voiden-rest-api",
            "reason": "Uses voiden-rest-api helpers to generate compatible REST API blocks",
            "required": true
          }
        ],
        "description": "Depends on voiden-rest-api extension for REST block generation"
      }
    },
    "dependencies": {
      "core": "^1.0.0",
      "sdk": "^1.0.0",
      "voiden-rest-api": "^1.0.0"
    },
    "features": [
      "Import OpenAPI Collection v3.0 JSON files",
      "Automatically create folder structure matching collection hierarchy",
      "Convert selected requests to a native .void file",
      "Preserve request names and folder organization",
      "Support for all HTTP methods (GET, POST, PUT, DELETE, PATCH, etc.)",
      "Import request headers and convert to headers-table blocks",
      "Import query parameters and convert to query-table blocks",
      "Import JSON request bodies and convert to json_body blocks",
      "Import form-data bodies and convert to multipart-table blocks",
      "Import URL-encoded bodies",
      "Sanitize file and folder names for filesystem compatibility",
      "Progress tracking during import",
      "Batch file creation with throttling to prevent system overload",
      "Uses voiden-rest-api helpers for consistent block generation",
      "Generates markdown with proper YAML frontmatter",
      "Nested folder support (unlimited depth)",
      "Handles special characters in names"
    ],
    "type": "core"
  },
  {
    "id": "postman-import",
    "name": "Postman Collection Importer",
    "description": "Seamlessly migrate from Postman by importing v2.1 collections and automatically converting them to native Voiden request files with full support for nested folders, environment variables, headers, auth, and all request body types",
    "version": "1.0.2",
    "author": "Voiden Team",
    "enabled": true,
    "priority": 50,
    "readme": "Import Postman collections (v2.1) and automatically convert them into Voiden .void request files. Supports nested folders, headers, request bodies, and query parameters.",
    "capabilities": {
      "ui": {
        "buttons": [
          {
            "id": "postman-import-btn",
            "location": "sidebar-left",
            "icon": "PackageImport",
            "tooltip": "Import Postman Collection",
            "description": "Opens file picker to select and import Postman v2.1 JSON collections"
          }
        ],
        "description": "Adds import button to left sidebar for easy collection import"
      },
      "fileSystem": {
        "operations": [
          "create-directory",
          "write-file"
        ],
        "description": "Creates folder structure and .void files from Postman collection hierarchy"
      },
      "integration": {
        "dependencies": [
          {
            "extension": "voiden-rest-api",
            "reason": "Uses voiden-rest-api helpers to generate compatible REST API blocks",
            "required": true
          }
        ],
        "description": "Depends on voiden-rest-api extension for REST block generation"
      }
    },
    "dependencies": {
      "core": "^1.0.0",
      "sdk": "^1.0.0",
      "voiden-rest-api": "^1.0.0"
    },
    "features": [
      "Import Postman Collection v2.1 JSON files",
      "Automatically create folder structure matching collection hierarchy",
      "Convert each request to a native .void file",
      "Preserve request names and folder organization",
      "Support for all HTTP methods (GET, POST, PUT, DELETE, PATCH, etc.)",
      "Import request headers and convert to headers-table blocks",
      "Import query parameters and convert to query-table blocks",
      "Import JSON request bodies and convert to json_body blocks",
      "Import form-data bodies and convert to multipart-table blocks",
      "Import URL-encoded bodies",
      "Sanitize file and folder names for filesystem compatibility",
      "Progress tracking during import",
      "Batch file creation with throttling to prevent system overload",
      "Uses voiden-rest-api helpers for consistent block generation",
      "Generates markdown with proper YAML frontmatter",
      "Nested folder support (unlimited depth)",
      "Handles special characters in names",
      "Converts Postman's raw mode to appropriate body types"
    ],
    "type": "core"
  }
];
