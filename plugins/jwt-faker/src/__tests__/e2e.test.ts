// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { generateJwt, decodeJwt, getClaimTimestamp } from '../utils/jwtUtils';
import type { JwtHeader } from '../utils/types';

describe('JWT Faker End-to-End Test Suite', () => {
  const secret = 'super-secret-passphrase-key';
  const customHeader: JwtHeader = { alg: 'HS256', typ: 'JWT', custom_header_key: 'test_val' };
  const customPayload = {
    sub: '123456789',
    email: 'john@example.com',
    role: 'admin',
    iat: getClaimTimestamp(0),
    exp: getClaimTimestamp(3600),
  };

  it('e2e: generates and decodes HS256 signed token with full claims', async () => {
    const token = await generateJwt(customHeader, customPayload, secret, 'HS256');
    expect(token).toBeDefined();
    expect(typeof token).toBe('string');

    const decoded = decodeJwt(token);
    expect(decoded.isValid).toBe(true);
    expect(decoded.header.alg).toBe('HS256');
    expect(decoded.header.typ).toBe('JWT');
    expect(decoded.header.custom_header_key).toBe('test_val');
    expect(decoded.payload.sub).toBe('123456789');
    expect(decoded.payload.email).toBe('john@example.com');
    expect(decoded.payload.role).toBe('admin');
    expect(decoded.payload.exp).toBeGreaterThan(decoded.payload.iat!);
  });

  it('e2e: generates and decodes HS384 signed token', async () => {
    const token = await generateJwt(customHeader, customPayload, secret, 'HS384');
    const decoded = decodeJwt(token);
    expect(decoded.isValid).toBe(true);
    expect(decoded.header.alg).toBe('HS384');
  });

  it('e2e: generates and decodes HS512 signed token', async () => {
    const token = await generateJwt(customHeader, customPayload, secret, 'HS512');
    const decoded = decodeJwt(token);
    expect(decoded.isValid).toBe(true);
    expect(decoded.header.alg).toBe('HS512');
  });

  it('e2e: generates and decodes unsigned (alg: none) token', async () => {
    const token = await generateJwt({ alg: 'none', typ: 'JWT' }, customPayload, '', 'none');
    expect(token.endsWith('.')).toBe(true);

    const decoded = decodeJwt(token);
    expect(decoded.isValid).toBe(true);
    expect(decoded.header.alg).toBe('none');
    expect(decoded.signature).toBe('');
  });
});
