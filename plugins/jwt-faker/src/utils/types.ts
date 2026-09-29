export type JwtAlgorithm = 'HS256' | 'HS384' | 'HS512' | 'none';

export interface JwtHeader {
  alg: JwtAlgorithm;
  typ: string;
  [key: string]: any;
}

export interface JwtPayload {
  sub?: string;
  email?: string;
  role?: string;
  iat?: number;
  exp?: number;
  nbf?: number;
  iss?: string;
  aud?: string;
  [key: string]: any;
}

export interface JwtGeneratorOptions {
  algorithm: JwtAlgorithm;
  secret: string;
  header: JwtHeader;
  payload: JwtPayload;
}

export interface DecodedJwt {
  header: JwtHeader;
  payload: JwtPayload;
  signature: string;
  rawHeader: string;
  rawPayload: string;
  isValid: boolean;
  error?: string;
}

export interface JwtTemplate {
  id: string;
  name: string;
  algorithm: JwtAlgorithm;
  secret: string;
  header: string;
  payload: string;
}
