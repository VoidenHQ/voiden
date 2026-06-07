import {
  APIKey,
  // Assertion,
  Authorization,
  BaseResponse,
  BasicAuth,
  BearerToken,
  BodyParam,
  ContentType,
  OAuth,
  Request,
  RequestParam,
  isFile,
  PreRequestResult,
  TestResult,
  TestRunnerResult,
} from "@/core/types";
import { Proxy } from "@/core/types";
import { Buffer } from "buffer";
import { RestApiRequestState } from "./pipeline/types";
import { replaceProcessVariablesInText } from "./runtimeVariables";
import { parseJsonLossless } from "@/utils/losslessJson";

export interface EnvironmentVariable {
  key: string;
  value: string;
  currentValue?: string;
}

export interface Environment {
  id: string;
  name: string;
  variables: EnvironmentVariable[];
  cloud: boolean;
  created_at: string;
}

export interface Electron {
  isApp?: boolean;
  onLogin?: () => void;
  openExternal?: () => void;
  removeListener?: () => void;
  sendRequest?: any;
}

const arrayObjectsToUrlEncodedString = (array: Record<string, string | Environment>[]) => {
  return (
    array &&
    array
      .map((obj: Record<string, string>) => {
        return Object.entries(obj)
          .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
          .join("&");
      })
      .join("&")
  );
};

const getHeaders = async (headers: RequestParam[], auth?: Authorization) => {
  const authHeaders: Record<string, string> = {};

  if (!auth) {
    return headers
      .filter((header: RequestParam) => header.enabled)
      .reduce((acc: Record<string, string>, header: RequestParam) => {
        if (header.key.toLowerCase() === "content-type" && header.value === "multipart/form-data") {
          return acc;
        }

        if (header.key && header.value) {
          acc[header.key] = header.value;
        }

        return acc;
      }, {});
  }

  if (auth.enabled && auth.config) {
    switch (auth.type) {
      case "basic-auth": {
        const basicAuthConfig = auth.config as BasicAuth;
        let username = basicAuthConfig.username;
        let password = basicAuthConfig.password;
        try {
          username = await window.electron?.env?.replaceVariables(username);
        } catch { }
        try {
          username = await replaceProcessVariablesInText(username);
        } catch { }
        try {
          password = await window.electron?.env?.replaceVariables(password);
        } catch { }
        try {
          password = await replaceProcessVariablesInText(password);
        } catch { }
        const base64Credentials = Buffer.from(`${username}:${password}`).toString("base64");
        authHeaders["Authorization"] = `Basic ${base64Credentials}`;
        break;
      }
      case "bearer-token": {
        const bearerTokenConfig = auth.config as BearerToken;
        const token = bearerTokenConfig.token;
        authHeaders["Authorization"] = `Bearer ${token}`;
        break;
      }
      case "oauth2": {
        const oauthConfig = auth.config as OAuth;
        const tokenType = oauthConfig.tokenType || "Bearer";
        authHeaders["Authorization"] = `${tokenType} ${oauthConfig.accessToken}`;
        break;
      }
      case "oauth1": {
        // OAuth 1.0 requires signature generation
        // For now, provide basic support with the token
        const config = auth.config as any;
        const parts = [];
        if (config.consumerKey) parts.push(`oauth_consumer_key="${config.consumerKey}"`);
        if (config.token) parts.push(`oauth_token="${config.token}"`);
        parts.push('oauth_signature_method="PLAINTEXT"');
        let signature = `${config.consumerSecret || ""}&${config.tokenSecret || ""}`;
        try {
          signature = await window.electron?.env?.replaceVariables(signature);
        } catch { }
        try {
          signature = await replaceProcessVariablesInText(signature);
        } catch { }
        parts.push(`oauth_signature="${encodeURIComponent(signature)}"`);
        parts.push(`oauth_timestamp="${Math.floor(Date.now() / 1000)}"`);
        parts.push(`oauth_nonce="${Math.random().toString(36).substring(2)}"`);
        parts.push('oauth_version="1.0"');

        authHeaders["Authorization"] = `OAuth ${parts.join(", ")}`;
        break;
      }
      case "oauth": {
        // Legacy: handle old "oauth" type as oauth2
        const oauthConfig = auth.config as OAuth;
        authHeaders["Authorization"] = `Bearer ${oauthConfig.accessToken}`;
        break;
      }
      case "api-key": {
        const apiKeyConfig = auth.config as APIKey;
        const key = apiKeyConfig.key;
        const value = apiKeyConfig.value;
        if (apiKeyConfig.in === "header") {
          authHeaders[key] = value;
        }
        break;
      }
      default:
        break;
    }
  }
  const finalHeaders: Record<string, string> = headers
    .filter((header: RequestParam) => header.enabled)
    .reduce((acc: Record<string, string>, header: RequestParam) => {
      const key = header.key;
      const value = header.value;

      if (key.toLowerCase() === "content-type" && value === "multipart/form-data") {
        return acc;
      }

      if (key && value) {
        acc[key] = value;
      }

      return acc;
    }, authHeaders);

  return finalHeaders;
};

