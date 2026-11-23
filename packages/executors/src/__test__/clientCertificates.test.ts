import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { createServer, request as httpsRequest, type Server } from 'node:https'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ClientCertificateError,
  hostMatchesPattern,
  parseCertificateProfiles,
  resolveClientCertificate,
  selectClientCertificateProfile,
  describeKeyLoadError,
  serializeCertificateProfiles,
  loadClientCertificateProfile,
} from '../clientCertificates.js'

const profilesYaml = `
profiles:
  payments:
    hosts: ["*.payments.internal", "api.bank.com:8443"]
    cert: ./certs/{{ENV}}/client.pem
    key: ./certs/{{ENV}}/client.key
    ca: ./certs/ca.pem
    passphrase: "{{PASS}}"
  partner:
    hosts: partner.example.com
    pfx: ./certs/partner.p12
`

describe('parseCertificateProfiles', () => {
  it('parses profiles in declaration order', () => {
    const profiles = parseCertificateProfiles(profilesYaml)
    expect(profiles.map(p => p.name)).toEqual(['payments', 'partner'])
    expect(profiles[0]).toMatchObject({
      hosts: ['*.payments.internal', 'api.bank.com:8443'],
      cert: './certs/{{ENV}}/client.pem',
      key: './certs/{{ENV}}/client.key',
      ca: './certs/ca.pem',
      passphrase: '{{PASS}}',
    })
    // a single host string is accepted
    expect(profiles[1]).toMatchObject({ hosts: ['partner.example.com'], pfx: './certs/partner.p12' })
  })

  it('treats an empty file or a file without profiles as "no profiles"', () => {
    expect(parseCertificateProfiles('')).toEqual([])
    expect(parseCertificateProfiles('# nothing yet\n')).toEqual([])
    expect(parseCertificateProfiles('profiles:\n')).toEqual([])
  })

  it.each([
    ['invalid YAML', 'profiles: [unclosed', /not valid YAML/],
    ['profiles that is a list', 'profiles:\n  - a\n', /"profiles" must be a map/],
    ['a profile without hosts', 'profiles:\n  a:\n    pfx: x.p12\n', /profile "a" needs a non-empty "hosts"/],
    ['a profile without a key', 'profiles:\n  a:\n    hosts: [h]\n    cert: c.pem\n', /profile "a" needs "pfx", or both/],
    ['a profile mixing pfx and pem', 'profiles:\n  a:\n    hosts: [h]\n    pfx: p.p12\n    cert: c.pem\n    key: k.pem\n', /either "pfx" or "cert" \+ "key"/],
    ['a non-string path', 'profiles:\n  a:\n    hosts: [h]\n    pfx: 12\n', /"pfx" must be a file path/],
  ])('rejects %s', (_label, text, message) => {
    expect(() => parseCertificateProfiles(text)).toThrow(message)
    expect(() => parseCertificateProfiles(text)).toThrow(ClientCertificateError)
  })
})

describe('hostMatchesPattern', () => {
  it('matches hosts case-insensitively', () => {
    expect(hostMatchesPattern('API.Bank.com', 'https://api.bank.COM/v1')).toBe(true)
    expect(hostMatchesPattern('api.bank.com', 'https://other.bank.com/')).toBe(false)
  })

  it('supports *. wildcards for subdomains only', () => {
    expect(hostMatchesPattern('*.payments.internal', 'https://a.payments.internal/')).toBe(true)
    expect(hostMatchesPattern('*.payments.internal', 'https://a.b.payments.internal/')).toBe(true)
    expect(hostMatchesPattern('*.payments.internal', 'https://payments.internal/')).toBe(false)
    expect(hostMatchesPattern('*.payments.internal', 'https://evilpayments.internal/')).toBe(false)
  })

  it('restricts to a port when the pattern has one, using scheme defaults', () => {
    expect(hostMatchesPattern('api.bank.com:8443', 'https://api.bank.com:8443/')).toBe(true)
    expect(hostMatchesPattern('api.bank.com:8443', 'https://api.bank.com/')).toBe(false)
    expect(hostMatchesPattern('api.bank.com:443', 'https://api.bank.com/')).toBe(true)
    expect(hostMatchesPattern('api.bank.com:443', 'wss://api.bank.com/socket')).toBe(true)
    expect(hostMatchesPattern('api.bank.com:80', 'ws://api.bank.com/socket')).toBe(true)
    // a pattern without a port matches any port
    expect(hostMatchesPattern('api.bank.com', 'https://api.bank.com:9999/')).toBe(true)
  })

  it('handles IPv6 literals and unparsable URLs', () => {
    expect(hostMatchesPattern('[::1]:8443', 'https://[::1]:8443/')).toBe(true)
    expect(hostMatchesPattern('[::1]', 'https://[::1]:8443/')).toBe(true)
    expect(hostMatchesPattern('[::1]:9', 'https://[::1]:8443/')).toBe(false)
    expect(hostMatchesPattern('api.bank.com', 'not a url')).toBe(false)
  })
})

