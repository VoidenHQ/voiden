import type {
  JwtAlgorithm,
  JwtHeader,
  JwtPayload,
  DecodedJwt,
} from './types';

/**
 * Base64Url encode string / Uint8Array
 */
export function base64urlEncode(input: string | Uint8Array): string {
  let base64 = '';
  if (typeof input === 'string') {
    // UTF-8 encode string to base64
    const encoder = new TextEncoder();
    const bytes = encoder.encode(input);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    base64 = btoa(binary);
  } else {
    let binary = '';
    for (let i = 0; i < input.byteLength; i++) {
      binary += String.fromCharCode(input[i]);
    }
    base64 = btoa(binary);
  }

  return base64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Base64Url decode string
 */
export function base64urlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const decoder = new TextDecoder();
  return decoder.decode(bytes);
}

/**
 * Get hash algorithm name for Web Crypto
 */
function getHashName(algorithm: JwtAlgorithm): string {
  switch (algorithm) {
    case 'HS256':
      return 'SHA-256';
    case 'HS384':
      return 'SHA-384';
    case 'HS512':
      return 'SHA-512';
    default:
      throw new Error(`Unsupported HMAC algorithm: ${algorithm}`);
  }
}

/**
 * Sign HMAC signature using Web Crypto API
 */
export async function signHmac(
  algorithm: 'HS256' | 'HS384' | 'HS512',
  secret: string,
  data: string
): Promise<string> {
  const hashName = getHashName(algorithm);
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: { name: hashName } },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    encoder.encode(data)
  );

  return base64urlEncode(new Uint8Array(signatureBuffer));
}

/**
 * Generate JWT string from Header, Payload, Secret, and Algorithm
 */
export async function generateJwt(
  header: JwtHeader,
  payload: JwtPayload,
  secret: string,
  algorithm: JwtAlgorithm = 'HS256'
): Promise<string> {
  const fullHeader: JwtHeader = {
    ...header,
    typ: header.typ || 'JWT',
    alg: algorithm,
  };

  const encodedHeader = base64urlEncode(JSON.stringify(fullHeader));
  const encodedPayload = base64urlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  if (algorithm === 'none') {
    return `${signingInput}.`;
  }

  if (!secret) {
    throw new Error(`Secret key is required for ${algorithm} signing`);
  }

  const signature = await signHmac(algorithm, secret, signingInput);
  return `${signingInput}.${signature}`;
}

/**
 * Decode JWT token into Header, Payload, and Signature
 */
export function decodeJwt(token: string): DecodedJwt {
  if (!token || typeof token !== 'string') {
    return {
      header: { alg: 'none', typ: 'JWT' },
      payload: {},
      signature: '',
      rawHeader: '',
      rawPayload: '',
      isValid: false,
      error: 'Token string is empty',
    };
  }

  const parts = token.trim().split('.');
  if (parts.length < 2 || parts.length > 3) {
    return {
      header: { alg: 'none', typ: 'JWT' },
      payload: {},
      signature: '',
      rawHeader: '',
      rawPayload: '',
      isValid: false,
      error: 'Invalid JWT format: must contain header, payload, and signature sections',
    };
  }

  try {
    const rawHeader = base64urlDecode(parts[0]);
    const rawPayload = base64urlDecode(parts[1]);
    const signature = parts[2] || '';

    const header = JSON.parse(rawHeader);
    const payload = JSON.parse(rawPayload);

    return {
      header,
      payload,
      signature,
      rawHeader,
      rawPayload,
      isValid: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      header: { alg: 'none', typ: 'JWT' },
      payload: {},
      signature: parts[2] || '',
      rawHeader: parts[0] || '',
      rawPayload: parts[1] || '',
      isValid: false,
      error: `Failed to decode JWT: ${msg}`,
    };
  }
}

/**
 * Calculate epoch timestamp in seconds for claims
 */
export function getClaimTimestamp(offsetSeconds: number = 0): number {
  return Math.floor(Date.now() / 1000) + offsetSeconds;
}
