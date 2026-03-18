/**
 * Shared utility for converting a history entry into .void file markdown.
 * Used by HistorySidebar, GlobalHistorySidebar, and the plugin history export API.
 */

import { HistoryEntry } from './types';
import { prosemirrorToMarkdown } from '@/core/file-system/hooks/useFileSystem';
import { getSchema } from '@tiptap/core';

export function buildVoidMarkdownFromEntry(
  entry: HistoryEntry,
  schema: ReturnType<typeof getSchema>,
): string {
  const content: any[] = [];

  // Request node — wraps method + url as a single request block
  content.push({
    type: 'request',
    content: [
      {
        type: 'method',
        attrs: { method: entry.request.method },
        content: [{ type: 'text', text: entry.request.method }],
      },
      {
        type: 'url',
        content: [{ type: 'text', text: entry.request.url }],
      },
    ],
  });

  // Request headers
  if (entry.request.headers?.length) {
    content.push({
      type: 'headers-table',
      content: [{
        type: 'table',
        content: entry.request.headers.map((hdr) => ({
          type: 'tableRow',
          attrs: { disabled: false },
          content: [hdr.key, hdr.value].map((col) => ({
            type: 'tableCell',
            attrs: { colspan: 1, rowspan: 1, colwidth: null },
            content: [{ type: 'paragraph', content: col ? [{ type: 'text', text: col }] : [] }],
          })),
        })),
      }],
    });
  }

  const ct = (entry.request.contentType ?? '').toLowerCase();

  // Multipart body — reconstruct table from body summary string + file attachment metadata
  if (ct.includes('multipart') || entry.request.fileAttachments?.length) {
    // Parse the summary string (format: "key=@filename.jpg | key2=text_value")
    const bodyStr = entry.request.body ?? '';
    const params: Array<{ key: string; value: string; isFile: boolean }> = bodyStr
      ? bodyStr.split(' | ').flatMap((part) => {
          const eqIdx = part.indexOf('=');
          if (eqIdx === -1) return [];
          const key = part.slice(0, eqIdx).trim();
          const val = part.slice(eqIdx + 1).trim();
          if (!key) return [];
          const isFile = val.startsWith('@');
          return [{ key, value: val.replace(/^@/, ''), isFile }];
        })
      : [];

    // Merge: params from body string; for file params, enrich with absolute path from fileAttachments
    const fileAttachMap = new Map((entry.request.fileAttachments ?? []).map((f) => [f.name, f]));

    const rows = params.map(({ key, value, isFile }) => {
      const fileMeta = isFile ? (fileAttachMap.get(value) ?? null) : null;
      const absolutePath = fileMeta?.path ?? (isFile ? value : null);
      const fileName = fileMeta?.name ?? value;

      const valueCell = isFile && absolutePath
        ? {
            type: 'tableCell',
            attrs: { colspan: 1, rowspan: 1, colwidth: null },
            content: [{
              type: 'paragraph',
              content: [{
                type: 'fileLink',
                attrs: { filePath: absolutePath, filename: fileName, isExternal: true },
              }],
            }],
          }
        : {
            type: 'tableCell',
            attrs: { colspan: 1, rowspan: 1, colwidth: null },
            content: [{ type: 'paragraph', content: value ? [{ type: 'text', text: value }] : [] }],
          };

      return {
        type: 'tableRow',
        attrs: { disabled: false },
        content: [
          {
            type: 'tableCell',
            attrs: { colspan: 1, rowspan: 1, colwidth: null },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: key }] }],
          },
          valueCell,
        ],
      };
    });

    if (rows.length > 0) {
      content.push({
        type: 'multipart-table',
        attrs: { importedFrom: '' },
        content: [{ type: 'table', content: rows }],
      });
    }
  } else if (entry.request.body) {
    // Request body (JSON or XML)
    const trimmed = entry.request.body.trim();
    if (ct.includes('xml') || (!ct && trimmed.startsWith('<'))) {
      content.push({
        type: 'xml_body',
        attrs: {
          importedFrom: '',
          body: entry.request.body,
          contentType: entry.request.contentType ?? 'application/xml',
        },
      });
    } else {
      let body = entry.request.body;
      try { body = JSON.stringify(JSON.parse(body), null, 2); } catch { /* keep as-is */ }
      content.push({
        type: 'json_body',
        attrs: {
          importedFrom: '',
          body,
          contentType: entry.request.contentType ?? 'application/json',
        },
      });
    }
  }

  const doc = { type: 'doc', content };
  return prosemirrorToMarkdown(JSON.stringify(doc), schema);
}
