/**
 * Core request engine — generic, protocol-agnostic utilities.
 *
 * This file must NOT contain block-specific logic for any plugin's node types.
 * REST body nodes (json_body, xml_body, yml_body, multipart-table, url-table, restFile)
 * are owned by voiden-rest-api → core-extensions/src/voiden-rest-api/lib/requestBuilder.ts
 */

import { JSONContent } from "@tiptap/core";
import { PreRequestResult, Request, RequestParam, TestResult } from "@/core/types";
import { v4 } from "uuid";

import { executeScriptInContext as preRequestExecutor } from "@/core/request-engine/components/worker";

interface CliReqObject {
  isCli: boolean;
  documentId: string;
  cliToken: string;
}

export const createNewRequestObject = ({
  _id,
  tabId,
  collection_id,
  parent_id,
  name,
  method,
  url,
  path_params,
  params,
  headers,
  content_type,
  body,
  body_params,
  auth,
  prescript,
  postscript,
  isModified,
}: Partial<Request> = {}): Request => {
  return {
    tabId: v4(),
    _id: _id,
    collection_id: undefined,
    parent_id: undefined,
    path_params: path_params || [],
    name: "Undefined",
    method: method || "GET",
    url: url || "",
    params: params || [],
    headers: headers || [],
    content_type: content_type || "none",
    body: body || "",
    body_params: body_params || [],
    auth: auth || { enabled: false, type: "none", config: undefined },
    prescript: prescript || "",
    postscript: postscript || "",
    isModified: false,
  };
};

export type Doc = {
  type: "doc";
  content: JSONContent[];
};

export const findNode = (editor: Doc, nodeName: string) => {
  return editor.content.find((node) => node.type === nodeName);
};

export const findNodes = (editor: Doc, nodeName: string) => {
  return editor.content.filter((node) => node.type === nodeName);
};

/**
 * Generic key-value table reader. Works for any table node type.
 * Exported so protocol plugins can read their own tables.
 */
export const getTable = (
  type: "headers-table" | "query-table" | "url-table" | "multipart-table" | "path-table" | "cookies-table" | "options-table" | "file" | "runtime-variables",
  editor: Doc,
  environment?: Record<string, string>,
) => {
  type KeyValueType = {
    key: string;
    value: string;
    enabled: boolean;
    importedFrom?: string;
    type?: "text" | "file";
  };
  const allKeyValues: KeyValueType[] = [];

  editor?.content.forEach((rootNode) => {
    if (rootNode.type === type) {
      rootNode.content?.forEach((node) => {
        if (node.type === "table") {
          node.content?.forEach((rowNode) => {
            if (rowNode.type === "tableRow") {
              const kv: KeyValueType = { key: "", value: "", enabled: true, type: "text" };
              rowNode.content?.forEach((cellNode, cellIndex) => {
                if (cellNode.type === "tableCell") {
                  const text = ((cellNode.content && cellNode.content[0].content && cellNode.content[0].content[0]?.text) || "").trim();
                  if (cellIndex === 0) kv.key = text;
                  else if (cellIndex === 1) {
                    if (type === "multipart-table") { kv.value = cellNode.attrs?.file || ""; kv.type = "file"; }
                    else kv.value = text;
                  }
                }
              });
              if (kv.key && kv.value) {
                allKeyValues.push({ ...kv, enabled: !rowNode.attrs?.disabled, importedFrom: rootNode.attrs?.importedFrom });
              }
            }
          });
        }
      });
    }
  });

  const replaceEnv = (text: string) => (environment ? replaceEnvVariables(text, environment) : text);

  const groupedByKey = allKeyValues
    .filter((item) => item.enabled)
    .reduce((acc, val) => {
      const values = acc[val.key] || [];
      values.push({ ...val, value: replaceEnv(val.value) });
      return { ...acc, [val.key]: values };
    }, {} as Record<string, KeyValueType[]>);

  return Object.values(groupedByKey).flatMap((items) => {
    if (items.length > 1) {
      const localValues = items.filter((item) => !item.importedFrom);
      if (localValues.length > 0) return localValues;
    }
    return items;
  });
};

/**
 * Parse the auth node and return auth config for the request pipeline.
 * Exported so all protocol plugins can reuse it.
 */
