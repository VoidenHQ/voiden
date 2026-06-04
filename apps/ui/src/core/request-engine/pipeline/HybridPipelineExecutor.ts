/**
 * Hybrid Pipeline Executor
 *
 * Splits pipeline execution between UI and Electron for security:
 * - UI: Stages 1, 2, 5, 8 (pre-processing, compilation, pre-send, post-processing)
 * - Electron: Stages 3, 4, 6, 7 (env replacement, auth, sending, response extraction)
 *
 * This ensures environment variables and auth tokens never enter the UI process.
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
import { parseJsonSafe, stringifyJsonSafe } from '../parseJsonSafe';

/**
 * Hybrid pipeline executor that splits execution between UI and Electron
 */
export class HybridPipelineExecutor {
  private cancelled = false;
  private metadata: Record<string, any> = {};

  constructor(
    private editor: Editor,
    private electron?: any,
  ) {}

  /**
   * Execute the hybrid pipeline
   */
  public async execute(): Promise<PipelineResult> {
    const startTime = Date.now();
    const requestState = this.initializeRequestState();

    try {
      // ========================================
      // UI PROCESS - Stage 1: Pre-processing
      // ========================================
      await this.runPreProcessing(requestState);
      if (this.cancelled) {
        return this.createCancelledResult(requestState);
      }

      // ========================================
      // UI PROCESS - Stage 2: Request compilation
      // ========================================
      await this.runRequestCompilation(requestState);
      if (this.cancelled) {
        return this.createCancelledResult(requestState);
      }

      // ========================================
      // UI PROCESS - Stage 5: Pre-send
      // ========================================
      await this.runPreSend(requestState);
      if (this.cancelled) {
        return this.createCancelledResult(requestState);
      }

      // ========================================
      // ELECTRON PROCESS - Stages 3, 4, 6, 7
      // ========================================

      const electronResponse = await this.executeInElectron(requestState);

      // Check if Electron execution failed
      if (!electronResponse || (!electronResponse.status && electronResponse.statusText)) {
        return {
          success: false,
          requestState,
          error: new Error(electronResponse?.error || electronResponse?.statusText || 'Request failed'),
        };
      }

      // Convert Electron response to RestApiResponseState
      const responseState = this.convertElectronResponse(electronResponse, startTime);

      // ========================================
      // UI PROCESS - Stage 8: Post-processing
      // ========================================
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
   * Stage 1: Pre-processing (UI)
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
   * Stage 2: Request compilation (UI)
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
    // For now, extensions can populate via hooks

    // Execute extension hooks
    await hookRegistry.executeHooks(PipelineStage.RequestCompilation, context);
  }

  /**
   * Stage 5: Pre-send (UI)
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
   * Stages 3, 4, 6, 7: Execute in Electron (secure)
   *
   * This sends the raw request with {{variables}} to Electron where:
   * - Stage 3: Variables are replaced securely
   * - Stage 4: Auth is injected securely
   * - Stage 6: HTTP request is sent
   * - Stage 7: Response is extracted
   */
  private async executeInElectron(requestState: RestApiRequestState): Promise<any> {
    if (!this.electron || !window.electron?.request?.sendSecure) {
      throw new Error('Electron secure request API not available');
    }

    // Send to Electron for secure processing
    // Electron will handle stages 3, 4, 6, 7 internally
    const response = await window.electron.request.sendSecure(requestState);

    return response;
  }

  /**
   * Convert Electron response to RestApiResponseState
   */
  private convertElectronResponse(electronResponse: any, startTime: number): RestApiResponseState {
    const endTime = Date.now();

    // Convert headers array to our format
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
      const contentType = headers.find(h => h.key.toLowerCase() === 'content-type')?.value || '';

      if (contentType.includes('json')) {
        try {
          body = stringifyJsonSafe(parseJsonSafe(buffer.toString()), 2);
        } catch {
          body = buffer.toString();
        }
      } else if (contentType.includes('text/')) {
        body = buffer.toString();
      } else {
        body = buffer;
      }
    }

    // Calculate size
    const bodyString = typeof body === 'string' ? body : stringifyJsonSafe(body);
    const bytesContent = new TextEncoder().encode(bodyString).length;

    return {
      status: electronResponse.status,
      statusText: electronResponse.statusText,
      headers,
      contentType: headers.find(h => h.key.toLowerCase() === 'content-type')?.value || null,
      body,
      timing: {
        start: startTime,
        end: endTime,
        duration: endTime - startTime,
      },
      bytesContent,
      url: electronResponse.requestMeta?.url || '',
      error: electronResponse.error || null,
    };
  }

  /**
   * Stage 8: Post-processing (UI)
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
