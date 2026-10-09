/**
 * Helper to identify static asset URLs or MIME types
 */

const STATIC_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'avif', 'bmp', 'tiff',
  'css', 'scss', 'less',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx',
  'woff', 'woff2', 'ttf', 'eot', 'otf',
  'mp3', 'mp4', 'wav', 'ogg', 'webm', 'aac', 'flac',
  'pdf', 'map', 'swf'
]);

const STATIC_MIME_PREFIXES = [
  'image/',
  'font/',
  'audio/',
  'video/'
];

const STATIC_MIME_EXACT = new Set([
  'text/css',
  'application/javascript',
  'text/javascript',
  'application/x-javascript',
  'application/font-woff',
  'application/font-woff2',
  'application/x-font-ttf',
  'application/vnd.ms-fontobject'
]);

/**
 * Checks if a HAR entry represents a static asset request based on URL extension or MIME type
 */
export function isStaticAsset(url: string, mimeType?: string): boolean {
  // Check MIME type if provided
  if (mimeType) {
    const cleanMime = mimeType.split(';')[0].trim().toLowerCase();
    if (STATIC_MIME_EXACT.has(cleanMime)) return true;
    if (STATIC_MIME_PREFIXES.some((prefix) => cleanMime.startsWith(prefix))) return true;
  }

  // Check URL pathname extension
  try {
    const parsedUrl = new URL(url);
    const pathname = parsedUrl.pathname;
    const lastDotIndex = pathname.lastIndexOf('.');
    if (lastDotIndex !== -1 && lastDotIndex < pathname.length - 1) {
      const ext = pathname.slice(lastDotIndex + 1).toLowerCase();
      if (STATIC_EXTENSIONS.has(ext)) {
        return true;
      }
    }
  } catch {
    // If URL parsing fails, perform simple string suffix check
    const cleanUrl = url.split('?')[0].split('#')[0].toLowerCase();
    const lastDotIndex = cleanUrl.lastIndexOf('.');
    if (lastDotIndex !== -1 && lastDotIndex < cleanUrl.length - 1) {
      const ext = cleanUrl.slice(lastDotIndex + 1);
      if (STATIC_EXTENSIONS.has(ext)) {
        return true;
      }
    }
  }

  return false;
}