export const parseAuthNode = (editor: Doc) => {
  const authNode = findNode(editor, "auth");
  if (!authNode?.attrs) return undefined;

  const authType = authNode.attrs.authType;
  if (authType === "inherit" || authType === "none") return undefined;

  const typeMapping: Record<string, string> = {
    bearer: "bearer-token", basic: "basic-auth", apiKey: "api-key",
    oauth2: "oauth2", oauth1: "oauth1", digest: "digest-auth",
    ntlm: "ntlm", awsSignature: "aws-signature", hawk: "hawk",
    atlassianAsap: "atlassian-asap", netrc: "netrc",
  };
  const mappedType = typeMapping[authType];
  if (!mappedType) return undefined;

  const config: Record<string, string> = {};
  authNode.content?.forEach((node) => {
    if (node.type === "table") {
      node.content?.forEach((rowNode) => {
        if (rowNode.type === "tableRow") {
          let key = ""; let value = "";
          rowNode.content?.forEach((cellNode, idx) => {
            if (cellNode.type === "tableCell") {
              const text = ((cellNode.content?.[0]?.content?.[0]?.text) || "").trim();
              if (idx === 0) key = text;
              else if (idx === 1) value = text;
            }
          });
          if (key) config[key] = value;
        }
      });
    }
  });

  let finalConfig: any = config;

  switch (authType) {
    case "bearer": finalConfig = { token: config.token || "" }; break;
    case "basic": finalConfig = { username: config.username || "", password: config.password || "" }; break;
    case "apiKey": finalConfig = { key: config.key || "", value: config.value || "", in: config.add_to || "header" }; break;
    case "oauth2": {
      let oauth2Attrs: Record<string, any> = {};
      try {
        const raw = authNode.attrs?.oauth2Config;
        if (raw && typeof raw === "string") oauth2Attrs = JSON.parse(raw);
        else if (raw && typeof raw === "object") oauth2Attrs = raw;
      } catch { }
      const varPrefix = oauth2Attrs.variablePrefix || "oauth2";
      finalConfig = {
        accessToken: `{{process.${varPrefix}_access_token}}`,
        tokenType: `{{process.${varPrefix}_token_type}}`,
        headerPrefix: oauth2Attrs.headerPrefix || "Bearer",
        addTokenTo: oauth2Attrs.addTokenTo || "header",
        autoRefresh: oauth2Attrs.autoRefresh === true,
        variablePrefix: varPrefix,
        grantType: oauth2Attrs.grantType || "authorization_code",
        tokenUrl: config.token_url || oauth2Attrs.tokenUrl || "",
        clientId: config.client_id || oauth2Attrs.clientId || "",
        clientSecret: config.client_secret || oauth2Attrs.clientSecret || "",
        scope: config.scope || "",
        refreshToken: `{{process.${varPrefix}_refresh_token}}`,
        authUrl: config.auth_url || "", callbackUrl: config.callback_url || "",
        state: config.state || "", username: config.username || "", password: config.password || "",
        clientAuthMethod: oauth2Attrs.clientAuthMethod || "client_secret_post",
        customParams: oauth2Attrs.customParams || "",
      };
      break;
    }
    case "oauth1":
      finalConfig = { consumerKey: config.consumer_key || "", consumerSecret: config.consumer_secret || "", token: config.access_token || "", tokenSecret: config.token_secret || "", signatureMethod: config.signature_method || "HMAC-SHA1" };
      break;
    case "digest": finalConfig = { username: config.username || "", password: config.password || "", realm: config.realm || "", algorithm: config.algorithm || "MD5" }; break;
    case "ntlm": finalConfig = { username: config.username || "", password: config.password || "", domain: config.domain || "", workstation: config.workstation || "" }; break;
    case "awsSignature": finalConfig = { accessKey: config.access_key || "", secretKey: config.secret_key || "", region: config.region || "us-east-1", service: config.service || "execute-api" }; break;
  }

  return { enabled: true, type: mappedType, config: finalConfig };
};

/**
 * Build the headers array with cookies merged in.
 * Exported so all protocol plugins can reuse it.
 */
export const buildHeadersWithCookies = (editor: Doc, environment?: Record<string, string>) => {
  const headers = [...getTable("headers-table", editor, environment)];
  const cookies = getTable("cookies-table", editor, environment);
  if (cookies.length > 0) {
    const cookieString = cookies.map((c) => `${c.key}=${c.value}`).join("; ");
    const idx = headers.findIndex((h) => h.key.toLowerCase() === "cookie");
    if (idx !== -1) headers[idx] = { ...headers[idx], value: headers[idx].value + "; " + cookieString };
    else headers.push({ key: "Cookie", value: cookieString, enabled: true });
  }
  return headers;
};

/**
 * Core request builder. Returns generic request fields (headers, auth, params,
 * scripts). REST body/content-type is NOT read here — the voiden-rest-api plugin
 * owns that in its onBuildRequest handler.
 *
 * For WS/gRPC/GraphQL: returns a minimal stub; each plugin builds the full
 * request via onBuildRequest.
 */
