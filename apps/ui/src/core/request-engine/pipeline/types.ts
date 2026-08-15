/**
 * Request Execution Pipeline Types
 *
 * Defines the stages, hooks, and state types for the request execution pipeline.
 */

import { Editor } from '@tiptap/core';
import { Request } from '@/core/types';

// ============================================================================
// Pipeline Stages
// ============================================================================

/**
 * Stages in the request execution pipeline.
 * Extensions can hook into these stages to customize behavior.
 */
export enum PipelineStage {
  /**
   * Pre-processing: Validate, transform before compilation
   * Extensions can: Validate editor state, cancel request, transform data
   */
  PreProcessing = 'pre-processing',

  /**
   * Request compilation: Collect data from editor nodes
   * Platform: Walks nodes and calls populateRequest on each
   * Extensions can: Add additional data to request state
   */
  RequestCompilation = 'request-compilation',

  /**
   * Environment variable replacement: Replace {{variables}}
   * Platform only: Extensions don't hook here (security)
   */
  EnvReplacement = 'env-replacement',

  /**
   * Auth injection: Add authentication headers
   * Platform only: Extensions don't hook here (security)
   */
  AuthInjection = 'auth-injection',

  /**
   * Pre-send: Last chance for modifications before sending
   * Extensions can: Add logging, modify request state
   */
  PreSend = 'pre-send',

  /**
   * Sending: Actual HTTP request execution
   * Platform only: Extensions observe but don't modify
   */
  Sending = 'sending',

  /**
   * Response extraction: Parse and structure response
   * Platform: Parses body, extracts headers
   * Extensions can observe but don't modify
   */
  ResponseExtraction = 'response-extraction',

  /**
   * Post-processing: After response received
   * Extensions can: Cache response, log, validate, trigger actions
   */
  PostProcessing = 'post-processing',
}

// ============================================================================
// State Objects
// ============================================================================

/**
 * Request state for REST API requests.
 * Extensions populate this during compilation.
 */
export interface RestApiRequestState {
  // HTTP basics
  method: string;
  url: string;

  // Headers
  headers: Array<{
    key: string;
    value: string;
    enabled?: boolean;
  }>;

  // Query parameters
  queryParams: Array<{
    key: string;
    value: string;
    enabled?: boolean;
  }>;

  // Path parameters (for URL templates like /users/{id})
  pathParams: Array<{
    key: string;
    value: string;
    enabled?: boolean;
  }>;

  // Body
  body?: string;
  contentType?: string;

  // Binary/multipart
  bodyParams?: Array<{
    key: string;
    value: string | File;
    type?: string;
    enabled?: boolean;
  }>;
  binary?: File | string | string[]; // File object or file path string(s)

  // Raw auth templates are resolved/injected only by the secure executor.
  auth?: Request['auth'];

  // Auth profile reference (not the actual credentials)
  authProfile?: string;

  // Pre-request script result (if any)
  preRequestResult?: any;

  // Metadata
  metadata?: {
    [key: string]: any;
  };
}

/**
 * Response state for REST API responses.
 * Platform populates this after receiving response.
 */
export interface RestApiResponseState {
  // HTTP response
  status: number;
  protocol?: string;
  operationType?: string; // GraphQL operation type (query/mutation/subscription)
  statusText: string;

  // Headers
  headers: Array<{
    key: string;
    value: string;
  }>;

  // Content
  contentType: string | null;
  body: any; // Parsed body (JSON object, string, Buffer, etc.)

  // Timing
  timing: {
    start: number;
    end: number;
    duration: number;
  };

  // Size
  bytesContent: number;

  // URL (may differ from request URL due to redirects)
  url: string;

  // Error (if request failed)
  error: string | null;

  // Test results (if tests were run)
  testRunnerResult?: any;

