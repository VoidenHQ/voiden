/**
 * Response Converter
 *
 * Converts HTTP response objects to Voiden document JSON with response nodes
 */

export interface HttpResponse {
  statusCode: number;
  statusMessage?: string;
  headers?: Array<{ key: string; value: string }> | Record<string, string>;
  body?: any;
  contentType?: string;
  elapsedTime?: number;
  url?: string;
  wsId?:string;
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
 * Convert HTTP response to Voiden document JSON
 *
 * Creates a document with response-status, response-headers, and response-body nodes
 */
export function convertResponseToVoidenDoc(response: HttpResponse): any {
  // Normalize headers to array format
  let headersArray: Array<{ key: string; value: string }> = [];

  if (response.headers) {
    if (Array.isArray(response.headers)) {
      headersArray = response.headers;
    } else {
      // Convert object to array
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

  // Build the Voiden document structure
  // Store metadata in doc attrs for ResponsePanelContainer to access
  const responseDocContent: any[] = [
    // Response Body Node (shown first, before headers)
    {
      type: 'response-body',
      attrs: {
        body: response.body || null,
        contentType: contentType || null,
      },
    },
  ];

  // Add assertion results if present (inject after body)
  if (response.metadata?.assertionResults) {
    console.log('[Response Converter] ✓ Found assertion results, injecting into response doc');
    console.log('[Response Converter] Assertion results:', response.metadata.assertionResults);
    responseDocContent.push({
      type: 'assertion-results',
      attrs: {
        results: response.metadata.assertionResults.results,
        totalAssertions: response.metadata.assertionResults.totalAssertions,
        passedAssertions: response.metadata.assertionResults.passedAssertions,
        failedAssertions: response.metadata.assertionResults.failedAssertions,
      },
    });
  } else {
    console.log('[Response Converter] No assertion results in response.metadata');
  }

  // Add OpenAPI Spec result check if present
  if (response.metadata?.openAPIValidation) {
    console.log('[Response Converter] ✓ Found OpenAPI validation results, injecting into response doc');
    console.log('[Response Converter] OpenAPI validation:', response.metadata.openAPIValidation);
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
  } else {
    console.log('[Response Converter] No OpenAPI validation results in response.metadata');
  }

  // Add script assertion results if present
  const scriptAssertions =
    response.metadata?.scriptAssertionResults ||
    response.metadata?.preScriptAssertions ||
    response.metadata?.scriptAssertions;

  if (scriptAssertions) {
    console.log('[Response Converter] ✓ Found script assertion results, injecting into response doc');
    responseDocContent.push({
      type: 'script-assertion-results',
      attrs: {
        results: scriptAssertions.results || [],
        totalAssertions: scriptAssertions.totalAssertions ?? (scriptAssertions.results?.length || 0),
        passedAssertions: scriptAssertions.passedAssertions ?? (scriptAssertions.results || []).filter((r: any) => r?.passed).length,
        failedAssertions: scriptAssertions.failedAssertions ?? (scriptAssertions.results || []).filter((r: any) => !r?.passed).length,
      },
    });
  } else {
    console.log('[Response Converter] No script assertion results in response.metadata');
  }

  // Add response headers and request info
  responseDocContent.push(
    {
      type: "response-headers",
      attrs: {
        headers: headersArray,
      },
    },
    {
      type: "request-headers",
      attrs: {
        headers: response.requestMeta?.headers || [],
        url: response.requestMeta?.url || response.url || '',
        method: response.requestMeta?.method || '',
        httpVersion: response.requestMeta?.httpVersion,
        tls: response.requestMeta?.tlsInfo,
      },
    }
  );
   const responseDocNode = {
    type: 'response-doc',
    attrs: {
      activeNode: 'response-body', // Default to showing response body
      statusCode: response.statusCode,
      statusMessage: response.statusMessage || getDefaultStatusMessage(response.statusCode),
      elapsedTime: response.elapsedTime || 0,
      url: response.url || null,
    },
    content: responseDocContent,
  };


  const doc = {
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

  return doc;
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
