/**
 * GraphQL Response Converter
 *
 * Converts GraphQL HTTP response objects to Voiden document JSON with response nodes.
 * Uses the same response-doc/response-body/response-headers node types (registered by REST API plugin)
 * but the GraphQL plugin owns its own conversion logic.
 */

export interface GraphQLHttpResponse {
  statusCode: number;
  statusMessage?: string;
  headers?: Array<{ key: string; value: string }> | Record<string, string>;
  body?: any;
  contentType?: string;
  elapsedTime?: number;
  url?: string;
  requestMeta?: {
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
    body?: string | null;
    bodyContentType?: string | null;
  };
  metadata?: {
    assertionResults?: {
      results: any[];
      totalAssertions: number;
      passedAssertions: number;
      failedAssertions: number;
    };
    scriptAssertionResults?: {
      results: Array<{ passed: boolean; message: string; condition?: string; actualValue?: any; operator?: string; expectedValue?: any; reason?: string }>;
      totalAssertions: number;
      passedAssertions: number;
      failedAssertions: number;
    };
    preScriptAssertions?: {
      results: Array<{ passed: boolean; message: string; condition?: string; actualValue?: any; operator?: string; expectedValue?: any; reason?: string }>;
      totalAssertions: number;
      passedAssertions: number;
      failedAssertions: number;
    };
    scriptAssertions?: {
      results: Array<{ passed: boolean; message: string; condition?: string; actualValue?: any; operator?: string; expectedValue?: any; reason?: string }>;
      totalAssertions: number;
      passedAssertions: number;
      failedAssertions: number;
    };
    openAPIValidation?: {
      passed: boolean;
      errors: Array<{
        type: string;
        message: string;
        path?: string;
        expected?: any;
        actual?: any;
      }>;
      warnings: Array<{
        type: string;
        message: string;
        path?: string;
      }>;
      validatedAgainst: {
        path: string;
        method: string;
        operationId?: string;
      };
    };
  };
}

/**
 * Convert GraphQL response to Voiden document JSON
 */
export function convertGraphQLResponseToVoidenDoc(response: GraphQLHttpResponse): any {
  // Normalize headers to array format
  let headersArray: Array<{ key: string; value: string }> = [];

  if (response.headers) {
    if (Array.isArray(response.headers)) {
      headersArray = response.headers;
    } else {
      headersArray = Object.entries(response.headers).map(([key, value]) => ({
        key,
        value: String(value),
      }));
    }
  }

  // Extract content type from headers if not provided
  let contentType = response.contentType;
  if (!contentType && headersArray.length > 0) {
    const contentTypeHeader = headersArray.find(
      h => h.key.toLowerCase() === 'content-type'
    );
    contentType = contentTypeHeader?.value || undefined;
  }

  // Build the response document content
  const responseDocContent: any[] = [
    {
      type: 'response-body',
      attrs: {
        body: response.body || null,
        contentType: contentType || null,
        downloadFilename: null,
      },
    },
  ];

  // Add assertion results if present
  if (response.metadata?.assertionResults) {
    responseDocContent.push({
      type: 'assertion-results',
      attrs: {
        results: response.metadata.assertionResults.results,
        totalAssertions: response.metadata.assertionResults.totalAssertions,
        passedAssertions: response.metadata.assertionResults.passedAssertions,
        failedAssertions: response.metadata.assertionResults.failedAssertions,
      },
    });
  }

  // Add OpenAPI validation results if present
  if (response.metadata?.openAPIValidation) {
    responseDocContent.push({
      type: 'openapi-validation-results',
      attrs: {
        passed: response.metadata.openAPIValidation.passed,
        errors: response.metadata.openAPIValidation.errors,
        warnings: response.metadata.openAPIValidation.warnings,
        validatedAgainst: response.metadata.openAPIValidation.validatedAgainst,
        totalErrors: response.metadata.openAPIValidation.errors.length,
        totalWarnings: response.metadata.openAPIValidation.warnings.length,
      },
    });
  }

  // Add script assertion results if present
  const scriptAssertions =
    response.metadata?.scriptAssertionResults ||
    response.metadata?.preScriptAssertions ||
    response.metadata?.scriptAssertions;

  if (scriptAssertions) {
    responseDocContent.push({
      type: 'script-assertion-results',
      attrs: {
        results: scriptAssertions.results || [],
        totalAssertions: scriptAssertions.totalAssertions ?? (scriptAssertions.results?.length || 0),
        passedAssertions: scriptAssertions.passedAssertions ?? (scriptAssertions.results || []).filter((r: any) => r?.passed).length,
        failedAssertions: scriptAssertions.failedAssertions ?? (scriptAssertions.results || []).filter((r: any) => !r?.passed).length,
      },
    });
  }

  // Add response headers and request info
  responseDocContent.push(
    {
      type: 'response-headers',
      attrs: {
        headers: headersArray,
      },
    },
    {
      type: 'request-headers',
      attrs: {
        headers: response.requestMeta?.headers || [],
        url: response.requestMeta?.url || response.url || '',
        method: response.requestMeta?.method || 'POST',
        httpVersion: response.requestMeta?.httpVersion,
        tls: response.requestMeta?.tlsInfo,
        requestBody: response.requestMeta?.body || null,
        requestBodyContentType: response.requestMeta?.bodyContentType || null,
      },
    }
  );

  const responseDocNode = {
    type: 'response-doc',
    attrs: {
      openNodes: [
        'response-body',
        'response-headers',
        'request-headers',
        'request-headers-security',
        'request-body-sent',
        'assertion-results',
        'openapi-validation-results',
        'script-assertion-results',
      ],
      activeNode: 'response-body',
      statusCode: response.statusCode,
      statusMessage: response.statusMessage || getDefaultStatusMessage(response.statusCode),
      elapsedTime: response.elapsedTime || 0,
      url: response.url || null,
    },
    content: responseDocContent,
  };

  return {
    type: 'doc',
    attrs: {
      statusCode: response.statusCode,
      statusMessage: response.statusMessage || getDefaultStatusMessage(response.statusCode),
      elapsedTime: response.elapsedTime || 0,
      url: response.url || null,
      requestMeta: response.requestMeta || null,
    },
    content: [responseDocNode],
  };
}

/**
 * Get default status message for HTTP status codes
 */
function getDefaultStatusMessage(statusCode: number): string {
  const statusMessages: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    202: 'Accepted',
    204: 'No Content',
    301: 'Moved Permanently',
    302: 'Found',
    304: 'Not Modified',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    408: 'Request Timeout',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
  };

  return statusMessages[statusCode] || 'Unknown';
}