const getParameters = (parameters: RequestParam[], auth?: Authorization) => {
  let authQuery = "";
  if (auth && auth.config && auth.enabled && auth.type === "api-key" && auth.config.in === "query") {
    authQuery = `${auth.config.key}=${auth.config.value}`;
  }

  const filteredParameters = parameters.filter((parameter: RequestParam) => parameter.enabled && (parameter.key || parameter.value));

  const queryString = filteredParameters
    .map((obj: RequestParam) => {
      const key = obj.key;
      const value = obj.value;
      return `${key}=${value}`;
    })
    .join("&");

  if (authQuery && queryString) {
    return `?${authQuery}&${queryString}`;
  } else if (authQuery) {
    return `?${authQuery}`;
  } else if (queryString) {
    return `?${queryString}`;
  }

  return "";
};

const getBody = (
  content_type: ContentType,
  body: string,
  body_params: BodyParam[],
  binary?: File,
  environment?: Environment,
): File | string | null | FormData => {
  // Utility function to remove comments from JSON
  const removeJsonComments = (json: string): string => {
    const regex = /("(?:\\.|[^"\\])*")|\/\/.*|\/\*[\s\S]*?\*\//g; // Match strings and comments
    return json.replace(regex, (match, capturedString) => (capturedString ? match : ""));
  };

  if ((content_type === "application/json" || content_type === "text/plain" || content_type === "text/html") && body) {
    if (content_type === "application/json") {
      const sanitizedBody = removeJsonComments(body);
      return sanitizedBody;
    }
    return body;
  }
  if (content_type === "binary" && binary) {
    return binary;
  }

  if (typeof File !== "undefined" && binary instanceof File) {
    return binary;
  } else if (Buffer.isBuffer(binary)) {
    return binary;
  }

  if (content_type === "multipart/form-data") {
    const formData = new FormData();
    const enabledBodyParams = body_params?.filter((param) => param.enabled);

    enabledBodyParams.forEach((param) => {
      if (param.value) {
        // If the value is an ArrayBuffer, convert it to a File.
        if (param.value instanceof Uint8Array) {
          // @ts-expect-error
          const file = new File([param.value], param.fileName || "unknown");
          formData.append(param.key, file);
        }
        // If the value is already a File, append it directly.
        else if (isFile(param.value)) {
          formData.append(param.key, param.value);
        }
        // Otherwise, append the value as a string (or empty string if it's an object).
        else {
          formData.append(param.key, typeof param.value === "object" ? "" : param.value);
        }
      }
    });
    return formData;
  }

  if (content_type === "application/x-www-form-urlencoded") {
    const data = body_params
      ?.filter((param) => param.enabled && param.value)
      .map((param) => {
        if (param.value && !isFile(param.value)) {
          return {
            key: param.key,
            value: param.value,
            environment,
          };
        }
      });

    return data ? arrayObjectsToUrlEncodedString(data) : "";
  }
  return null;
};

