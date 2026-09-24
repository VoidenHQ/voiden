// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  base64urlEncode,
  base64urlDecode,
  generateJwt,
  decodeJwt,
  getClaimTimestamp,
} from '../utils/jwtUtils';

describe('JWT Faker - Base64Url Utilities', () => {
  it('encodes and decodes strings to base64url', () => {
    const input = 'Hello World! @Voiden/JWT-Faker';
    const encoded = base64urlEncode(input);
    expect(encoded).not.toContain('=');
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');

    const decoded = base64urlDecode(encoded);
    expect(decoded).toBe(input);
  });
});

describe('JWT Faker - Token Generation (HS256, HS384, HS512, none)', () => {
  const secret = 'super-secret-key-1234567890';
  const payload = {
    sub: 'user_123',
    email: 'dev@voiden.io',
    role: 'admin',
  };

  it('generates a valid HS256 signed JWT token', async () => {
    const token = await generateJwt({ alg: 'HS256', typ: 'JWT' }, payload, secret, 'HS256');
    const parts = token.split('.');
    expect(parts.length).toBe(3);
    expect(parts[0].length).toBeGreaterThan(0);
    expect(parts[1].length).toBeGreaterThan(0);
    expect(parts[2].length).toBeGreaterThan(0);

    const decoded = decodeJwt(token);
    expect(decoded.isValid).toBe(true);
    expect(decoded.header.alg).toBe('HS256');
    expect(decoded.payload.sub).toBe('user_123');
    expect(decoded.payload.email).toBe('dev@voiden.io');
    expect(decoded.payload.role).toBe('admin');
  });

  it('generates a valid HS384 signed JWT token', async () => {
    const token = await generateJwt({ alg: 'HS384', typ: 'JWT' }, payload, secret, 'HS384');
    const parts = token.split('.');
    expect(parts.length).toBe(3);

    const decoded = decodeJwt(token);
    expect(decoded.isValid).toBe(true);
    expect(decoded.header.alg).toBe('HS384');
  });

  it('generates a valid HS512 signed JWT token', async () => {
    const token = await generateJwt({ alg: 'HS512', typ: 'JWT' }, payload, secret, 'HS512');
    const parts = token.split('.');
    expect(parts.length).toBe(3);

    const decoded = decodeJwt(token);
    expect(decoded.isValid).toBe(true);
    expect(decoded.header.alg).toBe('HS512');
  });

  it('generates an unsigned (alg: none) JWT token without a signature', async () => {
    const token = await generateJwt({ alg: 'none', typ: 'JWT' }, payload, '', 'none');
    const parts = token.split('.');
    expect(parts.length).toBe(3);
    expect(parts[2]).toBe('');

    const decoded = decodeJwt(token);
    expect(decoded.isValid).toBe(true);
    expect(decoded.header.alg).toBe('none');
    expect(decoded.payload.email).toBe('dev@voiden.io');
  });

  it('throws error when secret is missing for HMAC algorithm', async () => {
    await expect(
      generateJwt({ alg: 'HS256', typ: 'JWT' }, payload, '', 'HS256')
    ).rejects.toThrow('Secret key is required for HS256 signing');
  });
});

describe('JWT Faker - Decoding & Error Handling', () => {
  it('returns invalid state for malformed or empty token strings', () => {
    const emptyResult = decodeJwt('');
    expect(emptyResult.isValid).toBe(false);
    expect(emptyResult.error).toContain('Token string is empty');

    const invalidResult = decodeJwt('not-a-jwt');
    expect(invalidResult.isValid).toBe(false);
    expect(invalidResult.error).toContain('Invalid JWT format');
  });
});

describe('JWT Faker - Claim Timestamp Utilities', () => {
  it('calculates current and offset claim timestamps in seconds', () => {
    const now = Math.floor(Date.now() / 1000);
    const iat = getClaimTimestamp(0);
    const exp = getClaimTimestamp(3600);

    expect(iat).toBeGreaterThanOrEqual(now - 2);
    expect(iat).toBeLessThanOrEqual(now + 2);
    expect(exp - iat).toBe(3600);
  });
});
