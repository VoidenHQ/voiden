import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeSecureRequest, type SecureRequestAdapter } from '../src/index.js'
import {
  createCanonicalRequest,
  signAwsRequest,
  type AwsSigV4Config,
} from '../src/awsSigV4.js'

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const OFFICIAL_TEST_CREDENTIALS: AwsSigV4Config = {
  accessKey: 'AKIDEXAMPLE',
  secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  service: 'service',
}

function successfulFetchResponse() {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers(),
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

function signVector(
  url: string,
  expectedSignature: string,
  options: { config?: AwsSigV4Config; headers?: Record<string, string> } = {},
) {
  const headers = options.headers ?? {}
  const result = signAwsRequest({
    method: 'GET',
    url,
    headers,
    payload: new Uint8Array(),
    config: options.config ?? OFFICIAL_TEST_CREDENTIALS,
    now: new Date('2015-08-30T12:36:00Z'),
  })
  expect(result.signature).toBe(expectedSignature)
  expect(headers.Authorization).toContain(`Signature=${expectedSignature}`)
}

describe('AWS Signature Version 4', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  // AWS CRT suite: awslabs/aws-c-auth/tests/aws-signing-test-suite/v4
  it.each([
    ['get-vanilla', 'https://example.amazonaws.com/', '5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31'],
    ['get-utf8', 'https://example.amazonaws.com/ሴ', '8318018e0b0f223aa2bbf98705b62bb787dc9c0e678f255a891fd03141be5d85'],
    ['get-slash-dot-slash-normalized', 'https://example.amazonaws.com/./', '5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31'],
    ['get-relative-normalized', 'https://example.amazonaws.com/example/..', '5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31'],
    ['get-slashes-normalized', 'https://example.amazonaws.com//example//', '9a624bd73a37c9a373b5312afbebe7a714a789de108f0bdfe846570885f57e84'],
    ['get-space-normalized', 'https://example.amazonaws.com/example space/', '652487583200325589f1fba4c7e578f72c47cb61beeca81406b39ddec1366741'],
    ['get-vanilla-query-order-key-case', 'https://example.amazonaws.com/?Param2=value2&Param1=value1', 'b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500'],
    ['get-vanilla-query-order-encoded', 'https://example.amazonaws.com/?Param-3=Value3&Param=Value2&%E1%88%B4=Value1', '371d3713e185cc334048618a97f809c9ffe339c62934c032af5a0e595648fcac'],
  ])('matches official vector %s', (_name, url, signature) => {
    signVector(url, signature)
  })

  it('matches the official session-token vector', () => {
    signVector(
      'https://example.amazonaws.com/',
      '07ec1639c89043aa0e3e2de82b96708f198cceab042d4a97044c66dd9f74e7f8',
      {
        config: {
          ...OFFICIAL_TEST_CREDENTIALS,
          sessionToken: '6e86291e8372ff2a2260956d9b8aae1d763fbf315fa00fa31553b73ebf194267',
        },
      },
    )
  })

  it('adopts an imported security-token header when auth config has no session token', () => {
    const headers = {
      'x-AMZ-security-TOKEN': '6e86291e8372ff2a2260956d9b8aae1d763fbf315fa00fa31553b73ebf194267',
    }

    signVector(
      'https://example.amazonaws.com/',
      '07ec1639c89043aa0e3e2de82b96708f198cceab042d4a97044c66dd9f74e7f8',
      { headers },
    )

    expect(headers).toHaveProperty(
      'X-Amz-Security-Token',
      '6e86291e8372ff2a2260956d9b8aae1d763fbf315fa00fa31553b73ebf194267',
    )
    expect(Object.keys(headers).filter(name => name.toLowerCase() === 'x-amz-security-token'))
      .toEqual(['X-Amz-Security-Token'])
    expect(headers).toHaveProperty(
      'Authorization',
      expect.stringContaining('SignedHeaders=host;x-amz-date;x-amz-security-token'),
    )
  })

  // AWS S3 documentation, "Example: GET Object".
  it('matches the official S3 GET Object vector', () => {
    const headers: Record<string, string> = { Range: 'bytes=0-9' }
    const result = signAwsRequest({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      headers,
      payload: new Uint8Array(),
      config: {
        accessKey: 'AKIAIOSFODNN7EXAMPLE',
        secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        region: 'us-east-1',
        service: 's3',
      },
      now: new Date('2013-05-24T00:00:00Z'),
    })

    expect(result.signedHeaders).toBe('host;range;x-amz-content-sha256;x-amz-date')
    expect(result.signature).toBe('f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41')
  })

  it('uses normalized, double-encoded paths for standard services', () => {
    const { canonicalRequest } = createCanonicalRequest(
      'GET',
      'https://example.amazonaws.com/a//./b/../%2F/%252F',
      { Host: 'example.amazonaws.com' },
      EMPTY_SHA256,
      'execute-api',
    )

    expect(canonicalRequest.split('\n')[1]).toBe('/a/%252F/%25252F')
  })

  it('preserves S3 slash, dot-segment, and percent-escape semantics', () => {
    const { canonicalRequest } = createCanonicalRequest(
      'GET',
      'https://examplebucket.s3.amazonaws.com/a//./b/../%2F/%252F',
      { Host: 'examplebucket.s3.amazonaws.com' },
      EMPTY_SHA256,
      's3',
    )

    expect(canonicalRequest.split('\n')[1]).toBe('/a//./b/../%2F/%252F')
  })

  it.each([
    '/bucket/./object',
    '/bucket/../object',
    '/bucket/%2e/object',
    '/bucket/.%2E/object',
    '/bucket/%2e./object',
    '/bucket/%2E%2e/object',
  ])('rejects an S3 fetch-normalized dot path before signing or fetch: %s', async path => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(executeSecureRequest({
      method: 'GET',
      url: `https://examplebucket.s3.amazonaws.com${path}`,
      headers: [], queryParams: [], pathParams: [],
      auth: {
        enabled: true,
        type: 'aws-signature',
        config: { ...OFFICIAL_TEST_CREDENTIALS, service: 's3' },
      },
    }, { replaceVar: async text => text, isElectron: false })).rejects.toThrow(
      'fetch normalizes dot-only path segments',
    )

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an unsafe S3 path before mutating signing headers', () => {
    const headers: Record<string, string> = {}

    expect(() => signAwsRequest({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/bucket/%2E%2e/object',
      headers,
      payload: new Uint8Array(),
      config: { ...OFFICIAL_TEST_CREDENTIALS, service: 's3' },
      now: new Date('2015-08-30T12:36:00Z'),
    })).toThrow('fetch normalizes dot-only path segments')

    expect(headers).toEqual({})
  })

  it('allows S3 duplicate slashes and non-dot escapes to be signed and fetched', async () => {
    const fetchMock = vi.fn().mockResolvedValue(successfulFetchResponse())
    vi.stubGlobal('fetch', fetchMock)

    await executeSecureRequest({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/bucket//folder/%2F/object',
      headers: [], queryParams: [], pathParams: [],
      auth: {
        enabled: true,
        type: 'aws-signature',
        config: { ...OFFICIAL_TEST_CREDENTIALS, service: 's3' },
      },
    }, {
      replaceVar: async text => text,
      now: () => new Date('2015-08-30T12:36:00Z'),
      isElectron: false,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://examplebucket.s3.amazonaws.com/bucket//folder/%2F/object')
    expect(options.redirect).toBe('manual')
    expect((options.headers as Record<string, string>).Authorization).toContain(
      'Credential=AKIDEXAMPLE/20150830/us-east-1/s3/aws4_request',
    )
  })

  it('canonicalizes raw query bytes without treating plus as space', () => {
    const { canonicalRequest } = createCanonicalRequest(
      'GET',
      'https://example.amazonaws.com/?literal=+&encoded=%2B&double=%252B&space=%20&repeat=b&repeat=a&empty=&novalue&=blank',
      { Host: 'example.amazonaws.com' },
      EMPTY_SHA256,
      'execute-api',
    )

    expect(canonicalRequest.split('\n')[2]).toBe(
      '=blank&double=%252B&empty=&encoded=%2B&literal=%2B&novalue=&repeat=a&repeat=b&space=%20',
    )
  })

  it('signs only after variables, path, query, headers, and body are materialized', async () => {
    const fetchMock = vi.fn().mockResolvedValue(successfulFetchResponse())
    vi.stubGlobal('fetch', fetchMock)
    const adapter: SecureRequestAdapter = {
      replaceVar: async text => text
        .replaceAll('{{HOST}}', 'example.amazonaws.com')
        .replaceAll('{{ID}}', 'a/b')
        .replaceAll('{{VALUE}}', 'hello world')
        .replaceAll('{{ACCESS}}', 'AKIDEXAMPLE')
        .replaceAll('{{SECRET}}', OFFICIAL_TEST_CREDENTIALS.secretKey),
      now: () => new Date('2015-08-30T12:36:00Z'),
      followRedirects: true,
      isElectron: false,
    }

    const result = await executeSecureRequest({
      method: 'POST',
      url: 'https://{{HOST}}/items/{id}',
      headers: [
        { key: 'Content-Type', value: 'application/json', enabled: true },
        { key: 'X-Amz-Target', value: 'Example.{{VALUE}}', enabled: true },
        { key: 'authorization', value: 'obsolete', enabled: true },
        { key: 'x-AMZ-date', value: '20000101T000000Z', enabled: true },
        { key: 'X-Amz-Security-Token', value: 'obsolete-token', enabled: true },
      ],
      queryParams: [{ key: 'q', value: '{{VALUE}}', enabled: true }],
      pathParams: [{ key: 'id', value: '{{ID}}', enabled: true }],
      body: '{"message":"{{VALUE}}"}',
      contentType: 'application/json',
      auth: {
        enabled: true,
        type: 'aws-signature',
        config: {
          accessKey: '{{ACCESS}}',
          secretKey: '{{SECRET}}',
          sessionToken: 'session-token',
          region: 'us-east-1',
          service: 'execute-api',
        },
      },
    }, adapter)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    const sentHeaders = options.headers as Record<string, string>
    expect(url).toBe('https://example.amazonaws.com/items/a%2Fb?q=hello%20world')
    expect(options.body).toBe('{"message":"hello world"}')
    expect(options.redirect).toBe('manual')
    expect(sentHeaders['X-Amz-Date']).toBe('20150830T123600Z')
    expect(sentHeaders['X-Amz-Security-Token']).toBe('session-token')
    expect(sentHeaders.Authorization).toContain('Credential=AKIDEXAMPLE/20150830/us-east-1/execute-api/aws4_request')
    expect(sentHeaders.Authorization).toContain('SignedHeaders=content-type;host;x-amz-date;x-amz-security-token;x-amz-target')
    expect(Object.keys(sentHeaders).filter(key => key.toLowerCase() === 'authorization')).toEqual(['Authorization'])
    expect(Object.keys(sentHeaders).filter(key => key.toLowerCase() === 'x-amz-date')).toEqual(['X-Amz-Date'])
    expect(Object.keys(sentHeaders).filter(key => key.toLowerCase() === 'x-amz-security-token')).toEqual(['X-Amz-Security-Token'])
    expect(result.kind).toBe('http')
    if (result.kind === 'http') {
      expect(result.requestMeta.headers).toEqual(expect.arrayContaining([
        { key: 'Authorization', value: '[REDACTED]' },
        { key: 'X-Amz-Security-Token', value: '[REDACTED]' },
      ]))
    }
  })

  it('preserves and redacts an imported security-token header through secure execution', async () => {
    const fetchMock = vi.fn().mockResolvedValue(successfulFetchResponse())
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeSecureRequest({
      method: 'GET',
      url: 'https://example.amazonaws.com/',
      headers: [{
        key: 'x-AMZ-security-TOKEN',
        value: 'imported-session-token',
        enabled: true,
      }],
      queryParams: [],
      pathParams: [],
      auth: {
        enabled: true,
        type: 'aws-signature',
        config: { ...OFFICIAL_TEST_CREDENTIALS, service: 'execute-api' },
      },
    }, {
      replaceVar: async text => text,
      now: () => new Date('2015-08-30T12:36:00Z'),
      isElectron: false,
    })

    const sentHeaders = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(sentHeaders['X-Amz-Security-Token']).toBe('imported-session-token')
    expect(sentHeaders.Authorization).toContain(
      'SignedHeaders=host;x-amz-date;x-amz-security-token',
    )
    expect(Object.keys(sentHeaders).filter(name => name.toLowerCase() === 'x-amz-security-token'))
      .toEqual(['X-Amz-Security-Token'])
    expect(result.kind).toBe('http')
    if (result.kind === 'http') {
      expect(result.requestMeta.headers).toContainEqual({
        key: 'X-Amz-Security-Token',
        value: '[REDACTED]',
      })
    }
  })

  it('fails before fetch when required signing configuration is missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(executeSecureRequest({
      method: 'GET',
      url: 'https://example.amazonaws.com',
      headers: [], queryParams: [], pathParams: [],
      auth: {
        enabled: true,
        type: 'aws-signature',
        config: { accessKey: '', secretKey: '', region: '', service: '' },
      },
    }, { replaceVar: async text => text, isElectron: false })).rejects.toThrow(
      'AWS SigV4 configuration is missing: access key, secret key, region, signing service',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects multipart signing because deterministic bytes are unavailable', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(executeSecureRequest({
      method: 'POST',
      url: 'https://s3.us-east-1.amazonaws.com/example',
      headers: [], queryParams: [], pathParams: [],
      contentType: 'multipart/form-data',
      bodyParams: [{ key: 'field', value: 'value', type: 'text', enabled: true }],
      auth: {
        enabled: true,
        type: 'aws-signature',
        config: { ...OFFICIAL_TEST_CREDENTIALS, service: 's3' },
      },
    }, { replaceVar: async text => text, isElectron: false })).rejects.toThrow(
      'AWS SigV4 does not support multipart/form-data in this request pipeline',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
