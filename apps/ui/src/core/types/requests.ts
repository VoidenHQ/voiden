export interface JsonData {
  _id?: string;
  collection_id?: string;
  version?: number;

  isModified?: boolean;
  binary?: File | string; // File object or file path string
  tabId?: string;

  parent_id?: string;
  name?: string;
  url?: string;
  method?: string;
  body?: string;
  prescript?: string[];
  postscript?: string[];
  content_type?: string;
  headers?: RequestParam[];
  params?: RequestParam[];
  body_params?: BodyParam[];
  auth?: Authorization;
  description?: string;
}

/**
 * The response object structure exposed to the test script
 */
export type TestResponse = {
  /** Status Code of the response */
  status: number;
  /** List of headers returned */
  headers: { key: string; value: string }[];
  /**
   * Body of the response, this will be the JSON object if it is a JSON content type, else body string
   */
  body: string | object;
};

/**
 * The result of an expectation statement
 */
type ExpectResult = {
  status: "pass" | "fail" | "error";
  message: string;
}; // The expectation failed (fail) or errored (error)

/**
 * An object defining the result of the execution of a
 * test block
 */
export type TestDescriptor = {
  /**
   * The name of the test block
   */
  descriptor: string;

  /**
   * Expectation results of the test block
   */
  expectResults: ExpectResult[];

  /**
   * Children test blocks (test blocks inside the test block)
   */
  children: TestDescriptor[];
};

// Representation of a transformed state for environment variables in the sandbox
type TransformedEnvironmentVariable = {
  key: string;
  value: string;
  secret: boolean;
};

/**
 * Defines the result of a test script execution
 */

export type TestResult = {
  tests: TestDescriptor[];
  envs: {
    global: TransformedEnvironmentVariable[];
    selected: TransformedEnvironmentVariable[];
  };
};

export type GlobalEnvItem = TestResult["envs"]["global"][number];
export type SelectedEnvItem = TestResult["envs"]["selected"][number];

export type SandboxTestResult = TestResult & { tests: TestDescriptor };

export type PreRequestResult = {
  left: string;
  right: TestResult["envs"];
};

export type TestRunnerResult = {
  left: string;
  right: SandboxTestResult;
};

export type ContentType =
  | "none"
  | "application/json"
  | "multipart/form-data"
  | "text/plain"
  | "binary"
  | "application/x-www-form-urlencoded"
  | "text/html";

export type BasicAuth = {
  username: string;
  password: string;
};

export type BearerToken = {
  token: string;
};

export type OAuth = {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  headerPrefix?: string;
  addTokenTo?: "header" | "query";
  autoRefresh?: boolean;
  grantType?: string;
  tokenUrl?: string;
};

export type APIKey = {
  key: string;
  value: string;
  in: "header" | "query";
};

type AuthType = "basic-auth" | "bearer-token" | "oauth" | "oauth2" | "none" | "api-key";

export type Authorization = {
  enabled: boolean;
  type: AuthType;
  // config is generic type key value pair
  config?: {
    [key: string]: string;
  };
};

export interface RequestParam {
  id?: string; // make it mandatory after refactor
  enabled: boolean;
  key: string;
  value: string;
  type?: "text" | "file";
}
export interface BodyParam {
  id?: string; // make it mandatory after refactor
  enabled: boolean;
  key: string;
  value: string | File | null;
  type?: string;
}

export interface Request {
  _id?: string;
  collection_id?: string;
  version?: number;

  isModified?: boolean; // this property is only available in the client side
  binary?: File | string; // File object or file path string (this property is only available in the client side)
  tabId?: string; // this property is only available in the client side

  parent_id?: string;
  name: string;
  url: any;
  method: string;
  body: string;
  prescript: any;
  postscript: any;
  content_type: ContentType;
  headers: RequestParam[];
  params: RequestParam[];
  path_params: RequestParam[];
  body_params: BodyParam[];
  event?: {
    listen: string;
    script: {
      exec: string[];
      type: string;
      packages: {};
    };
  }[];
  description?: string;
  auth: Authorization;
  openApiSpecs?: JsonData;
  preRequestResult?: PreRequestResult;
}

interface DeletedRequest {
  deleted: boolean;
  parent_id: string;
  version: number;
  _id: string;
}

export interface ResponseHeader {
  key: string;
  value: string;
}

export interface BaseRequestMeta {
  method: string;
  url: string;
  headers: { key: string; value: string }[];
  httpVersion?: string;
  tlsInfo?: {
    protocol: string;
    cipher: string;
    isSecure: boolean;
    certificate?: {
      issuer: string;
      expiry: string;
    };
  };
  proxy?: {
    name: string;
    host: string;
    port: number;
  };
}

export interface Assertion {
  desc: string;
  value: any;
}

export interface BaseResponse {
  statusCode: number;
  statusMessage: string;
  elapsedTime: number;
  contentType: string | null;
  url: string;
  bytesContent: number;
  headers: ResponseHeader[];
  body: string | Buffer | null;
  error: string | null;
  prerequestResult?: PreRequestResult;
  testRunnerResult?: TestRunnerResult;
  requestMeta?: BaseRequestMeta;
  protocol?: String;
  operationType?: string; // GraphQL operation type (query/mutation/subscription)
}

// helpers

// helper to check if body_params value is of type file
export const isFile = (value: string | File | null): value is File => {
  return typeof File !== "undefined" && value instanceof File;
};
