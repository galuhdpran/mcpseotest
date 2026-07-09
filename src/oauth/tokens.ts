/**
 * Signed, self-describing tokens for the built-in OAuth authorization server.
 *
 * The MCP server is BOTH the authorization server and the resource server, so
 * every OAuth artefact it hands out (client_id, authorization code, access /
 * refresh token, and the internal "auth request" carried through the consent
 * screen) is opaque to the client. We therefore encode each as a compact,
 * HMAC-signed token instead of persisting state:
 *
 *   base64url(JSON payload) + "." + base64url(HMAC-SHA256(secret, part1))
 *
 * Every payload carries a `typ` discriminator and an `exp` (epoch seconds).
 * Being stateless, this survives process restarts (Claude keeps working across
 * deploys) at the cost of not supporting hard revocation before expiry — an
 * acceptable trade for an internal, read-only tool. Secret: MCP_OAUTH_JWT_SECRET.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

export type OAuthTokenType = 'client' | 'code' | 'access' | 'refresh' | 'authreq';

/** Time-to-live per token type, in seconds. */
export const TTL_SECONDS: Record<OAuthTokenType, number> = {
  client: 365 * 24 * 60 * 60, // 1 year — Claude reuses the DCR client_id
  code: 60, // authorization code: single short round-trip
  access: 60 * 60, // 1 hour
  refresh: 30 * 24 * 60 * 60, // 30 days
  authreq: 10 * 60, // consent screen lifetime
};

export interface SignedPayload {
  typ: OAuthTokenType;
  iat: number;
  exp: number;
  [key: string]: unknown;
}

// --- Claim shapes (single source of truth, shared by provider + consent) ------

export interface ClientClaims {
  redirect_uris: string[];
  client_name?: string;
  scope?: string;
}

export interface AuthRequestClaims {
  client_id: string;
  client_name?: string;
  redirect_uri: string;
  code_challenge: string;
  state?: string;
  scope?: string;
  resource?: string;
}

export interface AuthCodeClaims {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope?: string;
  resource?: string;
}

export interface AccessOrRefreshClaims {
  client_id: string;
  scope?: string;
  resource?: string;
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function secretOrNull(): string | null {
  return config.oauth.jwtSecret ?? null;
}

/** Low-level sign. Throws if no signing secret is configured. */
function sign(typ: OAuthTokenType, claims: Record<string, unknown>): string {
  const secret = secretOrNull();
  if (!secret) {
    throw new Error(
      'MCP_OAUTH_JWT_SECRET is not set; cannot mint OAuth tokens. ' +
        'This code path should only run when OAuth mode is enabled.',
    );
  }
  const payload: SignedPayload = {
    ...claims,
    typ,
    iat: nowSeconds(),
    exp: nowSeconds() + TTL_SECONDS[typ],
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const mac = createHmac('sha256', secret).update(body).digest();
  return `${body}.${mac.toString('base64url')}`;
}

/**
 * Low-level verify: constant-time signature check, type match, and expiry.
 * Returns the payload or null (never throws) so callers can fall through to
 * other credential types.
 */
function verify(token: string, expectedType: OAuthTokenType): SignedPayload | null {
  const secret = secretOrNull();
  if (!secret) return null;

  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const macPart = token.slice(dot + 1);

  const expected = createHmac('sha256', secret).update(body).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(macPart, 'base64url');
  } catch {
    return null;
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }

  let payload: SignedPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SignedPayload;
  } catch {
    return null;
  }
  if (payload.typ !== expectedType) return null;
  if (typeof payload.exp !== 'number' || payload.exp < nowSeconds()) return null;
  return payload;
}

// --- Typed wrappers -----------------------------------------------------------

export function signClientId(claims: ClientClaims): string {
  return sign('client', { ...claims });
}
export function verifyClientId(token: string): (SignedPayload & ClientClaims) | null {
  return verify(token, 'client') as (SignedPayload & ClientClaims) | null;
}

export function signAuthRequest(claims: AuthRequestClaims): string {
  return sign('authreq', { ...claims });
}
export function verifyAuthRequest(token: string): (SignedPayload & AuthRequestClaims) | null {
  return verify(token, 'authreq') as (SignedPayload & AuthRequestClaims) | null;
}

export function signAuthCode(claims: AuthCodeClaims): string {
  return sign('code', { ...claims });
}
export function verifyAuthCode(token: string): (SignedPayload & AuthCodeClaims) | null {
  return verify(token, 'code') as (SignedPayload & AuthCodeClaims) | null;
}

export function signAccessToken(claims: AccessOrRefreshClaims): string {
  return sign('access', { ...claims });
}
export function verifyAccessTokenSig(
  token: string,
): (SignedPayload & AccessOrRefreshClaims) | null {
  return verify(token, 'access') as (SignedPayload & AccessOrRefreshClaims) | null;
}

export function signRefreshToken(claims: AccessOrRefreshClaims): string {
  return sign('refresh', { ...claims });
}
export function verifyRefreshToken(
  token: string,
): (SignedPayload & AccessOrRefreshClaims) | null {
  return verify(token, 'refresh') as (SignedPayload & AccessOrRefreshClaims) | null;
}
