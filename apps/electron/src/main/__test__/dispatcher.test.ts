import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fetch } from 'undici';
import { getDispatcher } from '../ipc/dispatcher';

const hasOpenssl = (() => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('getDispatcher', () => {
  it('builds a plain agent without a proxy', () => {
    const { dispatcher, proxyInfo } = getDispatcher({}, 'https://example.com');
    expect(dispatcher).toBeDefined();
    expect(proxyInfo).toBeUndefined();
  });

  it('reports the active proxy and bypasses it for excluded domains', () => {
    const settings = {
      proxy: {
        enabled: true,
        activeProxyId: 'p1',
        proxies: [{ id: 'p1', name: 'corp', host: 'proxy.local', port: 3128, excludedDomains: ['*.internal'] }],
      },
    };
    expect(getDispatcher(settings, 'https://example.com').proxyInfo).toEqual({ name: 'corp', host: 'proxy.local', port: 3128 });
    expect(getDispatcher(settings, 'https://api.internal').proxyInfo).toBeUndefined();
  });
});

describe.skipIf(!hasOpenssl)('getDispatcher with a client certificate (mTLS)', () => {
  let dir: string;
  let server: https.Server;
  let proxy: http.Server;
  let port: number;
  let proxyPort: number;
  const seen: (string | null)[] = [];
  const read = (name: string) => fs.readFileSync(path.join(dir, name));
  const openssl = (...args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: 'ignore' });

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voiden-dispatcher-'));
    openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-subj', '/CN=voiden-test-ca', '-days', '2');
    fs.writeFileSync(path.join(dir, 'san.cnf'), 'subjectAltName=DNS:localhost,IP:127.0.0.1\n');
    openssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=localhost');
    openssl('x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'server.pem', '-days', '2', '-extfile', 'san.cnf');
    openssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'client.key', '-out', 'client.csr', '-subj', '/CN=voiden-client');
    openssl('x509', '-req', '-in', 'client.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'client.pem', '-days', '2');

    server = https.createServer(
      { cert: read('server.pem'), key: read('server.key'), ca: read('ca.pem'), requestCert: true, rejectUnauthorized: true },
      (req, res) => {
        seen.push((req.socket as any).getPeerCertificate?.()?.subject?.CN ?? null);
        res.end('ok');
      },
    );
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as net.AddressInfo).port;

    // Minimal CONNECT proxy: tunnels bytes without touching TLS.
    proxy = http.createServer();
    proxy.on('connect', (req, clientSocket, head) => {
      const [host, p] = String(req.url).split(':');
      const upstream = net.connect(Number(p), host, () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        upstream.write(head);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      });
      upstream.on('error', () => clientSocket.destroy());
      clientSocket.on('error', () => upstream.destroy());
    });
    await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
    proxyPort = (proxy.address() as net.AddressInfo).port;
  });

  afterAll(async () => {
    proxy.closeAllConnections?.();
    server.closeAllConnections?.();
    await new Promise<void>((r) => proxy.close(() => r()));
    await new Promise<void>((r) => server.close(() => r()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const tls = () => ({ cert: read('client.pem'), key: read('client.key'), ca: read('ca.pem') });
  const url = () => `https://localhost:${port}/`;

  it('presents the client certificate to the server', async () => {
    seen.length = 0;
    const { dispatcher } = getDispatcher({}, url(), tls());
    const res = await fetch(url(), { dispatcher });
    expect(await res.text()).toBe('ok');
    expect(seen).toEqual(['voiden-client']);
  });

  it('fails the handshake when no certificate is configured', async () => {
    const { dispatcher } = getDispatcher({ requests: { disable_tls_verification: true } }, url());
    await expect(fetch(url(), { dispatcher })).rejects.toThrow();
  });

  it('keeps honouring disable_tls_verification alongside a client certificate', async () => {
    seen.length = 0;
    const { cert, key } = tls(); // no CA: the server certificate would not verify
    const { dispatcher } = getDispatcher({ requests: { disable_tls_verification: true } }, url(), { cert, key });
    expect(await (await fetch(url(), { dispatcher })).text()).toBe('ok');
    expect(seen).toEqual(['voiden-client']);
  });

  it('presents the client certificate to the target through an HTTP proxy', async () => {
    seen.length = 0;
    const settings = {
      proxy: { enabled: true, activeProxyId: 'p', proxies: [{ id: 'p', name: 'local', host: '127.0.0.1', port: proxyPort }] },
    };
    const { dispatcher, proxyInfo } = getDispatcher(settings, url(), tls());
    expect(proxyInfo?.name).toBe('local');
    const res = await fetch(url(), { dispatcher });
    expect(await res.text()).toBe('ok');
    expect(seen).toEqual(['voiden-client']);
  });
});
