/**
 * Pipeline Executor
 *
 * Orchestrates the request execution pipeline through all stages.
 * This is the core of the request execution system.
 */

import { Editor } from '@tiptap/core';
import {
  PipelineStage,
  RestApiRequestState,
  RestApiResponseState,
  PipelineResult,
  PreProcessingContext,
  RequestCompilationContext,
  PreSendContext,
  PostProcessingContext,
} from './types';
import { hookRegistry } from './HookRegistry';
import type { Environment } from '../requestState';
import { parseJsonSafe, stringifyJsonSafe } from '../parseJsonSafe';

/**
 * Main pipeline executor class
 */
export class PipelineExecutor {
  private cancelled = false;
  private metadata: Record<string, any> = {};

  constructor(
    private editor: Editor,
    private environment?: Environment,
    private electron?: any,
  ) {}

  /**
   * Execute the full pipeline
   */
  public async execute(): Promise<PipelineResult> {
    const startTime = Date.now();
    const requestState = this.initializeRequestState();

    try {
      // 1. PRE-PROCESSING
      await this.runPreProcessing(requestState);
      if (this.cancelled) {
        return this.createCancelledResult(requestState);
      }

      // 2. REQUEST COMPILATION
      await this.runRequestCompilation(requestState);
      if (this.cancelled) {
        return this.createCancelledResult(requestState);
      }

      // 3. ENVIRONMENT REPLACEMENT (Platform only - no hooks)
      await this.runEnvReplacement(requestState);

      // 4. AUTH INJECTION (Platform only - no hooks)
      await this.runAuthInjection(requestState);

      // 5. PRE-SEND
      await this.runPreSend(requestState);
      if (this.cancelled) {
        return this.createCancelledResult(requestState);
      }

      // 6. SENDING
      const response = await this.runSending(requestState);

      // 7. RESPONSE EXTRACTION
      const responseState = await this.runResponseExtraction(response, requestState);
      responseState.timing.start = startTime;
      responseState.timing.end = Date.now();
      responseState.timing.duration = responseState.timing.end - responseState.timing.start;

      // 8. POST-PROCESSING
      await this.runPostProcessing(requestState, responseState);

      return {
        success: true,
        requestState,
        responseState,
      };
    } catch (error) {
      return {
        success: false,
        requestState,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Initialize empty request state
   */
  private initializeRequestState(): RestApiRequestState {
    return {
      method: 'GET',
      url: '',
      headers: [],
      queryParams: [],
      pathParams: [],
      metadata: {},
    };
  }

  /**
   * Stage 1: Pre-processing
   */
  private async runPreProcessing(requestState: RestApiRequestState): Promise<void> {
    const context: PreProcessingContext = {
      editor: this.editor,
      requestState,
      cancel: () => {
        this.cancelled = true;
      },
    };

    await hookRegistry.executeHooks(PipelineStage.PreProcessing, context);
  }

  /**
   * Stage 2: Request compilation
   */
  private async runRequestCompilation(requestState: RestApiRequestState): Promise<void> {

    // Helper functions for extensions to add data
    const addHeader = (key: string, value: string) => {
      requestState.headers.push({ key, value, enabled: true });
    };

    const addQueryParam = (key: string, value: string) => {
      requestState.queryParams.push({ key, value, enabled: true });
    };

    const context: RequestCompilationContext = {
      editor: this.editor,
      requestState,
      addHeader,
      addQueryParam,
    };

    // TODO: Walk through editor nodes and call populateRequest on each
    // This will be implemented when we refactor nodes to use the new system

    // Execute extension hooks
    await hookRegistry.executeHooks(PipelineStage.RequestCompilation, context);
  }

  /**
   * Stage 3: Environment replacement
   */
  private async runEnvReplacement(requestState: RestApiRequestState): Promise<void> {
    if (!this.environment) {
      return;
    }

    // Replace variables in URL
    requestState.url = this.replaceVariables(requestState.url, this.environment);

    // Replace variables in headers
    requestState.headers = requestState.headers.map(h => ({
      ...h,
      key: this.replaceVariables(h.key, this.environment!),
      value: this.replaceVariables(h.value, this.environment!),
    }));

    // Replace variables in query params
    requestState.queryParams = requestState.queryParams.map(p => ({
      ...p,
      key: this.replaceVariables(p.key, this.environment!),
      value: this.replaceVariables(p.value, this.environment!),
    }));

    // Replace variables in path params
    requestState.pathParams = requestState.pathParams.map(p => ({
      ...p,
      value: this.replaceVariables(p.value, this.environment!),
    }));

    // Replace variables in body
    if (requestState.body) {
      requestState.body = this.replaceVariables(requestState.body, this.environment);
    }
  }

  /**
   * Stage 4: Auth injection
   */
  private async runAuthInjection(requestState: RestApiRequestState): Promise<void> {
    // TODO: Load auth profile and inject headers
    // This will be implemented when we integrate with auth system
    if (requestState.authProfile) {
      // const auth = await this.authManager.getAuth(requestState.authProfile);
      // requestState.headers.push({
      //   key: 'Authorization',
      //   value: auth.token,
      //   enabled: true,
      // });
    }
  }

  /**
   * Stage 5: Pre-send
   */
  private async runPreSend(requestState: RestApiRequestState): Promise<void> {
    const context: PreSendContext = {
      requestState,
      metadata: this.metadata,
    };

    await hookRegistry.executeHooks(PipelineStage.PreSend, context);

    if (requestState?.metadata?.preScriptError) {
      throw new Error(String(requestState.metadata.preScriptError));
    }

    if (requestState?.metadata?.scriptCancelled) {
      this.cancelled = true;
    }
  }

  /**
   * Stage 6: Sending
   */
  private async runSending(requestState: RestApiRequestState): Promise<Response> {
    // Build final URL with query params
    const queryString = requestState.queryParams
      .filter(p => p.enabled !== false)
      .map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
      .join('&');

    let url = requestState.url;

    // Replace path params
    requestState.pathParams.forEach(p => {
      if (p.enabled !== false) {
        url = url.replace(`{${p.key}}`, encodeURIComponent(p.value));
      }
    });

    // Add query string
    if (queryString) {
      url += url.includes('?') ? `&${queryString}` : `?${queryString}`;
    }

    // Ensure URL has protocol
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `http://${url}`;
    }

    // Build headers object
    const headers: Record<string, string> = {};
    requestState.headers
      .filter(h => h.enabled !== false)
      .forEach(h => {
        headers[h.key] = h.value;
      });

    // Build fetch options
    const fetchOptions: RequestInit = {
      method: requestState.method,
      headers,
    };

    // Add body for non-GET requests
    if (requestState.method !== 'GET' && requestState.body) {
      fetchOptions.body = requestState.body;

      // Ensure Content-Type header
      if (requestState.contentType && !headers['Content-Type']) {
        headers['Content-Type'] = requestState.contentType;
      }
    }

    // TODO: Use electron for actual request
    // For now, use fetch directly
    const response = await fetch(url, fetchOptions);

    return response;
  }

  /**
   * Stage 7: Response extraction
   */
  private async runResponseExtraction(
    response: Response,
    requestState: RestApiRequestState,
  ): Promise<RestApiResponseState> {
    // Parse body
    const contentType = response.headers.get('content-type')?.toLowerCase() || null;
    let body: any;

    try {
      if (contentType?.includes('json')) {
        body = stringifyJsonSafe(parseJsonSafe(await response.text()), 2);
      } else if (contentType?.includes('text')) {
        body = await response.text();
      } else {
        // Binary content
        const buffer = await response.arrayBuffer();
        body = Buffer.from(buffer);
      }
    } catch (error) {
      body = await response.text();
    }

    // Extract headers
    const headers = Array.from(response.headers.entries()).map(([key, value]) => ({
      key,
      value,
    }));

    // Calculate size
    const bodyString = typeof body === 'string' ? body : stringifyJsonSafe(body);
    const bytesContent = new TextEncoder().encode(bodyString).length;

    const responseState: RestApiResponseState = {
      status: response.status,
      statusText: response.statusText,
      headers,
      contentType,
      body,
      timing: {
        start: 0, // Will be set by caller
        end: 0,
        duration: 0,
      },
      bytesContent,
      url: response.url,
      error: null,
    };

    return responseState;
  }

  /**
   * Stage 8: Post-processing
   */
  private async runPostProcessing(
    requestState: RestApiRequestState,
    responseState: RestApiResponseState,
  ): Promise<void> {
    const context: PostProcessingContext = {
      requestState,
      responseState,
      metadata: this.metadata,
    };

    await hookRegistry.executeHooks(PipelineStage.PostProcessing, context);
  }

  /**
   * Replace {{variables}} in text with environment values
   */
  private replaceVariables(text: string, environment: Environment): string {
    if (!text || !environment) {
      return text;
    }

    let result = text;

    // Create a map of variables for faster lookup
    const varMap = new Map<string, string>();
    environment.variables.forEach(v => {
      varMap.set(v.key, v.currentValue || v.value);
    });

    // Replace {{VAR_NAME}} patterns
    result = result.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
      const trimmedVarName = varName.trim();

      // Skip faker variables - they'll be processed by the faker extension at Stage 5
      if (trimmedVarName.startsWith('$faker.')) {
        return match;
      }

      const value = varMap.get(trimmedVarName);
      return value !== undefined ? value : match;
    });

    return result;
  }

  /**
   * Create a cancelled result
   */
  private createCancelledResult(requestState: RestApiRequestState): PipelineResult {
    return {
      success: false,
      requestState,
      cancelled: true,
    };
  }
}
