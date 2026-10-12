// @vitest-environment jsdom
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';
import { importHarLog } from '../utils/converter';

describe('End-to-End HAR Import Test', () => {
  it('imports sample-capture.har and generates expected .void files', async () => {
    const mockFilesCreated: Record<string, string> = {};

    (globalThis as any).window = {
      __voidenHelpers__: {
        'voiden-wrapper-api-extension': {
          createMethodNode: (method: string) => ({ type: 'method', method }),
          createUrlNode: (url: string) => ({ type: 'url', url }),
          createHeadersTableNode: (headers: [string, string][]) => ({ type: 'headers-table', headers }),
          createQueryTableNode: (params: [string, string][]) => ({ type: 'query-table', params }),
          createJsonBodyNode: (body: string, contentType: string) => ({ type: 'json_body', body, contentType }),
          createXMLBodyNode: (body: string, contentType: string) => ({ type: 'xml_body', body, contentType }),
          createUrlTableNode: (formData: [string, string][]) => ({ type: 'url_table', formData }),
          createMultipartTableNode: (formData: [string, string][]) => ({ type: 'multipart_table', formData }),
          convertBlocksToVoidFile: (title: string, blocks: any[]) =>
            `---\ntitle: "${title}"\n---\n\n` +
            blocks.map((b) => `\`\`\`json\n${JSON.stringify(b, null, 2)}\n\`\`\``).join('\n\n'),
        },
      },
      electron: {
        files: {
          createDirectory: async (parent: string, name: string) => name,
          createVoid: async (dir: string, name: string) => ({ path: `${dir}/${name}.void` }),
          write: async (filePath: string, content: string) => {
            mockFilesCreated[filePath] = content;
          },
        },
      },
    };

    const harPath = resolve(process.cwd(), 'sample-capture.har');
    const harContent = readFileSync(harPath, 'utf8');

    // Test 1: Ignore static assets = true
    const result = await importHarLog(harContent, '/test-project', { ignoreStaticAssets: true });
    expect(result).toBeDefined();
    expect(result!.success).toBe(true);

    const createdPaths = Object.keys(mockFilesCreated);
    expect(createdPaths.length).toBe(3);

    expect(createdPaths).toContain('/test-project/har-WebInspector/User-Dashboard/GET-users.void');
    expect(createdPaths).toContain('/test-project/har-WebInspector/Account-Settings/POST-login.void');
    expect(createdPaths).toContain('/test-project/har-WebInspector/Account-Settings/POST-profile.void');

    // Inspect content of GET users
    const getUsersContent = mockFilesCreated['/test-project/har-WebInspector/User-Dashboard/GET-users.void'];
    expect(getUsersContent).toContain('GET');
    expect(getUsersContent).toContain('https://api.example.com/v1/users?role=admin&status=active');
    expect(getUsersContent).toContain('auth_token=secret_token_12345');

    // Test 2: Ignore static assets = false
    const mockFilesUnfiltered: Record<string, string> = {};
    (globalThis as any).window.electron.files.write = async (filePath: string, content: string) => {
      mockFilesUnfiltered[filePath] = content;
    };

    const result2 = await importHarLog(harContent, '/test-project', { ignoreStaticAssets: false });
    expect(result2).toBeDefined();
    expect(result2!.success).toBe(true);
    expect(Object.keys(mockFilesUnfiltered).length).toBe(5);
  });
});
