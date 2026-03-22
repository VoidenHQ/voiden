/**
 * Hybrid Request Sending
 *
 * Phase 3 implementation that uses hybrid pipeline architecture.
 * This is a simplified version that works with existing Request objects
 * until we fully integrate the pipeline with editor node compilation.
 */

import { Editor, JSONContent } from "@tiptap/core";
import { Request, BaseResponse } from "@/core/types";
import { RestApiRequestState, RestApiResponseState } from "./pipeline/types";
import { hookRegistry, PipelineStage } from "./pipeline";
import { Buffer } from "buffer";
import { preSendProcessHook, replaceProcessVariablesInText, saveRuntimeVariables } from "./runtimeVariables";
import { get } from "http";
import { getRuntimeVariablesMap } from "./getRequestFromJson";
import { expandLinkedBlocksInDoc } from "../editors/voiden/utils/expandLinkedBlocks";


/**
 * Get headers with auth merged
 */
async function getHeaders(headers: any[], auth?: any): Promise<Record<string, string>> {
  const authHeaders: Record<string, string> = {};

  if (auth && auth.enabled && auth.config) {
    switch (auth.type) {
      case "basic-auth": {
        let username = auth.config.username;
        let password = auth.config.password;
         try {
          username = await window.electron?.env?.replaceVariables(username);
        } catch (e) { console.warn("[auth] Failed to resolve env variables in username:", e); }
        try{
          username = await replaceProcessVariablesInText(username);
        } catch (e) { console.warn("[auth] Failed to resolve process variables in username:", e); }
        try {
          password = await window.electron?.env?.replaceVariables(password);
        } catch (e) { console.warn("[auth] Failed to resolve env variables in password:", e); }
        try{
          password = await replaceProcessVariablesInText(password);
        } catch (e) { console.warn("[auth] Failed to resolve process variables in password:", e); }
        const base64Credentials = Buffer.from(`${username}:${password}`).toString("base64");
        authHeaders["Authorization"] = `Basic ${base64Credentials}`;
        break;
      }
      case "bearer-token": {
        const token = auth.config.token;
        authHeaders["Authorization"] = `Bearer ${token}`;
        break;
      }
      case "oauth2": {
        let headerPrefix = auth.config.headerPrefix || auth.config.tokenType || "Bearer";
        let accessToken = auth.config.accessToken;
        // Resolve env and process variables in token values
        try { accessToken = await window.electron?.env?.replaceVariables(accessToken); } catch (e) { console.warn("[auth] Failed to resolve env variables in accessToken:", e); }
        try { accessToken = await replaceProcessVariablesInText(accessToken); } catch (e) { console.warn("[auth] Failed to resolve process variables in accessToken:", e); }
        try { headerPrefix = await window.electron?.env?.replaceVariables(headerPrefix); } catch (e) { console.warn("[auth] Failed to resolve env variables in headerPrefix:", e); }
        try { headerPrefix = await replaceProcessVariablesInText(headerPrefix); } catch (e) { console.warn("[auth] Failed to resolve process variables in headerPrefix:", e); }
        // addTokenTo defaults to "header"; query param handled in getParameters
        if (auth.config.addTokenTo !== "query") {
          authHeaders["Authorization"] = `${headerPrefix} ${accessToken}`;
        }
        break;
      }
      case "oauth1": {
        // OAuth 1.0 requires signature generation
        // For now, provide basic support with the token
        // TODO: Implement full OAuth 1.0 signature generation (HMAC-SHA1)
        const parts = [];
        if (auth.config.consumerKey) parts.push(`oauth_consumer_key="${auth.config.consumerKey}"`);
        if (auth.config.token) parts.push(`oauth_token="${auth.config.token}"`);
        parts.push('oauth_signature_method="PLAINTEXT"');
        let signature = `${auth.config.consumerSecret || ""}&${auth.config.tokenSecret || ""}`;
        try {
          signature = await window.electron?.env?.replaceVariables(signature);
        } catch (e) { console.warn("[auth] Failed to resolve env variables in oauth1 signature:", e); }
          try {
          signature = await replaceProcessVariablesInText(signature);
        } catch (e) { console.warn("[auth] Failed to resolve process variables in oauth1 signature:", e); }
        parts.push(`oauth_signature="${encodeURIComponent(signature)}"`);
        parts.push(`oauth_timestamp="${Math.floor(Date.now() / 1000)}"`);
        parts.push(`oauth_nonce="${Math.random().toString(36).substring(2)}"`);
        parts.push('oauth_version="1.0"');

        authHeaders["Authorization"] = `OAuth ${parts.join(", ")}`;
        break;
      }
      case "api-key": {
        const key = auth.config.key;
        const value = auth.config.value;
        if (auth.config.in === "header") {
          authHeaders[key] = value;
        }
        break;
      }
      default:
        break;
    }
  }

  const finalHeaders: Record<string, string> = headers
    .filter((header) => header.enabled)
    .reduce((acc: Record<string, string>, header) => {
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
}

/**
 * Get query parameters with auth merged
 */
function getParameters(parameters: any[], auth?: any): string {
  let authQuery = "";
  if (auth && auth.config && auth.enabled) {
    if (auth.type === "api-key" && auth.config.in === "query") {
      authQuery = `${auth.config.key}=${auth.config.value}`;
    } else if (auth.type === "oauth2" && auth.config.addTokenTo === "query" && auth.config.accessToken) {
      authQuery = `access_token=${encodeURIComponent(auth.config.accessToken)}`;
    }
  }

  const filteredParameters = parameters.filter((parameter) => parameter.enabled && (parameter.key || parameter.value));

  const queryString = filteredParameters
    .map((obj) => {
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
}

/**
 * Convert Request object to RestApiRequestState
 * Merges auth into headers/queryParams
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

  // Parse query params
  const queryParamsArray = data.params
    .filter((p) => p.enabled)
    .map((p) => ({
      key: p.key,
      value: p.value,
      enabled: p.enabled,
    }));

  // Add auth query params if present
  if (data.auth && data.auth.enabled && data.auth.config) {
    if (data.auth.type === 'api-key' && data.auth.config.in === 'query' && data.auth.config.key) {
      queryParamsArray.push({
        key: data.auth.config.key,
        value: data.auth.config.value || '',
        enabled: true,
      });
    } else if (data.auth.type === 'oauth2' && data.auth.config.addTokenTo === 'query' && data.auth.config.accessToken) {
      queryParamsArray.push({
        key: 'access_token',
        value: data.auth.config.accessToken,
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
    metadata: {
      ...(data.options?.follow_redirects === 'false' ? { follow_redirects: false } : {}),
    },
  };

  return result;
}

/**
 * Build BaseResponse from RestApiResponseState
 */
function buildBaseResponseFromPipeline(
  responseState: RestApiResponseState,
  preRequestResult?: any
): BaseResponse {
  // Keep headers as array format (ResponsePanel expects this)
  const headersArray = responseState.headers.map(h => ({ key: h.key, value: h.value }));

  return {
    statusCode: responseState.status,
    statusMessage: responseState.statusText,
    headers: headersArray,
    protocol: responseState.protocol,  // Array format: [{ key, value }, ...]
    operationType: responseState.operationType, // GraphQL operation type
    contentType: responseState.contentType,
    body: responseState.body,
    url: responseState.url,
    elapsedTime: responseState.timing.duration,
    error: responseState.error,
    bytesContent: responseState.bytesContent,
    testRunnerResult: responseState.testRunnerResult,
    prerequestResult: preRequestResult,
    requestMeta: responseState.requestMeta,
    metadata: responseState.metadata,  // Include metadata from pipeline hooks
  };
}

/**
 * Execute request using hybrid pipeline architecture
 *
 * Pipeline stages:
 * - UI: Pre-processing (Stage 1)
 * - UI: Request compilation (Stage 2) - currently skipped, using pre-built request
 * - UI: Pre-send (Stage 5)
 * - Electron: Env replacement (Stage 3)
 * - Electron: Auth injection (Stage 4)
 * - Electron: Sending (Stage 6)
 * - Electron: Response extraction (Stage 7)
 * - UI: Post-processing (Stage 8)
 */
export async function sendRequestHybrid(
  request: any,
  editor: Editor,
  signal?: AbortSignal,
  electron?: any
): Promise<BaseResponse | undefined> {
  if (!electron || !window.electron?.request?.sendSecure) {
    throw new Error("Hybrid pipeline requires Electron secure request API");
  }

  const startTime = performance.now();
  const metadata: Record<string, any> = {};

  try {
    let requestState = request;
    console.log('[sendRequestHybrid] input method:', request.method, 'protocolType:', request.protocolType);
    // Convert Request to RestApiRequestState
    if (request.protocolType === 'rest') {
      requestState =await  convertToRestApiRequestState(request);
      console.log('[sendRequestHybrid] after convert method:', requestState.method);
    }

    const url = requestState.url.toLowerCase();
    const isWebSocket = url.startsWith('ws://') || url.startsWith('wss://');
    const isGrpc = url.startsWith('grpc://') || url.startsWith('grpcs://');
    const isGraphQLSubscription = request.protocolType === 'graphql' && request.operationType === 'subscription';
    const isSpecialProtocol = isWebSocket || isGrpc || isGraphQLSubscription;

    // ========================================
    // UI PROCESS - Stage 1: Pre-processing
    // ========================================
    let preProcessingCancelled = false;
    await hookRegistry.executeHooks(PipelineStage.PreProcessing, {
      editor,
      requestState,
      cancel: () => {
        preProcessingCancelled = true;
      },
    });

    if (preProcessingCancelled) {
      throw new Error("Request cancelled during pre-processing");
    }

    // ========================================
    // UI PROCESS - Stage 2: Request compilation

    // ========================================
    // Note: In future, this stage will compile from editor nodes
    // For now, we're using the Request object from getRequest()

    await hookRegistry.executeHooks(PipelineStage.RequestCompilation, {
      editor,
      requestState,
      auth: request.auth,
      addHeader: (key: string, value: string) => {
        requestState.headers.push({ key, value, enabled: true });
      },
      addQueryParam: (key: string, value: string) => {
        requestState.queryParams.push({ key, value, enabled: true });
      },
    });

    requestState = await preSendProcessHook(requestState);
    // ========================================
    // UI PROCESS - Stage 5: Pre-send
    // ========================================
    await hookRegistry.executeHooks(PipelineStage.PreSend, {
      requestState,
      metadata,
    });

    if (requestState?.metadata?.scriptCancelled) {
      const reason = requestState?.metadata?.preScriptError;
      throw new Error(reason ? `Request cancelled by pre-request script: ${reason}` : "Request cancelled by pre-request script");
    }

    // ========================================
    // ELECTRON PROCESS - Stages 3, 4, 6, 7
    // ========================================

    // Debug: log method before sending to Electron
    console.log('[sendRequestHybrid] method before Electron:', requestState.method, 'url:', requestState.url);

    // Send to Electron for secure processing
    const electronResponse = await window.electron.request.sendSecure(
      requestState,
      signal ? { aborted: signal.aborted } : undefined
    );

    // Check if request failed
    if (!electronResponse.status && electronResponse.statusText) {
      // console.error("[HybridPipeline] Request failed:", electronResponse.statusText);
      const errorResponse: BaseResponse = {
        statusCode: 0,
        protocol:electronResponse.protocol,
        operationType: electronResponse.operationType, // Include operationType for GraphQL
        statusMessage: electronResponse.statusText,
        headers: [],  // Empty array, not empty object
        contentType: null,
        body: null,
        url: "",
        elapsedTime: performance.now() - startTime,
        error: electronResponse.error || electronResponse.statusText,
        bytesContent: 0,
        prerequestResult: request.preRequestResult,
        requestMeta: electronResponse.requestMeta,
      };
      return errorResponse;
    }

    // Convert Electron response to RestApiResponseState
    const headers: Array<{ key: string; value: string }> = [];
    if (electronResponse.headers) {
      electronResponse.headers.forEach(([key, value]: [string, string]) => {
        headers.push({ key, value });
      });
    }

    // Parse body from Buffer
    let body = null;
    if (electronResponse.body) {
      const buffer = Buffer.from(electronResponse.body);
      const contentType = headers.find((h) => h.key.toLowerCase() === "content-type")?.value || "";

      if (contentType.includes("json")) {
        try {
          body = JSON.parse(buffer.toString());
        } catch {
          body = buffer.toString();
        }
      } else if (contentType.includes("text/")) {
        body = buffer.toString();
      } else {
        body = buffer;
      }
    }

    // Calculate size
    const bodyString = typeof body === "string" ? body : JSON.stringify(body);
    const bytesContent = new TextEncoder().encode(bodyString).length;

    const endTime = performance.now();
    if (isSpecialProtocol) {
      // For WebSocket/gRPC, return electron response directly without RestApi conversion
      const endTime = performance.now();

      // Create a minimal BaseResponse with electron response data
      const baseResponse: BaseResponse = electronResponse

      // Build a responseState so post-processing hooks receive both requestState and responseState
      const responseState: RestApiResponseState = {
        status: baseResponse.statusCode,
        statusText: baseResponse.statusMessage,
        headers: baseResponse.headers,
        contentType: baseResponse.contentType,
        body: baseResponse.body,
        timing: {
          start: startTime,
          end: endTime,
          duration: baseResponse.elapsedTime,
        },
        bytesContent: baseResponse.bytesContent,
        url: baseResponse.url,
        error: baseResponse.error,
        requestMeta: baseResponse.requestMeta,
      };

      // Run post-processing hooks with the same context shape as REST
      await hookRegistry.executeHooks(PipelineStage.PostProcessing, {
        requestState,
        responseState,
        metadata,
      });

      // Still save runtime variables for WebSocket/gRPC
      const state= await window.electron?.state.get();
      const path = state.activeDirectory||'';
      let editorJson:JSONContent|undefined  = editor?.getJSON();
      editorJson = await expandLinkedBlocksInDoc(editorJson, { forceRefresh: true });
      const captureArray = await getRuntimeVariablesMap(editorJson,undefined);
      if(captureArray||[].length>0){
        await saveRuntimeVariables(requestState, {
          status: baseResponse.statusCode,
          statusText: baseResponse.statusMessage,
          headers: baseResponse.headers,
          contentType: baseResponse.contentType,
          body: baseResponse.body,
          timing: {
            start: startTime,
            end: endTime,
            duration: baseResponse.elapsedTime,
          },
          bytesContent: baseResponse.bytesContent,
          url: baseResponse.url,
          error: baseResponse.error,
          requestMeta: baseResponse.requestMeta,
        }, captureArray ,path);
      }

      return baseResponse;
    }
    const responseState: RestApiResponseState = {
      status: electronResponse.status,
      statusText: electronResponse.statusText,
      headers,
      protocol: electronResponse.protocol,
      operationType: electronResponse.operationType, // Include operationType for GraphQL
      contentType: headers.find((h) => h.key.toLowerCase() === "content-type")?.value || null,
      body,
      timing: {
        start: startTime,
        end: endTime,
        duration: endTime - startTime,
      },
      bytesContent,
      url: electronResponse.requestMeta?.url || requestState.url,
      error: electronResponse.error || null,
      requestMeta: electronResponse.requestMeta,
    };

    // ========================================
    // UI PROCESS - Stage 8: Post-processing
    // ========================================
    await hookRegistry.executeHooks(PipelineStage.PostProcessing, {
      requestState,
      responseState,
      metadata,
    });
    const state = await window.electron?.state.get();
    const path = state.activeDirectory || '';
    let editorJson: JSONContent | undefined = editor?.getJSON();
    editorJson = await expandLinkedBlocksInDoc(editorJson, { forceRefresh: true });
    const captureArray = await getRuntimeVariablesMap(editorJson, undefined);
    if (captureArray || [].length > 0) {
      await saveRuntimeVariables(requestState, responseState, captureArray, path);
    }

    // Build final response
    return buildBaseResponseFromPipeline(responseState, request.preRequestResult);
  } catch (error) {
    const errorResponse: BaseResponse = {
      statusCode: 0,
      statusMessage: "",
      headers: [],  // Empty array, not empty object
      contentType: null,
      body: null,
      url: "",
      elapsedTime: performance.now() - startTime,
      error: error.message,
      bytesContent: 0,
      protocol:request.protocolType,
      operationType: request.operationType, // Include operationType for GraphQL
      prerequestResult: request.preRequestResult,
      requestMeta: {
        method: request.method,
        url: request.url,
        headers: request.headers.filter(h => h.enabled).map(h => ({ key: h.key, value: h.value })),
      },
    };
    return errorResponse;
  }
}
