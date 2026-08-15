import { createHash, createHmac } from 'node:crypto'

export interface AwsSigV4Config {
  accessKey: string
  secretKey: string
  sessionToken?: string
  region: string
  /** AWS signing name, for example `execute-api`, `s3`, or `monitoring`. */
  service: string
}

interface AwsSigV4Request {
  method: string
  /** Fully materialized absolute URL, retaining its original path and query encoding. */
  url: string
  headers: Record<string, string>
  payload: Uint8Array
  config: AwsSigV4Config
  now?: Date
}

interface ParsedRawUrl {
  host: string
  path: string
  query?: string
}

export interface AwsSigV4Result {
  authorization: string
  signedHeaders: string
  signature: string
}

const ALGORITHM = 'AWS4-HMAC-SHA256'
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function hmac(key: string | Uint8Array, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest()
}

function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, char =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

function parseRawUrl(urlText: string): ParsedRawUrl {
  // URL is used only for validation and authority parsing. Its pathname and
  // searchParams are intentionally ignored because WHATWG URL normalizes dot
  // segments and treats `+` as a space in query parameters.
  const parsed = new URL(urlText)
  const match = urlText.match(/^[a-z][a-z\d+.-]*:\/\/[^/?#]*([^?#]*)(?:\?([^#]*))?(?:#.*)?$/i)
  if (!match) throw new Error('AWS SigV4 requires an absolute HTTP URL')
  return {
    host: parsed.host,
    path: match[1] || '/',
    query: match[2],
  }
}

function normalizeStandardPath(rawPath: string): string {
  const output: string[] = []
  const hadTrailingSlash = rawPath.endsWith('/') || rawPath.endsWith('/.') || rawPath.endsWith('/..')
  for (const segment of rawPath.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      output.pop()
      continue
    }
    output.push(segment)
  }
  const normalized = `/${output.join('/')}`
  return hadTrailingSlash && normalized !== '/' ? `${normalized}/` : normalized
}

function encodeS3Path(rawPath: string): string {
  let result = ''
  for (let index = 0; index < rawPath.length;) {
    const char = rawPath[index]
    if (char === '/') {
      result += '/'
      index++
      continue
    }
    const escape = rawPath.slice(index, index + 3)
    if (/^%[\da-f]{2}$/i.test(escape)) {
      result += escape.toUpperCase()
      index += 3
      continue
    }
    const codePoint = rawPath.codePointAt(index)
    if (codePoint === undefined) break
    const value = String.fromCodePoint(codePoint)
    result += awsEncode(value)
    index += value.length
  }
  return result || '/'
}

function isFetchNormalizedDotSegment(segment: string): boolean {
  const decodedDots = segment.replace(/%2e/gi, '.')
  return decodedDots === '.' || decodedDots === '..'
}

/**
 * Reject S3 object-key paths that WHATWG fetch would silently rewrite.
 * Duplicate slashes and non-dot percent escapes are safe and remain allowed.
 */
export function assertS3PathIsFetchSafe(url: string, service: string): void {
  if (service !== 's3') return
  const rawPath = parseRawUrl(url).path
  if (rawPath.split('/').some(isFetchNormalizedDotSegment)) {
    throw new Error(
      'AWS SigV4 cannot send this S3 path safely: fetch normalizes dot-only path segments ' +
      '(".", "..", and equivalent %2E forms) before sending, which would change the signed object key. ' +
      'Use an S3 object key without dot-only path segments in this request pipeline.',
    )
  }
}

function canonicalPath(rawPath: string, service: string): string {
  if (service === 's3') {
    // S3 object keys are path-sensitive: preserve duplicate slashes, dot
    // segments, and existing percent escapes (single URI encoding).
    return encodeS3Path(rawPath)
  }

  // Other SigV4 services normalize path segments and double-encode existing
  // percent escapes. Encoding the normalized raw text naturally turns `%2F`
  // into `%252F`, while restoring only actual path separators.
  return awsEncode(normalizeStandardPath(rawPath)).replace(/%2F/g, '/')
}

function decodePercentEncoding(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    // Preserve malformed escapes as literal percent signs. The secure executor
    // will send the same raw query and AWS canonicalization encodes `%` as `%25`.
    return value
  }
}