describe('selectClientCertificateProfile', () => {
  const profiles = parseCertificateProfiles(`
profiles:
  first:
    hosts: ["*.example.com"]
    pfx: a.p12
  second:
    hosts: ["api.example.com"]
    pfx: b.p12
`)

  it('auto (and unset) picks the first matching profile', () => {
    expect(selectClientCertificateProfile(profiles, 'https://api.example.com/')?.name).toBe('first')
    expect(selectClientCertificateProfile(profiles, 'https://api.example.com/', 'auto')?.name).toBe('first')
    expect(selectClientCertificateProfile(profiles, 'https://other.org/', 'AUTO')).toBeNull()
  })

  it('none never picks a profile', () => {
    expect(selectClientCertificateProfile(profiles, 'https://api.example.com/', 'none')).toBeNull()
  })

  it('a profile name forces that profile regardless of host', () => {
    expect(selectClientCertificateProfile(profiles, 'https://elsewhere.org/', 'second')?.name).toBe('second')
  })

  it('an unknown profile name is an error listing the available ones', () => {
    expect(() => selectClientCertificateProfile(profiles, 'https://api.example.com/', 'nope')).toThrow(
      /"nope" is not a profile.*first, second/,
    )
  })
})

const hasOpenssl = (() => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

describe.skipIf(!hasOpenssl)('resolveClientCertificate (real certificates)', () => {
  let root: string
  let server: Server
  let port: number
  const seenSubjects: (string | null)[] = []

  const openssl = (...args: string[]) => execFileSync('openssl', args, { cwd: join(root, 'certs'), stdio: 'ignore' })

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'voiden-mtls-'))
    mkdirSync(join(root, 'certs', 'dev'), { recursive: true })
    mkdirSync(join(root, '.voiden'), { recursive: true })

    openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-subj', '/CN=voiden-test-ca', '-days', '2')
    writeFileSync(join(root, 'certs', 'san.cnf'), 'subjectAltName=DNS:localhost,IP:127.0.0.1\n')
    openssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=localhost')
    openssl('x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'server.pem', '-days', '2', '-extfile', 'san.cnf')
    openssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'dev/client.key', '-out', 'client.csr', '-subj', '/CN=voiden-client')
    openssl('x509', '-req', '-in', 'client.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'dev/client.pem', '-days', '2')
    openssl('pkcs8', '-topk8', '-in', 'dev/client.key', '-out', 'dev/client-enc.key', '-passout', 'pass:s3cret')
    openssl('pkcs12', '-export', '-inkey', 'dev/client.key', '-in', 'dev/client.pem', '-out', 'client.p12', '-passout', 'pass:s3cret')

    server = createServer(
      {
        cert: readFileSync(join(root, 'certs', 'server.pem')),
        key: readFileSync(join(root, 'certs', 'server.key')),
        ca: readFileSync(join(root, 'certs', 'ca.pem')),
        requestCert: true,
        rejectUnauthorized: true,
      },
      (req, res) => {
        const peer = (req.socket as any).getPeerCertificate?.()
        seenSubjects.push(peer?.subject?.CN ?? null)
        res.end('ok')
      },
    )
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    await new Promise<void>(r => server.close(() => r()))
    rmSync(root, { recursive: true, force: true })
  })

  const writeProfiles = (yaml: string) => writeFileSync(join(root, '.voiden', 'certificates.yaml'), yaml)
  const replaceVar = async (t: string) => t.replace('{{ENV}}', 'dev').replace('{{PASS}}', 's3cret')

  const get = (connect: object = {}) =>
    new Promise<string>((resolve, reject) => {
      const req = httpsRequest(
        { host: '127.0.0.1', port, servername: 'localhost', path: '/', ca: readFileSync(join(root, 'certs', 'ca.pem')), ...connect },
        res => {
          res.resume()
          res.on('end', () => resolve('ok'))
        },
      )
      req.on('error', reject)
      req.end()
    })

  const url = () => `https://localhost:${port}/`

  it('resolves PEM cert + key with variables in the paths and presents them to the server', async () => {
    writeProfiles(`
profiles:
  dev:
    hosts: ["localhost:${port}"]
    cert: ./certs/{{ENV}}/client.pem
    key: ./certs/{{ENV}}/client.key
    ca: ./certs/ca.pem
`)
    const resolved = await resolveClientCertificate({ url: url(), projectRoot: root, replaceVar })
    expect(resolved?.profile).toBe('dev')

    await expect(get()).rejects.toThrow() // no certificate: the server rejects the handshake
    seenSubjects.length = 0
    await get(resolved!.connect)
    expect(seenSubjects).toEqual(['voiden-client'])
  })

  it('resolves an encrypted key using the passphrase from variables', async () => {
    writeProfiles(`
profiles:
  enc:
    hosts: ["localhost"]
    cert: ./certs/dev/client.pem
    key: ./certs/dev/client-enc.key
    passphrase: "{{PASS}}"
`)
    const resolved = await resolveClientCertificate({ url: url(), projectRoot: root, replaceVar })
    expect(resolved?.profile).toBe('enc')
    seenSubjects.length = 0
    await get(resolved!.connect)
    expect(seenSubjects).toEqual(['voiden-client'])
  })

  it('resolves a PFX bundle', async () => {
    writeProfiles(`
profiles:
  bundle:
    hosts: ["localhost"]
    pfx: ./certs/client.p12
    passphrase: s3cret
`)
    const resolved = await resolveClientCertificate({ url: url(), projectRoot: root })
    seenSubjects.length = 0
    await get(resolved!.connect)
    expect(seenSubjects).toEqual(['voiden-client'])
  })

  it('reports a wrong passphrase without leaking key material', async () => {
    writeProfiles(`
profiles:
  enc:
    hosts: ["localhost"]
    cert: ./certs/dev/client.pem
    key: ./certs/dev/client-enc.key
    passphrase: wrong
`)
    const error = await resolveClientCertificate({ url: url(), projectRoot: root }).catch(e => e)
    expect(error).toBeInstanceOf(ClientCertificateError)
    expect(error.message).toMatch(/profile "enc": wrong or missing passphrase/)
    expect(error.message).not.toMatch(/BEGIN/)
  })

  it('reports a missing file with the profile and field', async () => {
    writeProfiles(`
profiles:
  gone:
    hosts: ["localhost"]
    cert: ./certs/missing.pem
    key: ./certs/dev/client.key
`)
    await expect(resolveClientCertificate({ url: url(), projectRoot: root })).rejects.toThrow(
      /profile "gone": cannot read cert file .*missing\.pem \(file not found\)/,
    )
  })

  it('returns null when nothing applies', async () => {
    writeProfiles(`
profiles:
  other:
    hosts: ["other.example.com"]
    pfx: ./certs/client.p12
`)
    expect(await resolveClientCertificate({ url: url(), projectRoot: root })).toBeNull()
    expect(await resolveClientCertificate({ url: 'https://other.example.com/', projectRoot: root, choice: 'none' })).toBeNull()
    expect(await resolveClientCertificate({ url: url(), projectRoot: undefined })).toBeNull()
  })

  it('does not look for a certificate on plain http/ws URLs', async () => {
    writeProfiles('profiles:\n  broken: nope\n') // would throw if it were parsed
    expect(await resolveClientCertificate({ url: 'http://localhost/', projectRoot: root })).toBeNull()
    expect(await resolveClientCertificate({ url: 'ws://localhost/', projectRoot: root, choice: 'broken' })).toBeNull()
  })

  it('treats a missing certificates.yaml as "no certificate" unless a profile is requested by name', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'voiden-mtls-empty-'))
    try {
      expect(await resolveClientCertificate({ url: url(), projectRoot: empty })).toBeNull()
      expect(await resolveClientCertificate({ url: url(), projectRoot: empty, choice: 'auto' })).toBeNull()
      await expect(resolveClientCertificate({ url: url(), projectRoot: empty, choice: 'dev' })).rejects.toThrow(
        /requires \.voiden\/certificates\.yaml/,
      )
      await expect(resolveClientCertificate({ url: url(), choice: 'dev' })).rejects.toThrow(/needs an open project/)
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })

  it('forces a named profile even when the host does not match', async () => {
    writeProfiles(`
profiles:
  other:
    hosts: ["other.example.com"]
    pfx: ./certs/client.p12
    passphrase: s3cret
`)
    const resolved = await resolveClientCertificate({ url: url(), projectRoot: root, choice: 'other' })
    expect(resolved?.profile).toBe('other')
  })
})

