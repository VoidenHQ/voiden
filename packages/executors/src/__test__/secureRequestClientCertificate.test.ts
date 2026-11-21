import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Buffer } from 'node:buffer'
import { executeSecureRequest, type SecureRequestAdapter } from '../secureRequest.js'
import { ClientCertificateError } from '../clientCertificates.js'

const mockFetch = vi.fn()

function send(adapter: SecureRequestAdapter, metadata?: Record<string, any>) {
  return executeSecureRequest(
    {
      method: 'GET',
      url: 'https://api.bank.com/accounts',
      headers: [],
      queryParams: [],
      pathParams: [],
      metadata,
    } as any,
    adapter,
  )
}

describe('executeSecureRequest client certificates', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      arrayBuffer: async () => new ArrayBuffer(0),
    })
    vi.stubGlobal('fetch', mockFetch)
  })

  it('resolves the certificate for the resolved URL and hands it to getDispatcher', async () => {
    const connect = { cert: Buffer.from('cert'), key: Buffer.from('key') }
    const resolveClientCertificate = vi.fn().mockResolvedValue({ profile: 'payments', connect })
    const getDispatcher = vi.fn().mockReturnValue({ dispatcher: { tag: 'dispatcher' } })

    const result = await send(
      { replaceVar: async t => t, getDispatcher, resolveClientCertificate },
      { client_certificate: 'payments' },
    )

    expect(resolveClientCertificate).toHaveBeenCalledWith('https://api.bank.com/accounts', 'payments')
    expect(getDispatcher).toHaveBeenCalledWith('https://api.bank.com/accounts', connect)
    expect(mockFetch.mock.calls[0][1].dispatcher).toEqual({ tag: 'dispatcher' })
    expect(result.kind === 'http' && result.requestMeta.clientCertificate).toBe('payments')
  })

  it('sends no certificate and reports no profile when none applies', async () => {
    const getDispatcher = vi.fn().mockReturnValue({})
    const result = await send({
      replaceVar: async t => t,
      getDispatcher,
      resolveClientCertificate: async () => null,
    })

    expect(getDispatcher).toHaveBeenCalledWith('https://api.bank.com/accounts', undefined)
    expect(result.kind === 'http' && result.requestMeta.clientCertificate).toBeUndefined()
  })

  it('fails the request, without sending it, when the certificate cannot be resolved', async () => {
    const adapter: SecureRequestAdapter = {
      replaceVar: async t => t,
      getDispatcher: () => ({}),
      resolveClientCertificate: async () => {
        throw new ClientCertificateError('Client certificate profile "x": wrong or missing passphrase')
      },
    }
    await expect(send(adapter)).rejects.toThrow(/wrong or missing passphrase/)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