export const getRequest = async (
  editor: Doc,
  activeDocKey: string,
  environment?: Record<string, string>,
  cliReqObject?: CliReqObject,
  base_url?: string,
) => {
  const preRequestCodeBlock = findNode(editor, "pre_request_block")?.attrs?.body;
  const postRequestCodeBlock = findNodes(editor, "post_request_block")
    ?.map((node) => node?.attrs?.body)
    .join(`\n`);

  const getProtocolType = (editor: Doc) => {
    if (findNode(editor, "gqlquery")) return "graphql";
    const endpointNode = findNode(editor, "socket-request");
    const smethodNode = endpointNode?.content?.find((node) => node.type === "smethod");
    const method = smethodNode?.content?.[0]?.text || smethodNode?.attrs?.method || "GET";
    const lower = method.toLowerCase();
    if (lower === "wss" || lower === "ws" || lower === "grpc" || lower === "grpcs") return lower;
    return "rest";
  };

  const protocolType = getProtocolType(editor);

  const getMethod = (editor: Doc): string => {
    const endpointNode = findNode(editor, "api") || findNode(editor, "request") || findNode(editor, "socket-request");
    return endpointNode?.content?.find((node) => node.type === "method")?.content?.[0]?.text || "GET";
  };

  const getUrl = (editor: Doc): string => {
    const endpointNode = findNode(editor, "api") || findNode(editor, "request") || findNode(editor, "socket-request");
    return endpointNode?.content?.find((node) => node.type === "url")?.content?.[0]?.text
      || endpointNode?.content?.find((node) => node.type === "surl")?.content?.[0]?.text || "";
  };

  const auth = parseAuthNode(editor);
  const pathParams = getTable("path-table", editor, environment);

  let method: string;
  let rawUrl: string;

  if (protocolType === "wss" || protocolType === "ws") {
    method = "CONNECT";
    const wsNode = findNode(editor, "socket-request");
    rawUrl = wsNode?.content?.find((node) => node.type === "surl")?.content?.[0]?.text || "";
  } else if (protocolType === "grpc" || protocolType === "grpcs") {
    method = protocolType.toUpperCase();
    rawUrl = getUrl(editor);
  } else if (protocolType === "graphql") {
    method = "POST";
    rawUrl = getUrl(editor);
  } else {
    method = getMethod(editor);
    rawUrl = getUrl(editor);
  }

  const urlWithPathParams = pathParams.reduce((acc, _param) => acc, rawUrl);

  const base = createNewRequestObject({ _id: activeDocKey, method, url: urlWithPathParams });

  let output: any;

  if (protocolType === "wss" || protocolType === "ws") {
    output = {
      ...base,
      protocolType: "wss",
      url: urlWithPathParams,
      headers: buildHeadersWithCookies(editor, environment),
      params: getTable("query-table", editor, environment),
      auth: auth || base.auth,
    };
  } else if (protocolType === "graphql") {
    output = {
      ...base,
      protocolType: "graphql",
      url: urlWithPathParams,
      headers: buildHeadersWithCookies(editor, environment),
      content_type: "application/json",
      prescript: preRequestCodeBlock,
      postscript: postRequestCodeBlock,
      auth: auth || base.auth,
    };
  } else if (protocolType === "grpc" || protocolType === "grpcs") {
    output = {
      ...base,
      protocolType: "grpc",
      url: urlWithPathParams,
      auth: auth || base.auth,
      prescript: preRequestCodeBlock,
      postscript: postRequestCodeBlock,
    };
  } else {
    // REST — body/content_type/body_params/binary are NOT set here.
    // The voiden-rest-api plugin's onBuildRequest reads those from its own block types.
    const optionsTable = getTable("options-table", editor, environment);
    const options: Record<string, string> = {};
    for (const opt of optionsTable) { if (opt.enabled) options[opt.key] = opt.value; }

    output = {
      ...base,
      protocolType: "rest",
      headers: buildHeadersWithCookies(editor, environment),
      params: getTable("query-table", editor, environment),
      path_params: getTable("path-table", editor, environment),
      prescript: preRequestCodeBlock,
      postscript: postRequestCodeBlock,
      auth: auth || base.auth,
      options,
    } as Request;
  }

  const scriptEnvs: TestResult["envs"] = {
    global: [],
    selected: environment
      ? Object.entries(environment).map(([key, value]) => ({ key, value, secret: false }))
      : [],
  };

  let preRequestResult: PreRequestResult | undefined = undefined;
  preRequestResult = environment ? preRequestExecutor(output.prescript, scriptEnvs) : undefined;

  const updatedEnvValues = preRequestResult?.right?.selected?.map(({ key, value }) => ({ key, value })) || [];
  const updatedEnvRecord: Record<string, string> = updatedEnvValues.reduce(
    (acc, { key, value }) => { acc[key] = value; return acc; },
    {} as Record<string, string>,
  );

  const newOutput = Object.keys(updatedEnvRecord).length > 0
    ? replaceEnvVariablesInRequest({ ...output, preRequestResult }, updatedEnvRecord)
    : { ...output, preRequestResult };

  return newOutput;
};