describe('describeKeyLoadError', () => {
  // Messages captured from Node 22 (OpenSSL 3, used by the CLI) and Electron 44 (BoringSSL, used by the app).
  const cases: [string, { code?: string; message: string }, RegExp][] = [
    ['Node: wrong PEM passphrase', { code: 'ERR_OSSL_BAD_DECRYPT', message: 'error:1C800064:Provider routines::bad decrypt' }, /wrong or missing passphrase/],
    ['Electron: wrong PEM passphrase', { code: 'ERR_OSSL_BAD_DECRYPT', message: 'error:1e000065:Cipher functions:OPENSSL_internal:BAD_DECRYPT' }, /wrong or missing passphrase/],
    ['Node: wrong PFX passphrase', { message: 'mac verify failure' }, /wrong or missing passphrase/],
    ['Electron: wrong PFX passphrase', { message: 'INCORRECT_PASSWORD' }, /wrong or missing passphrase/],
    ['Electron: legacy-encrypted key', { code: 'ERR_OSSL_UNKNOWN_ALGORITHM', message: 'error:13000077:PKCS8 routines:OPENSSL_internal:UNKNOWN_ALGORITHM' }, /not supported; re-export it with AES/],
    ['Node: legacy PFX', { code: 'ERR_CRYPTO_UNSUPPORTED_OPERATION', message: 'Unsupported PKCS12 PFX data' }, /not supported; re-export it with AES/],
    ['Electron: not PEM', { code: 'ERR_OSSL_PEM_NO_START_LINE', message: 'error:0900006e:PEM routines:OPENSSL_internal:NO_START_LINE' }, /not a valid PEM file/],
    ['Electron: key/cert mismatch', { code: 'ERR_OSSL_X509_KEY_VALUES_MISMATCH', message: 'error:0b000074:X.509 certificate routines:OPENSSL_internal:KEY_VALUES_MISMATCH' }, /does not belong to the certificate/],
    ['Node: key/cert mismatch', { code: 'ERR_OSSL_X509_KEY_VALUES_MISMATCH', message: 'error:05800074:x509 certificate routines::key values mismatch' }, /does not belong to the certificate/],
    ['unknown', { message: 'something else' }, /could not be parsed/],
  ]
  for (const [name, err, expected] of cases) {
    it(name, () => expect(describeKeyLoadError(err)).toMatch(expected))
  }
})

