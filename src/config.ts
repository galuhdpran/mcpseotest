/**
 * Central configuration, parsed and validated once at startup.
 *
 * Everything the server needs comes from environment variables so the same
 * image runs unchanged in local dev, Docker, and any host.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable: ${name}. See .env.example.`,
    );
  }
  return value.trim();
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : undefined;
}

/**
 * Static bearer tokens accepted by the /mcp endpoint (comma-separated), and
 * also accepted as a credential on the OAuth consent screen.
 *
 * OPTIONAL: leave MCP_AUTH_TOKENS unset to disable static-token access entirely
 * so the server is reachable only via the OAuth flow (browser connectors). When
 * unset, MCP_OAUTH_PASSWORD becomes the consent credential (see the guard below).
 */
function parseTokens(): string[] {
  const raw = optional('MCP_AUTH_TOKENS');
  if (!raw) return [];
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export const config = {
  port: Number(process.env.PORT ?? 3000),

  /** Bearer tokens the team uses to reach the MCP endpoint. */
  authTokens: parseTokens(),

  /**
   * Hostnames allowed in the Host header (DNS-rebinding protection).
   * Comma-separated. Include your public domain and any local hosts.
   */
  allowedHosts: (optional('MCP_ALLOWED_HOSTS') ?? 'localhost,127.0.0.1')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean),

  /**
   * Built-in OAuth authorization server, used only to let browser custom
   * connectors on claude.ai connect (they require OAuth, not a static token).
   * Enabled when MCP_PUBLIC_URL + MCP_OAUTH_JWT_SECRET are both set; otherwise
   * the server keeps its static-token-only behaviour.
   *
   * NOTE: this is unrelated to `google.oauth` below — that authenticates the
   * server TO Google; this authenticates Claude TO the server.
   */
  oauth: (() => {
    const publicUrl = optional('MCP_PUBLIC_URL')?.replace(/\/+$/, '');
    const jwtSecret = optional('MCP_OAUTH_JWT_SECRET');
    return {
      /** Public origin of this server, e.g. https://mcpseotest.revincolabs.com */
      publicUrl,
      /** Canonical resource identifier = the MCP endpoint the user connects to. */
      resource: publicUrl ? `${publicUrl}/mcp` : undefined,
      /** HMAC secret for signing OAuth artefacts (client ids, codes, tokens). */
      jwtSecret,
      /** Optional shared team password accepted on the consent screen. */
      loginPassword: optional('MCP_OAUTH_PASSWORD'),
      /** Whether the OAuth authorization server is mounted. */
      enabled: Boolean(publicUrl && jwtSecret),
    };
  })(),

  google: {
    /**
     * Service-account credentials. Provide exactly one of:
     *  - GOOGLE_CREDENTIALS_JSON        raw JSON string
     *  - GOOGLE_CREDENTIALS_BASE64      base64-encoded JSON (handy for env vars)
     *  - GOOGLE_APPLICATION_CREDENTIALS path to a JSON key file
     */
    credentialsJson: optional('GOOGLE_CREDENTIALS_JSON'),
    credentialsBase64: optional('GOOGLE_CREDENTIALS_BASE64'),
    credentialsPath: optional('GOOGLE_APPLICATION_CREDENTIALS'),

    /**
     * OAuth2 "central account" credentials. When all three are set, the server
     * authenticates AS that Google account (e.g. the agency's shared Gmail that
     * clients add as a Viewer) instead of using the service account.
     *
     * Get a refresh token with: npm run oauth:login
     */
    oauth: {
      clientId: optional('GOOGLE_OAUTH_CLIENT_ID'),
      clientSecret: optional('GOOGLE_OAUTH_CLIENT_SECRET'),
      refreshToken: optional('GOOGLE_OAUTH_REFRESH_TOKEN'),
    },
  },
} as const;

// --- Validation ------------------------------------------------------------
// There must be at least one way to authenticate to /mcp.
if (config.authTokens.length === 0 && !config.oauth.enabled) {
  throw new Error(
    'No endpoint auth configured. Set MCP_AUTH_TOKENS, or enable OAuth by ' +
      'setting MCP_PUBLIC_URL and MCP_OAUTH_JWT_SECRET. See .env.example.',
  );
}
// With static tokens disabled, the OAuth consent screen needs a password.
if (
  config.oauth.enabled &&
  config.authTokens.length === 0 &&
  !config.oauth.loginPassword
) {
  throw new Error(
    'OAuth is enabled and MCP_AUTH_TOKENS is empty, so the consent screen has ' +
      'no credential to accept. Set MCP_OAUTH_PASSWORD. See .env.example.',
  );
}

export type Config = typeof config;