async function parseBody(response: Response): Promise<Buffer | string | object | null> {
  const contentType = response.headers.get("content-type")?.toLowerCase() || "";

  // Broadly match known binary types
  const isBinary =
    contentType.startsWith("image/") ||
    contentType.startsWith("video/") ||
    contentType.startsWith("audio/") ||
    contentType.includes("pdf") ||
    contentType.includes("octet-stream") ||
    contentType.includes("zip") ||
    contentType.includes("gzip") ||
    contentType.includes("tar") ||
    contentType.includes("msword") ||
    contentType.includes("officedocument") ||
    contentType.includes("application/vnd") ||
    contentType.includes("application/x-") ||
    contentType.includes("font") ||
    contentType.includes("exe") ||
    contentType.includes("binary");

  if (isBinary) {
    const data = await response.blob();
    const buffer = await data.arrayBuffer();
    return Buffer.from(buffer);
  }

  // Text formats
  if (
    contentType.startsWith("text/") ||
    contentType.includes("xml") ||
    contentType.includes("yaml") ||
    contentType.includes("csv") ||
    contentType.includes("html")
  ) {
    return await response.text();
  }

  // JSON
  if (contentType.includes("json")) {
    try {
      return parseJsonLossless(await response.text());
    } catch (e) {
      return await response.text(); // fallback if parsing fails
    }
  }

  // Unknown content type fallback: treat as binary
  const data = await response.blob();
  const buffer = await data.arrayBuffer();
  return Buffer.from(buffer);
}

async function parseBodyFromBytes(bytes: Buffer, contentType: string | null): Promise<Buffer | string | null> {
  // Handle text-based content types including XML and YAML.
  if (contentType?.startsWith("text/") || contentType?.includes("xml") || contentType?.includes("yaml")) {
    return bytes.toString();
  }

  // Handle JSON content type.
  if (contentType?.includes("json")) {
    try {
      return parseJsonLossless(bytes.toString());
    } catch (error) {
      // Fallback to returning the raw string if JSON parsing fails.
      return bytes.toString();
    }
  }

  // For binary content types, we return the bytes directly.
  if (
    contentType?.startsWith("image/") ||
    contentType?.startsWith("video/") ||
    contentType?.startsWith("audio/") ||
    contentType?.includes("pdf") ||
    contentType?.includes("octet-stream")
  ) {
    return bytes;
  }

  // Return null if content type is unrecognized.
  return null;
}

async function handleRequestThroughElectron(
  urlForRequest: string,
  fetchOptions: RequestInit,
  signal?: AbortSignal,
  electron?: Electron,
): Promise<Response> {
  if (!electron?.sendRequest) {
    throw new Error("Electron is not available");
  }

  let bodyHint: any = null;
  let body: BodyInit | string | [string, FormDataEntryValue][] | undefined | null = fetchOptions.body;

  if (body instanceof FormData) {
    interface CustomFile extends File {
      buffer: number[];
    }

    bodyHint = "FormData";
    body = Array.from(body.entries());
    let i = 0;
    for (const item of body) {
      if (item[1] instanceof File) {
        const fileBuffer = await item[1].arrayBuffer();
        body[i][1] = {
          name: item[1].name,
          type: item[1].type,
          buffer: Array.from(new Uint8Array(fileBuffer)),
        } as CustomFile;
      }
      i++;
    }
  } else if (body instanceof File) {
    bodyHint = "File";
    const fileBuffer = await body.arrayBuffer();
    body = {
      ...(body as File),
      buffer: new Uint8Array(fileBuffer),
    };
  }

  // Modify fetchOptions to include modified body and bodyHint
  interface CustomRequestInit extends RequestInit {
    bodyHint?: string;
  }

  fetchOptions.body = body as BodyInit;
  (fetchOptions as CustomRequestInit).bodyHint = bodyHint;

  const responseObj = await electron?.sendRequest(
    urlForRequest,
    fetchOptions,
    signal ? { aborted: signal.aborted } : undefined, // Pass signal state
  );

  if (responseObj.statusText === "app-error") {
    return new Response(null, {
      status: 0,
      statusText: responseObj.statusText,
    });
  }

  // Safely extract content-type from headers
  const headersArray = responseObj.headers as [string, string][];
  const contentType =
    headersArray.find(([key]) => key.toLowerCase() === "content-type")?.[1] ||
    "application/octet-stream";

  // Convert Uint8Array to Blob
  let bodyContent: Blob | null = null;
  if (responseObj.body) {
    const buffer = new Uint8Array(responseObj.body);
    bodyContent = new Blob([buffer.buffer], { type: contentType });
  }


  // Create a new Response object using the bodyContent
  const response = new Response(bodyContent, {
    status: responseObj.status,
    statusText: responseObj.statusText,
    headers: new Headers(responseObj.headers),
  });
  return response;
}

