/**
 * Hook to access voiden-api plugin helpers
 */

export interface VoidenApiHelpers {
  createMethodNode: (method: string) => any;
  createUrlNode: (url: string) => any;
  createHeadersTableNode: (headers: [string, string][]) => any;
  createJsonBodyNode: (body: string, contentType: string) => any;
  createXMLBodyNode: (body: string, contentType: string) => any;
  createMultipartTableNode: (formData: [string, string][]) => any;
  createUrlTableNode: (formData: [string, string][]) => any;
  createQueryTableNode: (params: [string, string][]) => any;
  convertToVoidMarkdown: (jsonContent: any) => Promise<string>;
  convertBlocksToVoidFile: (title: string, blocks: any[]) => string;
  insertParagraphAfterRequestBlocks: (content: any[]) => any[];
}

/**
 * Get voiden-api helpers from the global window object
 */
export function getVoidenApiHelpers(): VoidenApiHelpers {
  const g = typeof window !== 'undefined' ? window : (globalThis as any);
  const helpers = g.__voidenHelpers__?.['voiden-wrapper-api-extension'];

  if (!helpers) {
    throw new Error(
      'Voiden API helpers not found. Make sure voiden-wrapper-api-extension is loaded before har-import.'
    );
  }

  return helpers;
}
