# Voiden REST API Extension

Complete HTTP/REST API testing extension built on the new SDK architecture.

## Architecture

This extension uses the **new SDK v2 architecture** with:

- ✅ `UIExtension` base class
- ✅ Pipeline hooks for request/response handling
- ✅ Secure environment API (variable names only)
- ✅ Helper system for pure utilities
- ✅ TypeScript throughout
- ✅ History API integration (custom cURL builder)

## Directory Structure

```
voiden-rest-api/
├── manifest.json           # Extension metadata
├── plugin.ts               # Plugin adapter (entry point)
├── extension.ts            # Main extension class
├── index.ts                # Public exports
├── nodes/                  # Tiptap nodes (blocks)
│   ├── MethodNode.ts       # HTTP method selector
│   ├── UrlNode.ts          # URL input
│   ├── RequestHeadersNode.ts
│   ├── ResponseStatusNode.ts
│   ├── ResponseHeadersNode.ts
│   ├── ResponseBodyNode.ts
│   └── index.ts            # Table nodes (headers, query, body…)
├── lib/                    # Core logic
│   ├── requestPopulator.ts # Editor JSON → request state
│   ├── responseConverter.ts# Response → Voiden document
│   ├── curlGenerator.ts    # Build cURL from request
│   ├── converter.ts        # cURL paste helpers
│   └── helpers.ts          # Shared utilities
└── components/
    └── CopyCurlButton.tsx  # Editor action: copy as cURL
```

## Features

- HTTP method selection (GET, POST, PUT, DELETE, PATCH, …)
- URL building with path parameters and query strings
- Headers management with table blocks
- Multiple body types: JSON, XML, YAML, form-data, URL-encoded, multipart
- File uploads via multipart/form-data
- Environment variable substitution
- cURL import via paste
- Response visualization with status, headers, and body
- Request/response pipeline integration

## History API

This plugin integrates with the **Voiden History API** (`context.history`) to customise how its entries are exported from the Global History sidebar.

### Registered curl builder

On `onload`, the plugin calls:

```typescript
context.history.registerCurlBuilder((entry) => {
  // Returns a properly formatted REST cURL command
  // for entries where source === 'voiden-rest-api'
});
```

### Plugin History API (for extension authors)

Any plugin can use the same API to save, read, and customise history entries:

```typescript
// Save a history entry tagged with your plugin ID
await context.history.save({ request: { ... }, response: { ... } }, filePath);

// Register a custom cURL builder for your entries
context.history.registerCurlBuilder((entry) => {
  return `curl "${entry.request.url}"`;
});

// Read all history entries across all files
const all = await context.history.readAll();
```

Entries saved via `context.history.save()` are automatically tagged with `source: <pluginId>`. The **Global History** sidebar in the right panel reads all entries, applies your registered cURL builder when copying/replaying, and lets users filter by date or search by URL, method, or file.

## Development

Built with:
- **SDK**: `@voiden/sdk` v1.0.0+
- **Pipeline**: Hybrid architecture (Phase 3)
- **Security**: Capability-based, no env value access
