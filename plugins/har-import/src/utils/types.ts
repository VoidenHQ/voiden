export interface HarHeader {
  name: string;
  value: string;
  comment?: string;
}

export interface HarCookie {
  name: string;
  value: string;
  path?: string;
  domain?: string;
  expires?: string;
  httpOnly?: boolean;
  secure?: boolean;
  comment?: string;
}

export interface HarQueryString {
  name: string;
  value: string;
  comment?: string;
}

export interface HarPostParam {
  name: string;
  value?: string;
  fileName?: string;
  contentType?: string;
  comment?: string;
}

export interface HarPostData {
  mimeType: string;
  params?: HarPostParam[];
  text?: string;
  comment?: string;
}

export interface HarRequest {
  method: string;
  url: string;
  httpVersion: string;
  cookies: HarCookie[];
  headers: HarHeader[];
  queryString: HarQueryString[];
  postData?: HarPostData;
  headersSize: number;
  bodySize: number;
  comment?: string;
}

export interface HarResponse {
  status: number;
  statusText: string;
  httpVersion: string;
  cookies: HarCookie[];
  headers: HarHeader[];
  content: {
    size: number;
    mimeType: string;
    text?: string;
    encoding?: string;
  };
  redirectURL: string;
  headersSize: number;
  bodySize: number;
}

export interface HarPage {
  id: string;
  startedDateTime: string;
  title: string;
  pageTimings?: Record<string, number>;
  comment?: string;
}

export interface HarEntry {
  pageref?: string;
  startedDateTime: string;
  time: number;
  request: HarRequest;
  response?: HarResponse;
  cache?: Record<string, any>;
  timings?: Record<string, number>;
  serverIPAddress?: string;
  connection?: string;
  comment?: string;
}

export interface HarLog {
  version: string;
  creator: {
    name: string;
    version: string;
    comment?: string;
  };
  browser?: {
    name: string;
    version: string;
    comment?: string;
  };
  pages?: HarPage[];
  entries: HarEntry[];
  comment?: string;
}

export interface HarContainer {
  log: HarLog;
}

export function isHarObject(data: any): data is HarContainer {
  return (
    data &&
    typeof data === 'object' &&
    data.log &&
    typeof data.log === 'object' &&
    Array.isArray(data.log.entries)
  );
}
