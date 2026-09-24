// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sanitizeName,
  getEntryName,
  groupEntries,
  convertHarEntryToVoidenSchema,
} from '../utils/converter';
import { isStaticAsset } from '../utils/staticAssets';
import type { HarEntry, HarLog } from '../utils/types';

// Mock voiden API helpers
const mockHelpers = {
  createMethodNode: vi.fn((method: string) => ({ type: 'method', method })),
  createUrlNode: vi.fn((url: string) => ({ type: 'url', url })),
  createHeadersTableNode: vi.fn((headers: [string, string][]) => ({
    type: 'headers-table',
    headers,
  })),
  createQueryTableNode: vi.fn((params: [string, string][]) => ({
    type: 'query-table',
    params,
  })),
  createJsonBodyNode: vi.fn((body: string, contentType: string) => ({
    type: 'json_body',
    body,
    contentType,
  })),
  createXMLBodyNode: vi.fn((body: string, contentType: string) => ({
    type: 'xml_body',
    body,
    contentType,
  })),
  createUrlTableNode: vi.fn((formData: [string, string][]) => ({
    type: 'url_table',
    formData,
  })),
  createMultipartTableNode: vi.fn((formData: [string, string][]) => ({
    type: 'multipart_table',
    formData,
  })),
  convertBlocksToVoidFile: vi.fn((title: string, blocks: any[]) =>
    JSON.stringify({ title, blocks }, null, 2)
  ),
  convertToVoidMarkdown: vi.fn(),
  insertParagraphAfterRequestBlocks: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  (window as any).__voidenHelpers__ = {
    'voiden-wrapper-api-extension': mockHelpers,
  };
});

describe('HAR Importer - Sanitization & Asset Filtering', () => {
  it('sanitizeName sanitizes filenames correctly', () => {
    expect(sanitizeName(' My / Folder / Name! ')).toBe('My-Folder-Name');
    expect(sanitizeName('api/v1/users?id=123')).toBe('api-v1-usersid123');
    expect(sanitizeName('')).toBe('unnamed-request');
  });

  it('isStaticAsset correctly identifies static assets vs API requests', () => {
    expect(isStaticAsset('https://example.com/logo.png')).toBe(true);
    expect(isStaticAsset('https://example.com/styles.css')).toBe(true);
    expect(isStaticAsset('https://example.com/script.js')).toBe(true);
    expect(isStaticAsset('https://example.com/font.woff2')).toBe(true);
    expect(isStaticAsset('https://example.com/api/v1/data', 'image/png')).toBe(true);
    expect(isStaticAsset('https://example.com/api/v1/data', 'text/css')).toBe(true);

    expect(isStaticAsset('https://example.com/api/v1/users')).toBe(false);
    expect(isStaticAsset('https://example.com/api/v1/users', 'application/json')).toBe(false);
    expect(isStaticAsset('https://example.com/graphql', 'application/json')).toBe(false);
  });
});

