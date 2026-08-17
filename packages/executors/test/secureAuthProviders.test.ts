import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeSecureRequest, secureAuthProviders, SecureAuthProviderRegistry, type SecureAuthProvider } from '../src/index.js'

function successfulFetchResponse() {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers(),
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

describe('secureAuthProviders registry', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('getForAuthType returns undefined for an unknown type', () => {
    expect(secureAuthProviders.getForAuthType('does-not-exist')).toBeUndefined()
  })

  it('getForAuthType returns the registered provider for each of its authTypes aliases', () => {
    expect(secureAuthProviders.getForAuthType('aws-signature')?.id).toBe('AWS SigV4')
    expect(secureAuthProviders.getForAuthType('awsSignature')?.id).toBe('AWS SigV4')
  })

  it('register throws on a duplicate authTypes entry', () => {
    const registry = new SecureAuthProviderRegistry()
    const stubA: SecureAuthProvider = {
      id: 'Stub A',
      authTypes: ['stub'],
      resolveConfig: async () => undefined,
      apply: () => ({}),
    }
    const stubB: SecureAuthProvider = {
      id: 'Stub B',
      authTypes: ['stub'],
      resolveConfig: async () => undefined,
      apply: () => ({}),
    }
    registry.register(stubA)
    expect(() => registry.register(stubB)).toThrow(/Stub A/)
    expect(() => registry.register(stubB)).toThrow(/Stub B/)
  })

  it('a provider with supportsMultipartBody unset behaves as true (permissive default)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(successfulFetchResponse()))

    const stub: SecureAuthProvider = {
      id: 'Stub Permissive Multipart',
      authTypes: ['stub-multipart-permissive'],
      resolveConfig: async () => ({}),
      apply: () => ({}),
    }
    secureAuthProviders.register(stub)

    let thrown: unknown
    try {
      await executeSecureRequest({
        method: 'POST',
        url: 'https://example.com/upload',
        headers: [], queryParams: [], pathParams: [],
        contentType: 'multipart/form-data',
        bodyParams: [{ key: 'field', value: 'value', type: 'text', enabled: true }],
        auth: { enabled: true, type: 'stub-multipart-permissive', config: {} },
      }, { replaceVar: async text => text, isElectron: false })
    } catch (err) {
      thrown = err
    }

    // The permissive default must not take the "does not support multipart/form-data"
    // fail-fast path (neither the early body-building guard nor the pre-signing one).
    if (thrown) {
      expect((thrown as Error).message).not.toContain('does not support multipart/form-data')
    }
  })

  it('a provider with forcesManualRedirect unset behaves as false (follows adapter.followRedirects)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(successfulFetchResponse())
    vi.stubGlobal('fetch', fetchMock)

    const stub: SecureAuthProvider = {
      id: 'Stub No Redirect Force',
      authTypes: ['stub-no-redirect-force'],
      resolveConfig: async () => ({}),
      apply: () => ({}),
    }
    secureAuthProviders.register(stub)

    await executeSecureRequest({
      method: 'GET',
      url: 'https://example.com/',
      headers: [], queryParams: [], pathParams: [],
      auth: { enabled: true, type: 'stub-no-redirect-force', config: {} },
    }, { replaceVar: async text => text, isElectron: false, followRedirects: true })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(options.redirect).toBe('follow')
  })

  it('an unrecognized auth.type is a no-op, not an error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(successfulFetchResponse())
    vi.stubGlobal('fetch', fetchMock)

    await executeSecureRequest({
      method: 'GET',
      url: 'https://example.com/',
      headers: [{ key: 'X-Existing', value: 'unchanged', enabled: true }],
      queryParams: [], pathParams: [],
      auth: { enabled: true, type: 'basic', config: { username: 'u', password: 'p' } },
    }, { replaceVar: async text => text, isElectron: false })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    const sentHeaders = options.headers as Record<string, string>
    expect(sentHeaders['X-Existing']).toBe('unchanged')
    expect(sentHeaders.Authorization).toBeUndefined()
  })

  it('auth.enabled === false bypasses the provider even when type matches', async () => {
    const fetchMock = vi.fn().mockResolvedValue(successfulFetchResponse())
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeSecureRequest({
      method: 'GET',
      url: 'https://example.amazonaws.com/',
      headers: [], queryParams: [], pathParams: [],
      auth: {
        enabled: false,
        type: 'aws-signature',
        config: {
          accessKey: 'AKIDEXAMPLE',
          secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
          region: 'us-east-1',
          service: 'execute-api',
        },
      },
    }, { replaceVar: async text => text, isElectron: false })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    const sentHeaders = options.headers as Record<string, string>
    expect(sentHeaders.Authorization).toBeUndefined()
    expect(result.kind).toBe('http')
    if (result.kind === 'http') {
      expect(result.requestMeta.headers.find(h => h.key === 'Authorization')).toBeUndefined()
    }
  })
})