describe('serializeCertificateProfiles', () => {
  it('writes a new file with a header and the profiles', () => {
    const out = serializeCertificateProfiles('', [
      { name: 'pay', hosts: ['*.pay.internal', 'api:8443'], cert: './c.pem', key: './c.key', passphrase: '{{PASS}}' },
    ])
    expect(out).toMatch(/^# Client certificates/)
    expect(parseCertificateProfiles(out)).toEqual([
      { name: 'pay', hosts: ['*.pay.internal', 'api:8443'], cert: './c.pem', key: './c.key', passphrase: '{{PASS}}' },
    ])
  })

  it('keeps comments and other keys of an existing file, and profile order', () => {
    const existing = '# my notes\nprofiles:\n  old:\n    hosts: [x]\n    pfx: a.p12\nother: keep-me\n'
    const out = serializeCertificateProfiles(existing, [...parseCertificateProfiles(existing), { name: 'pfx2', hosts: ['y.com'], pfx: 'b.p12' }])
    expect(out).toMatch(/^# my notes/)
    expect(out).toMatch(/other: keep-me/)
    expect(parseCertificateProfiles(out).map(p => p.name)).toEqual(['old', 'pfx2'])
  })

  it('can remove every profile', () => {
    expect(parseCertificateProfiles(serializeCertificateProfiles('profiles:\n  a:\n    hosts: [x]\n    pfx: a\n', []))).toEqual([])
  })

  it('rejects reserved and duplicate names and invalid profiles', () => {
    expect(() => serializeCertificateProfiles('', [{ name: 'auto', hosts: ['x'], pfx: 'a' }])).toThrow(/reserved/)
    expect(() => serializeCertificateProfiles('', [{ name: 'a', hosts: ['x'], pfx: 'a' }, { name: 'a', hosts: ['y'], pfx: 'b' }])).toThrow(/Two profiles/)
    expect(() => serializeCertificateProfiles('', [{ name: 'x', hosts: [], pfx: 'a' }])).toThrow(/hosts/)
    expect(() => serializeCertificateProfiles('', [{ name: 'x', hosts: ['h'], cert: 'c' }])).toThrow(/both "cert" and "key"/)
  })
})

describe('unresolved variables', () => {
  const read = async () => Buffer.from('x')
  it('names a passphrase variable that is not set instead of reporting a wrong passphrase', async () => {
    await expect(
      loadClientCertificateProfile({ name: 'p', hosts: ['h'], pfx: 'a.p12', passphrase: '{{CLIENT_CERT_PASS}}' }, { projectRoot: '/proj', readFile: read }),
    ).rejects.toThrow('Client certificate profile "p": passphrase uses {{CLIENT_CERT_PASS}}, which is not set in the active environment')
  })
  it('names a path variable that is not set', async () => {
    await expect(
      loadClientCertificateProfile({ name: 'p', hosts: ['h'], cert: './{{ENV}}/c.pem', key: 'k' }, { projectRoot: '/proj', readFile: read }),
    ).rejects.toThrow('"cert" uses {{ENV}}, which is not set')
  })
})