function buildBaseResponse(
  status: number,
  statusText: string,
  headers: Headers | { [key: string]: string },
  contentType: string | null,
  body: Buffer | string | null,
  url: string,
  elapsedTime: number,
  error: string | null,
  prerequestResult?: PreRequestResult,
  testRunnerResult?: TestRunnerResult,
): BaseResponse {
  const headersArray = Array.isArray(headers) ? headers : Object.entries(headers).map(([key, value]) => ({ key, value }));

  const headersLength = new TextEncoder().encode(JSON.stringify({ headers })).length;

  const responseSize =
    contentType?.includes("json") || contentType?.startsWith("text/")
      ? new TextEncoder().encode(JSON.stringify({ body, headers })).length
      : new TextEncoder().encode(JSON.stringify({ body, headers })).length + String(body).length;

  const bytesContent =
    contentType &&
      (contentType.startsWith("image/") ||
        contentType.startsWith("video/") ||
        contentType.startsWith("audio/") ||
        contentType.includes("application/pdf") ||
        contentType.includes("application/octet-stream") ||
        contentType.includes("multipart/form-data"))
      ? body?.length
        ? body?.length + headersLength
        : responseSize
      : responseSize;

  return {
    statusCode: status,
    statusMessage: statusText,
    headers: headersArray,
    contentType,
    elapsedTime,
    body,
    url,
    bytesContent,
    error,
    prerequestResult,
    testRunnerResult,
  };
}

export function replaceBaseUrl(url: string, newBase: string): string {
  const { pathname, search, hash } = new URL(url);
  const newBaseUrl = new URL(newBase);
  return `${newBaseUrl.origin}${newBaseUrl.pathname}${pathname}${search}${hash}`;
}

export const updateLocalStorageValue = (testRunnerResult: TestRunnerResult, environment: Environment) => {
  try {
    const envArray = testRunnerResult?.right?.envs?.selected || [];
    const storedEnv = localStorage.getItem(environment?.id || "");
    const parsedEnv = JSON.parse(storedEnv);
    if (storedEnv) {
      const updatedJson = {
        ...parsedEnv,
        variables: environment.variables
          .map((variable: EnvironmentVariable) => {
            const currentEnv = envArray.find((val) => val?.key === variable?.key);
            if (currentEnv) {
              return {
                key: variable.key,
                value: variable.value,
                currentValue: currentEnv.value,
              };
            }
            return variable;
          })
          .filter((val) => !!val.currentValue)
          ?.map((val) => {
            return {
              key: val?.key,
              currentValue: val?.currentValue,
            };
          }),
      };
      localStorage.setItem(environment.id, JSON.stringify(updatedJson));
      return;
    } else {
      if (environment.id) {
        const envArray = testRunnerResult?.right?.envs?.selected || [];
        const updatedJson = {
          ...environment,
          variables:
            environment.variables
              .map((variable: EnvironmentVariable) => {
                const currentEnv = envArray.find((val) => val?.key === variable?.key);
                if (currentEnv) {
                  return {
                    key: variable.key,
                    value: variable.value,
                    currentValue: currentEnv.value,
                  };
                }
                return variable;
              })
              ?.filter((val) => !!val.currentValue)
              ?.map((val) => {
                return {
                  key: val?.key,
                  currentValue: val?.currentValue,
                };
              }) || [],
        };

        localStorage.setItem(environment?.id, JSON.stringify(updatedJson));
      }
      return;
    }
  } catch (error) {
  }
};

