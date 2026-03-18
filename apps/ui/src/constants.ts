export const METHOD_COLORS = {
  GET: "text-http-get",
  POST: "text-http-post",
  PUT: "text-http-put",
  PATCH: "text-http-patch",
  DELETE: "text-http-delete",
  HEAD: "text-http-head",
  OPTIONS: "text-http-options",
} as {
  [key: string]: string;
};

export const METHOD_BG_COLORS = {
  GET: "bg-httpbg-get",
  POST: "bg-httpbg-post",
  PUT: "bg-httpbg-put",
  PATCH: "bg-httpbg-patch",
  DELETE: "bg-httpbg-delete",
  HEAD: "bg-httpbg-head",
  OPTIONS: "bg-httpbg-options",
} as {
  [key: string]: string;
};

// Default priority for table = 100
export const PRIORITIES = {
  SUGGESTIONS: 101,
  COMMAND: 102,
};

export const HEADER_KEYS: Array<string> = [
  "Accept",
  "Accept-Encoding",
  "Accept-Language",
  "Authorization",
  "Cache-Control",
  "Content-Type",
  "Cookie",
  "Host",
  "User-Agent",
];
export const HEADER_VALUES: Array<string> = [
  "application/json",
  "application/xml",
  "application/x-www-form-urlencoded",
  "multipart/form-data",
  "text/plain",
  "text/html",
  "text/xml",
  "application/javascript",
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "audio/mpeg",
  "video/mp4",
  "application/octet-stream",
];
