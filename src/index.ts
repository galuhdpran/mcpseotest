/**
 * Remote MCP server entrypoint.
 *
 * Exposes a single Streamable HTTP endpoint at POST /mcp, protected by a shared
 * bearer token, in stateless mode (a fresh MCP server + transport per request).
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { config } from './config.js';
import { buildServer } from './mcp/server.js';
import { getAuthMode, getIdentityLabel } from './google/auth.js';

const app = express();
app.use(express.json({ limit: '4mb' }));

/** Reject if none of the configured tokens matches, using constant-time compare. */
function isAuthorized(presented: string): boolean {
  const presentedBuf = Buffer.from(presented);
  let ok = false;
  for (const token of config.authTokens) {
    const tokenBuf = Buffer.from(token);
    // timingSafeEqual throws on length mismatch; guard first but still
    // perform a comparison to keep timing roughly uniform.
    if (
      tokenBuf.length === presentedBuf.length &&
      timingSafeEqual(tokenBuf, presentedBuf)
    ) {
      ok = true;
    }
  }
  return ok;
}

/** Bearer-token gate for the MCP endpoint. */
function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const token = match?.[1]?.trim();

  if (!token || !isAuthorized(token)) {
    res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Unauthorized: valid bearer token required.' },
      id: null,
    });
    return;
  }
  next();
}

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
  try {
    console.log(`  Google auth:    ${getAuthMode()} — ${getIdentityLabel()}`);
  } catch (error) {
    console.warn(
      `  WARNING: could not load Google credentials at startup: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
});
