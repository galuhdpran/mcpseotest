/**
 * Remote MCP server entrypoint.
 *
 * Exposes a single Streamable HTTP endpoint at POST /mcp in stateless mode (a
 * fresh MCP server + transport per request). The endpoint is protected by a
 * bearer token that may be either:
 *   - a static token from MCP_AUTH_TOKENS (used by Claude Code CLI / Desktop), or
 *   - an OAuth access token minted by this server's built-in authorization
 *     server (used by browser custom connectors on claude.ai).
 *
 * The OAuth authorization server (metadata, /authorize, /token, /register,
 * /revoke, plus the consent screen) is only mounted when OAuth mode is
 * configured — see config.oauth and src/oauth/*.
 */
import express, { type Request, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthRouter,
} from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';

import { config } from './config.js';
import { buildServer } from './mcp/server.js';
import { getAuthMode, getIdentityLabel } from './google/auth.js';
import { SeoOAuthProvider } from './oauth/provider.js';
import { consentRouter } from './oauth/consent.js';

const app = express();
app.use(express.json({ limit: '4mb' }));

// Verifies both OAuth access tokens and legacy static tokens; also backs the
// OAuth authorization server when it's mounted below.
const oauthProvider = new SeoOAuthProvider();

// When OAuth mode is configured, mount the authorization server so browser
// custom connectors on claude.ai can complete an OAuth flow. Must be at the app
// root per the SDK. resourceMetadataUrl is advertised in 401 responses so
// Claude can discover where to authenticate.
let resourceMetadataUrl: string | undefined;
if (config.oauth.enabled) {
  const issuerUrl = new URL(config.oauth.publicUrl!);
  const resourceUrl = new URL(config.oauth.resource!);
  resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(resourceUrl);
  app.use(
    mcpAuthRouter({
      provider: oauthProvider,
      issuerUrl,
      baseUrl: issuerUrl,
      resourceServerUrl: resourceUrl,
      resourceName: 'SEO MCP',
    }),
  );
  app.use(consentRouter());
}

// Bearer-token gate for the MCP endpoint. On a missing/invalid token it returns
// 401 with a WWW-Authenticate header pointing at resourceMetadataUrl (when set),
// which is what kicks off the OAuth handshake for browser clients.
const requireAuth = requireBearerAuth({
  verifier: oauthProvider,
  resourceMetadataUrl,
});

// Health check (no auth) — for load balancers / uptime monitors.
app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok' });
});

// Main MCP endpoint (stateless Streamable HTTP).
app.post('/mcp', requireAuth, async (req: Request, res: Response) => {
  const server = buildServer();
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      enableJsonResponse: true,
      enableDnsRebindingProtection: true,
      allowedHosts: config.allowedHosts,
    });

    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

// Stateless mode: no server-initiated streams or session teardown.
function methodNotAllowed(_req: Request, res: Response): void {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null,
  });
}
app.get('/mcp', requireAuth, methodNotAllowed);
app.delete('/mcp', requireAuth, methodNotAllowed);

app.listen(config.port, () => {
  console.log(`SEO MCP server listening on port ${config.port}`);
  console.log(`  MCP endpoint:   POST /mcp`);
  console.log(`  Health check:   GET  /healthz`);
  console.log(`  Allowed hosts:  ${config.allowedHosts.join(', ')}`);
  if (config.oauth.enabled) {
    console.log(`  OAuth mode:     on — issuer ${config.oauth.publicUrl}`);
  } else {
    console.log(`  OAuth mode:     off — static bearer token only`);
  }
  try {
    console.log(`  Google auth:    ${getAuthMode()} — ${getIdentityLabel()}`);
  } catch (error) {
    console.warn(
      `  WARNING: could not load Google credentials at startup: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
});
