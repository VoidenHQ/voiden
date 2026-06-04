export interface Header {
  key: string
  value: string
  enabled: boolean
}

export interface WebSocketRequest {
  protocol: 'ws' | 'wss'
  url: string
  headers: Header[]
}

export interface GrpcRequest {
  protocol: 'grpc' | 'grpcs'
  url: string
  protoFilePath?: string
  service?: string
  method?: string
  package?: string
  callType?: string
  metadata: Record<string, string>
  body?: string
}

export interface RunResult {
  protocol: string
  method?: string
  url: string
  success: boolean
  status?: number
  statusText?: string
  durationMs: number
  size?: number
  body?: string
  error?: string
  connected?: boolean
}