export const getRuntimeVariablesMap = async (editor: Doc, environment?: Record<string, string>) => {
  return getTable("runtime-variables", editor, environment);
};

export function replaceEnvVariables(text: string, environment?: Record<string, string>): string {
  if (!environment || Object.keys(environment).length === 0) return text;
  const regex = /\{\{(.+?)\}\}/g;
  return text.replace(regex, (match, variable) => {
    if (variable.startsWith("$faker.")) return match;
    return environment.hasOwnProperty(variable) ? environment[variable] : "null";
  });
}

export function applyPathParamsToUrl(url: string, pathParams: RequestParam[], environment?: Record<string, string>): string {
  return pathParams.reduce(
    (acc, param) => {
      if (param.enabled && param.key) {
        const key = replaceEnvVariables(param.key, environment);
        const value = replaceEnvVariables(param.value, environment);
        const regex = new RegExp(`\\{${key}\\}`, "g");
        return acc.replace(regex, encodeURIComponent(value));
      }
      return acc;
    },
    replaceEnvVariables(url, environment),
  );
}

export function injectPathParamsIntoRequest(request: Request, environment?: Record<string, string>): Request {
  const updatedUrl = applyPathParamsToUrl(request.url, request.path_params || [], environment);
  return { ...request, url: updatedUrl };
}

export async function getRequestWithPathParams(request: Request, environment?: Record<string, string>): Promise<Request> {
  return injectPathParamsIntoRequest(request, environment);
}

export function replaceEnvVariablesInRequest(data: Request, environment?: Record<string, string>): Request {
  const replaceInString = (text: string) => replaceEnvVariables(text, environment);
  const replaceInParams = (params: RequestParam[]) =>
    params.map((param) => ({ ...param, key: replaceInString(param.key), value: replaceInString(param.value) }));

  const replacedHeaders = replaceInParams(data.headers);
  const replacedParams = replaceInParams(data.params);
  const replacedPathParams = replaceInParams(data.path_params || []);
  const replacedBody = replaceInString(data.body);
  const replacedBodyParams = data.body_params.map((param) => ({
    ...param,
    value: typeof param.value === "string" ? replaceInString(param.value) : param.value,
  }));

  const replaceInAuthConfig = (authConfig: Record<string, string>, authType: string) => {
    switch (authType) {
      case "basic-auth": return { ...authConfig, username: replaceInString(authConfig.username), password: replaceInString(authConfig.password) };
      case "bearer-token": return { ...authConfig, token: replaceInString(authConfig.token) };
      case "oauth2": return {
        ...authConfig,
        accessToken: replaceInString(authConfig.accessToken),
        tokenType: authConfig.tokenType ? replaceInString(authConfig.tokenType) : authConfig.tokenType,
        headerPrefix: authConfig.headerPrefix,
        addTokenTo: authConfig.addTokenTo,
        refreshToken: authConfig.refreshToken ? replaceInString(authConfig.refreshToken) : authConfig.refreshToken,
        tokenUrl: authConfig.tokenUrl ? replaceInString(authConfig.tokenUrl) : authConfig.tokenUrl,
        clientId: authConfig.clientId ? replaceInString(authConfig.clientId) : authConfig.clientId,
        clientSecret: authConfig.clientSecret ? replaceInString(authConfig.clientSecret) : authConfig.clientSecret,
      };
      case "oauth1": return {
        ...authConfig,
        consumerKey: authConfig.consumerKey ? replaceInString(authConfig.consumerKey) : authConfig.consumerKey,
        consumerSecret: authConfig.consumerSecret ? replaceInString(authConfig.consumerSecret) : authConfig.consumerSecret,
        token: authConfig.token ? replaceInString(authConfig.token) : authConfig.token,
        tokenSecret: authConfig.tokenSecret ? replaceInString(authConfig.tokenSecret) : authConfig.tokenSecret,
      };
      case "oauth": return { ...authConfig, accessToken: replaceInString(authConfig.accessToken), tokenType: authConfig.tokenType ? replaceInString(authConfig.tokenType) : authConfig.tokenType };
      case "api-key": return { ...authConfig, key: replaceInString(authConfig.key), value: replaceInString(authConfig.value), in: authConfig.in };
      default: return authConfig;
    }
  };

  const replacedAuth = data.auth
    ? { ...data.auth, config: replaceInAuthConfig(data.auth.config, data.auth.type) }
    : undefined;

  return {
    ...data,
    url: replaceInString(data.url),
    headers: replacedHeaders,
    params: replacedParams,
    path_params: replacedPathParams,
    body: replacedBody,
    body_params: replacedBodyParams,
    auth: replacedAuth,
  };
}