  // Request metadata (method, headers sent, proxy info, etc.)
  requestMeta?: {
    method: string;
    url: string;
    headers: { key: string; value: string }[];
    httpVersion?: string;
    proxy?: {
      name: string;
      host: string;
      port: number;
    };
  };

  // Metadata
  metadata?: {
    [key: string]: any;
  };
}

// ============================================================================
// Hook System
// ============================================================================

/**
 * Context passed to pre-processing hooks
 */
export interface PreProcessingContext {
  editor: Editor;
  requestState: RestApiRequestState;
  cancel: () => void;
}

/**
 * Context passed to request compilation hooks
 */
export interface RequestCompilationContext {
  editor: Editor;
  requestState: RestApiRequestState;
  addHeader: (key: string, value: string) => void;
  addQueryParam: (key: string, value: string) => void;
}

/**
 * Context passed to pre-send hooks
 */
export interface PreSendContext {
  requestState: RestApiRequestState;
  metadata: Record<string, any>;
}

/**
 * Context passed to post-processing hooks
 */
export interface PostProcessingContext {
  requestState: RestApiRequestState;
  responseState: RestApiResponseState;
  metadata: Record<string, any>;
}

/**
 * Hook handler function signature for each stage
 */
export type HookHandler<T = any> = (context: T) => Promise<void> | void;

/**
 * Hook registration
 */
export interface Hook {
  extensionId: string;
  stage: PipelineStage;
  handler: HookHandler;
  priority?: number; // Lower numbers run first
}

// ============================================================================
// Pipeline Result
// ============================================================================

/**
 * Result returned from pipeline execution
 */
export interface PipelineResult {
  success: boolean;
  requestState: RestApiRequestState;
  responseState?: RestApiResponseState;
  error?: Error;
  cancelled?: boolean;
}

// ============================================================================
// Node Population Interface
// ============================================================================

/**
 * Interface that nodes can implement to populate request state
 */
export interface RequestPopulator {
  /**
   * Called during request compilation to populate the request state
   * @param node The node's JSON content
   * @param requestState The current request state to populate
   */
  populateRequest(node: any, requestState: RestApiRequestState): void | Promise<void>;

  /**
   * Called after response received to allow node to consume response
   * @param node The node's JSON content
   * @param responseState The response state
   */
  consumeResponse?(node: any, responseState: RestApiResponseState): void | Promise<void>;
}

// ============================================================================
// GraphQL Types
// ============================================================================

/**
 * Request state for GraphQL requests.
 */
export interface GraphQLRequestState {
  // GraphQL endpoint
  url: string;

  // Query, mutation, or subscription
  query: string;
  operationType: 'query' | 'mutation' | 'subscription';
  operationName?: string;

  // Variables (JSON)
  variables?: Record<string, any>;

  // Headers
  headers: Array<{
    key: string;
    value: string;
    enabled?: boolean;
  }>;

  // Auth profile reference
  authProfile?: string;

  // Metadata
  metadata?: {
    [key: string]: any;
  };
}

/**
 * Response state for GraphQL responses.
 */
export interface GraphQLResponseState {
  // HTTP response
  status: number;
  statusText: string;

  // Headers
  headers: Array<{
    key: string;
    value: string;
  }>;

  // GraphQL response structure
  data?: any;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: Array<string | number>;
    extensions?: any;
  }>;
  extensions?: any;

  // Raw body
  body: any;

  // Timing
  timing: {
    start: number;
    end: number;
    duration: number;
  };

  // Size
  bytesContent: number;

  // URL
  url: string;

  // Error (if request failed)
  error: string | null;

  // Request metadata
  requestMeta?: {
    query: string;
    variables?: Record<string, any>;
    headers: { key: string; value: string }[];
    operationType: string;
  };

  // Metadata
  metadata?: {
    [key: string]: any;
  };
}

// ============================================================================
// Legacy Types (for backward compatibility)
// ============================================================================

/**
 * Legacy Request type - will be gradually migrated to RestApiRequestState
 */
export type LegacyRequest = Request;
