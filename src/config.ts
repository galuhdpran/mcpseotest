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
 * Bearer tokens accepted by the /mcp endpoint. Comma-separated so you can
 * issue one token per teammate and revoke individually.
 */
function parseTokens(): string[] {
  const raw = required('MCP_AUTH_TOKENS');
  const tokens = raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) {
    throw new Error('MCP_AUTH_TOKENS must contain at least one non-empty token.');
  }
  return tokens;
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

export type Config = typeof config;