export const replacePathParams = (url: string, pathParams: RequestParam[]): string => {
  let updatedUrl = url;
  pathParams.forEach((param) => {
    if (param.enabled && param.key && param.value) {
      const regex = new RegExp(`{${param.key}}`, "g"); // ✅ change from :param to {param}
      updatedUrl = updatedUrl.replace(regex, encodeURIComponent(param.value));
    }
  });
  return updatedUrl;
};

export async function sendRequest(
  data: Request,
  signal?: AbortSignal,
  environment?: Environment,
  isCLIRequest?: boolean,
  activeProxy?: Proxy | undefined,
  electron?: Electron,
  mockParams?: {
    docId: string;
  },
  base_url?: string,
): Promise<BaseResponse | undefined> {

  const testRunnerResult: TestRunnerResult | undefined = undefined;

  const scriptEnvs: TestResult["envs"] = {
    global: [],
    selected: environment
      ? Object.entries(environment).map(([key, value]) => ({
        key,
        value,
        secret: false,
      }))
      : [],
  };
  const headers = await getHeaders(data.headers, data.auth);

  const parameters = getParameters(data.params, data.auth);

  const body = getBody(data.content_type, data.body, data.body_params, data.binary, environment);
  const urlWithPathParams = replacePathParams(data.url, data.path_params || []);
  const urlWithEnvVariables = urlWithPathParams;

  let urlForRequest = (urlWithEnvVariables.substring(0, 4).includes("http") ? urlWithEnvVariables : `http://${urlWithEnvVariables}`).concat(
    urlWithEnvVariables.includes("?") ? parameters.replace("?", "&") : parameters,
  );

  if (mockParams) {
    urlForRequest = replaceBaseUrl(urlForRequest, `${base_url}/mock/${mockParams.docId}`);
  }

  const fetchOptions: RequestInit = {
    method: data.method,
    headers,
  };

  if (body && data.method !== "GET") {
    fetchOptions.body = body;
    const contentTypeHeader = Object.keys(headers).find((key) => key.toLowerCase() === "content-type");
    if (data.content_type !== "multipart/form-data") {
      if (contentTypeHeader) {
        headers[contentTypeHeader] = data.content_type;
      } else {
        headers["Content-Type"] = data.content_type;
      }
    }
  }

  if (body && data.content_type === "binary") {
    fetchOptions.body = data.binary;

    const contentTypeHeader = Object.keys(headers).find((key) => key.toLowerCase() === "content-type");

    const binaryContentType = data.binary?.type || "application/octet-stream";

    if (contentTypeHeader) {
      headers[contentTypeHeader] = binaryContentType;
    } else {
      headers["Content-Type"] = binaryContentType;
    }
  }

  fetchOptions.headers = headers;

  try {
    const startTime = performance.now();

    const response = await handleRequestThroughElectron(urlForRequest, fetchOptions, signal, electron);

    const endTime = performance.now();
    const responseTime = endTime - startTime;
    if (response instanceof Response) {
      // Handling regular fetch response
      const body = await parseBody(response);

      const baseResponse = buildBaseResponse(
        response.status,
        response.statusText,
        Object.fromEntries(response.headers.entries()),
        response.headers.get("content-type"),
        body,
        response.url,
        responseTime,
        null,
        data.preRequestResult,
        testRunnerResult,
      );

      return baseResponse;
    }
  } catch (error) {
    return buildBaseResponse(0, "", {}, null, null, "", 0, error.message);
  }
}

// ============================================================================
// Secure Request Sending (Phase 2)
// ============================================================================

/**
 * Convert Request object to RestApiRequestState for secure API
 * Merges auth into headers/queryParams before sending
 */
