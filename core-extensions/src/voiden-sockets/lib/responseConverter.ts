/**
 * Response Converter
 *
 * Converts HTTP response objects to Voiden document JSON with response nodes
 */


export interface WSSResponse {
  wsId?:string;
  statusCode?: number;
  requestMeta?: {
    url: string;
    headers: { key: string; value: string }[];
    /** Absolute path of the .void file that initiated this session — for history tagging */
    sourceFilePath?: string | null;
    proxy?: {
      name: string;
      host: string;
      port: number;
    };
  };
}

export interface GrpcResponse {
  grpcId?:string;
   statusCode?: number;
  requestMeta?: {
    package:string,
    service:string,
    callType:string,
    url: string;
    method:string,
    headers: { key: string; value: string }[];
    /** Absolute path of the .proto file used for this gRPC session */
    protoFilePath?: string | null;
    /** Parsed proto services — forwarded to history for void file reconstruction */
    protoServices?: any[] | null;
    /** Absolute path of the .void file that initiated this session — for history tagging */
    sourceFilePath?: string | null;
    proxy?: {
      name: string;
      host: string;
      port: number;
    };
  };
}

/**
 * Convert HTTP response to Voiden document JSON
 *
 * Creates a document with response-status, response-headers, and response-body nodes
 */
export function convertResponseToVoidenDocWithMessageNode(response: WSSResponse): any {

  const content: any[] = [];

  content.push(
    {
       type: "messages-node",
       attrs: {
        url: response.requestMeta?.url || '',
        wsId: response.wsId || '',
        headers: JSON.stringify(response.requestMeta?.headers ?? []),
        sourceFilePath: response.requestMeta?.sourceFilePath ?? null,
       },
    }
  );

  const doc = {
    type: 'doc',
    attrs: {
      statusCode:response.statusCode || 0,
      statusMessage: "",
      elapsedTime:  0,
      protocol:'wss',
      wsId: response.wsId || null,
      url: response.requestMeta?.url || null,
      requestMeta: response.requestMeta || null,
    },
    content,
  };

  return doc;
}
export function convertResponseToVoidenDocWithGRPCMessageNode(response: GrpcResponse): any {

  const content: any[] = [];

  content.push(
    {
       type: "grpc-messages-node",
       attrs: {
        url: response.requestMeta?.url || '',
        package: response.requestMeta?.package,
        grpcId: response.grpcId || '',
        callType: response.requestMeta?.callType,
        service: response.requestMeta?.service,
        method: response.requestMeta?.method,
        headers: JSON.stringify(response.requestMeta?.headers ?? []),
        protoFilePath: response.requestMeta?.protoFilePath ?? null,
        protoServices: response.requestMeta?.protoServices
          ? JSON.stringify(response.requestMeta.protoServices)
          : null,
        sourceFilePath: response.requestMeta?.sourceFilePath ?? null,
       },
    }
  );

  const doc = {
    type: 'doc',
    attrs: {
      statusCode: response.statusCode || 'ok',
      statusMessage: "",
      elapsedTime:  0,
      protocol:'grpc',
      grpcId: response.grpcId || null,
      url: response.requestMeta?.url || null,
      requestMeta: response.requestMeta || null,
    },
    content,
  };

  return doc;
}