describe('HAR Importer - Entry Names & Grouping', () => {
  it('getEntryName formats request entry names properly', () => {
    const entry: HarEntry = {
      startedDateTime: '2026-08-06T10:00:00.000Z',
      time: 100,
      request: {
        method: 'GET',
        url: 'https://api.example.com/v1/users',
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: [],
        queryString: [],
        headersSize: 0,
        bodySize: 0,
      },
    };

    expect(getEntryName(entry)).toBe('GET users');
  });

  it('groupEntries groups entries by page and filters static assets', () => {
    const log: HarLog = {
      version: '1.2',
      creator: { name: 'Chrome', version: '120.0' },
      pages: [{ id: 'page_1', startedDateTime: '', title: 'Dashboard' }],
      entries: [
        {
          pageref: 'page_1',
          startedDateTime: '',
          time: 50,
          request: {
            method: 'GET',
            url: 'https://api.example.com/v1/users',
            httpVersion: 'HTTP/1.1',
            cookies: [],
            headers: [],
            queryString: [],
            headersSize: 0,
            bodySize: 0,
          },
          response: {
            status: 200,
            statusText: 'OK',
            httpVersion: 'HTTP/1.1',
            cookies: [],
            headers: [],
            content: { size: 100, mimeType: 'application/json' },
            redirectURL: '',
            headersSize: 0,
            bodySize: 0,
          },
        },
        {
          pageref: 'page_1',
          startedDateTime: '',
          time: 10,
          request: {
            method: 'GET',
            url: 'https://api.example.com/assets/app.css',
            httpVersion: 'HTTP/1.1',
            cookies: [],
            headers: [],
            queryString: [],
            headersSize: 0,
            bodySize: 0,
          },
          response: {
            status: 200,
            statusText: 'OK',
            httpVersion: 'HTTP/1.1',
            cookies: [],
            headers: [],
            content: { size: 500, mimeType: 'text/css' },
            redirectURL: '',
            headersSize: 0,
            bodySize: 0,
          },
        },
      ],
    };

    const filtered = groupEntries(log, true);
    expect(filtered['Dashboard']).toBeDefined();
    expect(filtered['Dashboard'].length).toBe(1);
    expect(filtered['Dashboard'][0].request.url).toBe('https://api.example.com/v1/users');

    const unfiltered = groupEntries(log, false);
    expect(unfiltered['Dashboard'].length).toBe(2);
  });
});

describe('HAR Importer - Entry Conversion to Schema', () => {
  it('converts HAR entry with headers, cookies, query string, and JSON body', async () => {
    const entry: HarEntry = {
      startedDateTime: '2026-08-06T10:00:00.000Z',
      time: 120,
      request: {
        method: 'POST',
        url: 'https://api.example.com/v1/users',
        httpVersion: 'HTTP/1.1',
        cookies: [{ name: 'session_id', value: 'abc123xyz' }],
        headers: [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'Authorization', value: 'Bearer token456' },
        ],
        queryString: [{ name: 'source', value: 'web' }],
        postData: {
          mimeType: 'application/json',
          text: '{"name": "Alice", "role": "admin"}',
        },
        headersSize: 100,
        bodySize: 35,
      },
    };

    const voidContent = await convertHarEntryToVoidenSchema(entry);
    const parsed = JSON.parse(voidContent);

    expect(parsed.title).toBe('POST users');
    expect(mockHelpers.createMethodNode).toHaveBeenCalledWith('POST');
    expect(mockHelpers.createUrlNode).toHaveBeenCalledWith('https://api.example.com/v1/users');
    expect(mockHelpers.createHeadersTableNode).toHaveBeenCalledWith([
      ['Content-Type', 'application/json'],
      ['Authorization', 'Bearer token456'],
      ['Cookie', 'session_id=abc123xyz'],
    ]);
    expect(mockHelpers.createQueryTableNode).toHaveBeenCalledWith([['source', 'web']]);
    expect(mockHelpers.createJsonBodyNode).toHaveBeenCalledWith(
      '{"name": "Alice", "role": "admin"}',
      'json'
    );
  });

  it('converts HAR entry with URL-encoded form data', async () => {
    const entry: HarEntry = {
      startedDateTime: '2026-08-06T10:00:00.000Z',
      time: 80,
      request: {
        method: 'POST',
        url: 'https://api.example.com/login',
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: [{ name: 'Content-Type', value: 'application/x-www-form-urlencoded' }],
        queryString: [],
        postData: {
          mimeType: 'application/x-www-form-urlencoded',
          params: [
            { name: 'username', value: 'alice' },
            { name: 'password', value: 'secret123' },
          ],
        },
        headersSize: 50,
        bodySize: 30,
      },
    };

    await convertHarEntryToVoidenSchema(entry);
    expect(mockHelpers.createUrlTableNode).toHaveBeenCalledWith([
      ['username', 'alice'],
      ['password', 'secret123'],
    ]);
  });
});