async function convertToRestApiRequestState(data: Request): Promise<RestApiRequestState> {


  // Merge auth into headers and query params
  const mergedHeaders = await getHeaders(data.headers, data.auth);
  const parameters = getParameters(data.params, data.auth);


  // Convert headers object back to array format
  const headersArray = Object.entries(mergedHeaders).map(([key, value]) => ({
    key,
    value,
    enabled: true,
  }));

  // Parse query params from parameters string
  const queryParamsArray = data.params
    .filter((p) => p.enabled)
    .map((p) => ({
      key: p.key,
      value: p.value,
      enabled: p.enabled,
    }));

  // Add auth query param if present (for API Key in query)
  if (parameters && !parameters.startsWith('?')) {
    // Parameters has auth query, extract it
    const authQueryMatch = parameters.match(/([^=]+)=([^&]*)/);
    if (authQueryMatch && data.auth?.type === 'api-key') {
      queryParamsArray.push({
        key: authQueryMatch[1],
        value: authQueryMatch[2],
        enabled: true,
      });
    }
  }

  const yamlContentTypes = ["application/x-yaml", "application/yaml", "text/yaml", "text/x-yaml"];
  const isYamlBody = yamlContentTypes.includes(data.content_type || "");
  const normalizedBody =
    isYamlBody && typeof data.body !== "string"
      ? (data.body == null ? "" : String(data.body))
      : data.body;

  const result = {
    method: data.method,
    url: data.url,
    headers: headersArray,
    queryParams: queryParamsArray,
    pathParams: (data.path_params || [])
      .filter((p) => p.enabled)
      .map((p) => ({
        key: p.key,
        value: p.value,
        enabled: p.enabled,
      })),
    body: normalizedBody,
    contentType: data.content_type,
    bodyParams: data.body_params?.map((p) => ({
      key: p.key,
      value: p.value,
      type: p.type,
      enabled: p.enabled,
    })),
    binary: data.binary,
    authProfile: undefined, // TODO: Auth profile reference
    preRequestResult: data.preRequestResult,
    metadata: {},
  };

  return result;
}

/**
 * Secure version of sendRequest that uses Electron's secure API.
 * Variables are replaced in Electron main process, never exposed to UI.
 *
 * @security Environment values never leave Electron main process
 */
export async function sendRequestSecure(
  data: Request,
  signal?: AbortSignal,
  electron?: Electron,
): Promise<BaseResponse | undefined> {

  if (!electron || !window.electron?.request?.sendSecure) {
    throw new Error("Secure request API not available");
  }

  try {
    const startTime = performance.now();

    // Convert to RestApiRequestState (with {{variables}} unexpanded)
    const requestState = await convertToRestApiRequestState(data);

    // Send to Electron for secure processing
    const response = await window.electron.request.sendSecure(
      requestState,
      signal ? { aborted: signal.aborted } : undefined
    );

    const endTime = performance.now();
    const responseTime = endTime - startTime;

    // Check if request failed
    if (!response.status && response.statusText) {
      return buildBaseResponse(
        0,
        response.statusText,
        {},
        null,
        null,
        "",
        responseTime,
        response.error || response.statusText,
        data.preRequestResult,
        undefined
      );
    }

    // Convert headers array to object
    const headersObj: Record<string, string> = {};
    if (response.headers) {
      response.headers.forEach(([key, value]: [string, string]) => {
        headersObj[key] = value;
      });
    }

    // Parse body from Buffer
    let body = null;
    if (response.body) {
      const buffer = Buffer.from(response.body);
      const contentType = headersObj["content-type"] || "";

      if (contentType.includes("json")) {
        try {
          body = parseJsonLossless(buffer.toString("utf-8"));
        } catch {
          body = buffer.toString();
        }
      } else if (contentType.includes("text/")) {
        body = buffer.toString();
      } else {
        body = buffer;
      }
    }

    return buildBaseResponse(
      response.status,
      response.statusText,
      headersObj,
      headersObj["content-type"] || null,
      body,
      response.requestMeta?.url || requestState.url,
      responseTime,
      null,
      data.preRequestResult,
      undefined
    );
  } catch (error) {
    return buildBaseResponse(0, "", {}, null, null, "", 0, error.message);
  }
}
