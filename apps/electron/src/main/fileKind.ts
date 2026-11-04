/**
 * What kind of file a diff is looking at, so binary files are never read or
 * shown as text (#610). Kept free of Electron imports so it can be tested.
 */

export type FileCategory = "image" | "document" | "audio" | "video" | "font" | "archive" | "executable" | "database" | "binary" | "text";

/** Images Chromium can draw, with the type used for the preview. */
const PREVIEW_IMAGES: Record<string, string> = {
  png: "image/png",
  apng: "image/apng",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
};

const CATEGORIES: Record<Exclude<FileCategory, "binary" | "text">, string[]> = {
  image: [...Object.keys(PREVIEW_IMAGES), "tif", "tiff", "heic", "heif", "psd", "raw", "cr2", "nef", "xcf", "sketch", "fig"],
  document: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "key", "pages", "numbers", "epub"],
  audio: ["mp3", "wav", "ogg", "oga", "flac", "m4a", "aac", "aiff", "wma", "opus"],
  video: ["mp4", "m4v", "mov", "webm", "avi", "mkv", "wmv", "flv", "mpg", "mpeg"],
  font: ["ttf", "otf", "woff", "woff2", "eot"],
  archive: ["zip", "gz", "tgz", "tar", "rar", "7z", "bz2", "xz", "zst", "dmg", "iso", "pkg", "jar", "war", "apk", "ipa", "whl", "nupkg"],
  executable: ["exe", "dll", "so", "dylib", "msi", "deb", "rpm", "o", "a", "lib", "class", "pyc", "wasm", "node"],
  database: ["sqlite", "sqlite3", "db", "mdb", "accdb", "realm"],
};

const LABELS: Record<FileCategory, string> = {
  image: "Image",
  document: "Document",
  audio: "Audio file",
  video: "Video file",
  font: "Font file",
  archive: "Archive",
  executable: "Program file",
  database: "Database file",
  binary: "Binary file",
  text: "Text file",
};

const CATEGORY_BY_EXTENSION = new Map<string, FileCategory>(
  Object.entries(CATEGORIES).flatMap(([category, extensions]) => extensions.map((ext) => [ext, category as FileCategory])),
);

/** Images larger than this are not previewed, only described. */
export const IMAGE_PREVIEW_LIMIT = 20 * 1024 * 1024;
/** Text files larger than this get a note instead of a line diff, so the window never freezes. */
export const TEXT_DIFF_LIMIT = 2 * 1024 * 1024;
/** Bytes read from the start of a file to tell text from binary. */
export const SNIFF_BYTES = 8000;

export const fileExtension = (filePath: string): string => {
  const name = filePath.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

/** The preview type for images Voiden can draw, or null. */
export const previewImageType = (filePath: string): string | null => PREVIEW_IMAGES[fileExtension(filePath)] ?? null;

/** True when the first bytes contain a NUL byte, the same check git uses for binary files. */
export const looksBinary = (head: Uint8Array): boolean => head.subarray(0, SNIFF_BYTES).includes(0);

/** Category from the file type, falling back to the content for unknown types. */
export function fileCategory(filePath: string, head?: Uint8Array): FileCategory {
  const known = CATEGORY_BY_EXTENSION.get(fileExtension(filePath));
  if (known) return known;
  return head && looksBinary(head) ? "binary" : "text";
}

export const categoryLabel = (category: FileCategory, filePath: string): string => {
  const ext = fileExtension(filePath);
  if (category === "text") return LABELS.text;
  return ext ? `${ext.toUpperCase()} ${LABELS[category].toLowerCase()}` : LABELS[category];
};

/** SVG is text, so it can also be shown as source; every other known category is binary. */
export const isBinaryCategory = (category: FileCategory, filePath: string): boolean =>
  category !== "text" && fileExtension(filePath) !== "svg";