function canonicalQuery(rawQuery: string | undefined): string {
  if (rawQuery === undefined || rawQuery === '') return ''

  const parameters = rawQuery.split('&').map(part => {
    const separator = part.indexOf('=')
    const rawKey = separator < 0 ? part : part.slice(0, separator)
    const rawValue = separator < 0 ? '' : part.slice(separator + 1)
    // Deliberately do not apply application/x-www-form-urlencoded semantics:
    // a literal `+` is a plus byte, not a space.
    return [
      awsEncode(decodePercentEncoding(rawKey)),
      awsEncode(decodePercentEncoding(rawValue)),
    ] as const
  })

  parameters.sort(([leftKey, leftValue], [rightKey, rightValue]) =>
    leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0,
  )
  return parameters.map(([key, value]) => `${key}=${value}`).join('&')
}

function normalizeHeaderValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function setHttpHeader(headers: Record<string, string>, name: string, value: string): void {
  deleteHttpHeader(headers, name)
  headers[name] = value
}

function deleteHttpHeader(headers: Record<string, string>, name: string): void {
  const lowerName = name.toLowerCase()
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lowerName) delete headers[key]
  }
}

function getHttpHeader(headers: Record<string, string>, name: string): string | undefined {
  const lowerName = name.toLowerCase()
  const key = Object.keys(headers).find(candidate => candidate.toLowerCase() === lowerName)
  return key === undefined ? undefined : headers[key]
}

function formatAmzDate(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new Error('AWS SigV4 signing date is invalid')
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

/** Internal canonicalization seam. Not exported from the package entry point. */
export function createCanonicalRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  payloadHash: string,
  service: string,
): { canonicalRequest: string; signedHeaders: string } {
  const rawUrl = parseRawUrl(url)
  const canonicalHeaderMap = new Map<string, string[]>()
  const additionallySignedHeaders = new Set(['content-type', 'content-md5', 'date', 'range'])

  for (const [name, value] of Object.entries(headers)) {
    const lowerName = name.toLowerCase()
    if (lowerName === 'host' || lowerName.startsWith('x-amz-') || additionallySignedHeaders.has(lowerName)) {
      const values = canonicalHeaderMap.get(lowerName) ?? []
      values.push(normalizeHeaderValue(value))
      canonicalHeaderMap.set(lowerName, values)
    }
  }

  const canonicalHeaderEntries = [...canonicalHeaderMap.entries()]
    .map(([name, values]) => [name, values.join(',')] as const)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
  const canonicalHeaders = canonicalHeaderEntries
    .map(([name, value]) => `${name}:${value}\n`)
    .join('')
  const signedHeaders = canonicalHeaderEntries.map(([name]) => name).join(';')
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalPath(rawUrl.path, service),
    canonicalQuery(rawUrl.query),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  return { canonicalRequest, signedHeaders }
}

/**
 * Sign a fully materialized HTTP request using AWS Signature Version 4.
 * Internal to the secure executor; the package entry point does not expose it.
 */
export function signAwsRequest(request: AwsSigV4Request): AwsSigV4Result {
  const { method, headers, payload, config } = request
  assertS3PathIsFetchSafe(request.url, config.service)
  const rawUrl = parseRawUrl(request.url)
  const now = request.now ?? new Date()
  const amzDate = formatAmzDate(now)
  const shortDate = amzDate.slice(0, 8)
  const payloadHash = payload.byteLength === 0 ? EMPTY_SHA256 : sha256(payload)

  const sessionToken = config.sessionToken || getHttpHeader(headers, 'X-Amz-Security-Token')
  deleteHttpHeader(headers, 'Authorization')
  setHttpHeader(headers, 'Host', rawUrl.host)
  setHttpHeader(headers, 'X-Amz-Date', amzDate)
  deleteHttpHeader(headers, 'X-Amz-Security-Token')
  if (sessionToken !== undefined) {
    setHttpHeader(headers, 'X-Amz-Security-Token', sessionToken)
  }
  if (config.service === 's3' || getHttpHeader(headers, 'X-Amz-Content-Sha256') !== undefined) {
    setHttpHeader(headers, 'X-Amz-Content-Sha256', payloadHash)
  }

  const { canonicalRequest, signedHeaders } = createCanonicalRequest(
    method,
    request.url,
    headers,
    payloadHash,
    config.service,
  )
  const credentialScope = `${shortDate}/${config.region}/${config.service}/aws4_request`
  const stringToSign = [ALGORITHM, amzDate, credentialScope, sha256(canonicalRequest)].join('\n')
  const dateKey = hmac(`AWS4${config.secretKey}`, shortDate)
  const regionKey = hmac(dateKey, config.region)
  const serviceKey = hmac(regionKey, config.service)
  const signingKey = hmac(serviceKey, 'aws4_request')
  const signature = hmac(signingKey, stringToSign).toString('hex')
  const authorization = `${ALGORITHM} Credential=${config.accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`
  headers.Authorization = authorization

  return { authorization, signedHeaders, signature }
}
