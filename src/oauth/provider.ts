/**
 * A self-contained OAuth 2.1 authorization server, implemented against the
 * MCP SDK's OAuthServerProvider interface so the SDK's mcpAuthRouter can expose
 * the standard /authorize, /token, /register, /revoke, and metadata endpoints.
 *
 * Design notes:
 *  - Stateless: clients, codes, and tokens are all signed tokens (see tokens.ts),
 *    so there is no store to persist and nothing is lost across restarts.
 *  - Consent is a gate, not a per-user login — see consent.ts.
 *  - PKCE (S256) is verified by the SDK's token handler; we only stash and
 *    return the code_challenge via challengeForAuthorizationCode().
 *  - verifyAccessToken() also accepts the legacy static MCP_AUTH_TOKENS so the
 *    existing Claude Code / Desktop setups keep working unchanged.
 */
import { timingSafeEqual } from 'node:crypto';
import type { Response } from 'express';

import type {
  AuthorizationParams,
  OAuthServerProvider,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { InvalidGrantError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

import { config } from '../config.js';
import { renderConsentPage } from './consent.js';
import {
  nowSeconds,
  signAccessToken,
  signAuthRequest,
  signClientId,
  signRefreshToken,
  TTL_SECONDS,
  verifyAccessTokenSig,
  verifyAuthCode,
  verifyClientId,
  verifyRefreshToken,
} from './tokens.js';

const STATIC_TOKEN_TTL = 365 * 24 * 60 * 60; // synthetic expiry for legacy tokens

/** Constant-time membership test against the legacy static bearer tokens. */
function isStaticToken(presented: string): boolean {
  const presentedBuf = Buffer.from(presented);
  let ok = false;
  for (const token of config.authTokens) {
    const tokenBuf = Buffer.from(token);
    if (
      tokenBuf.length === presentedBuf.length &&
      timingSafeEqual(tokenBuf, presentedBuf)
    ) {
      ok = true;
    }
  }
  return ok;
}

export class SeoOAuthProvider implements OAuthServerProvider {
  private readonly _clientsStore: OAuthRegisteredClientsStore = {
    // The client_id IS a signed token encoding the client metadata, so lookups
    // are stateless: decode it and rebuild the client info.
    getClient: (clientId: string): OAuthClientInformationFull | undefined => {
      const claims = verifyClientId(clientId);
      if (!claims) return undefined;
      return {
        client_id: clientId,
        redirect_uris: claims.redirect_uris,
        client_name: claims.client_name,
        scope: claims.scope,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      };
    },

    // Dynamic Client Registration: ignore the library-generated random id and
    // return our own signed client_id. Claude registers as a public client.
    registerClient: (
      client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>,
    ): OAuthClientInformationFull => {
      const clientId = signClientId({
        redirect_uris: client.redirect_uris,
        client_name: client.client_name,
        scope: client.scope,
      });
      return {
        ...client,
        client_id: clientId,
        client_id_issued_at: nowSeconds(),
        client_secret: undefined,
        client_secret_expires_at: undefined,
      };
    },
  };

  get clientsStore(): OAuthRegisteredClientsStore {
    return this._clientsStore;
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const authRequest = signAuthRequest({
      client_id: client.client_id,
      client_name: client.client_name,
      redirect_uri: params.redirectUri,
      code_challenge: params.codeChallenge,
      state: params.state,
      scope: params.scopes?.join(' '),
      resource: params.resource?.href,
    });
    res.type('html').send(
      renderConsentPage({
        clientName: client.client_name ?? 'MCP Client',
        redirectHost: new URL(params.redirectUri).host,
        authRequest,
      }),
    );
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const code = verifyAuthCode(authorizationCode);
    if (!code || code.client_id !== client.client_id) {
      throw new InvalidGrantError('Invalid or expired authorization code');
    }
    return code.code_challenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const code = verifyAuthCode(authorizationCode);
    if (!code || code.client_id !== client.client_id) {
      throw new InvalidGrantError('Invalid or expired authorization code');
    }
    if (redirectUri && redirectUri !== code.redirect_uri) {
      throw new InvalidGrantError('redirect_uri does not match the authorization request');
    }
    return this.issueTokens(client.client_id, code.scope, code.resource ?? resource?.href);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const claims = verifyRefreshToken(refreshToken);
    if (!claims || claims.client_id !== client.client_id) {
      throw new InvalidGrantError('Invalid or expired refresh token');
    }
    const scope = scopes && scopes.length > 0 ? scopes.join(' ') : claims.scope;
    return this.issueTokens(client.client_id, scope, claims.resource ?? resource?.href);
  }

  private issueTokens(
    clientId: string,
    scope: string | undefined,
    resource: string | undefined,
  ): OAuthTokens {
    return {
      access_token: signAccessToken({ client_id: clientId, scope, resource }),
      token_type: 'Bearer',
      expires_in: TTL_SECONDS.access,
      scope,
      refresh_token: signRefreshToken({ client_id: clientId, scope, resource }),
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    // 1) An access token minted by this server.
    const access = verifyAccessTokenSig(token);
    if (access) {
      const expected = config.oauth.resource;
      if (expected && access.resource && access.resource !== expected) {
        throw new InvalidTokenError('Token audience does not match this resource');
      }
      return {
        token,
        clientId: access.client_id,
        scopes: access.scope ? access.scope.split(' ') : [],
        expiresAt: access.exp,
        resource: access.resource ? new URL(access.resource) : undefined,
      };
    }

    // 2) A legacy static bearer token (Claude Code / Desktop). Synthesise a
    //    long-lived AuthInfo so requireBearerAuth's expiry check passes.
    if (isStaticToken(token)) {
      return {
        token,
        clientId: 'static',
        scopes: [],
        expiresAt: nowSeconds() + STATIC_TOKEN_TTL,
        resource: config.oauth.resource ? new URL(config.oauth.resource) : undefined,
      };
    }

    throw new InvalidTokenError('Invalid or expired token');
  }

  // Stateless tokens can't be revoked before expiry; nothing to do.
  async revokeToken(
    _client: OAuthClientInformationFull,
    _request: OAuthTokenRevocationRequest,
  ): Promise<void> {}
}
