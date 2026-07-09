/**
 * One-time OAuth login to obtain a refresh token for the central Google account.
 *
 * Run:  npm run oauth:login
 *
 * Requires GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in the
 * environment (or .env). Opens a local callback server, walks you through the
 * Google consent screen, and prints the refresh token to paste into .env as
 * GOOGLE_OAUTH_REFRESH_TOKEN.
 *
 * Log in as the account clients add as a Viewer (e.g. revincolabs@gmail.com).
 */
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { google } from 'googleapis';

/**
 * Minimal .env loader (this script runs standalone, outside the server, and we
 * don't want a dotenv dependency). Only sets vars not already in the env.
 */
function loadDotEnv(path = '.env'): void {
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch {
    return; // no .env — rely on the actual environment
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();

// Read-only scopes — kept in sync with src/google/auth.ts on purpose (this
// script runs standalone, so we avoid importing the server config here).
const SCOPES = [
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/analytics.readonly',
];

const PORT = Number(process.env.OAUTH_LOGIN_PORT ?? 5555);
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

function envOrExit(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    console.error(`\nMissing ${name}.`);
    console.error(
      'Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET first ' +
        '(from your Google Cloud OAuth client), then re-run.\n',
    );
    process.exit(1);
  }
  return value.trim();
}

async function main(): Promise<void> {
  const clientId = envOrExit('GOOGLE_OAUTH_CLIENT_ID');
  const clientSecret = envOrExit('GOOGLE_OAUTH_CLIENT_SECRET');

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline', // needed to receive a refresh token
    prompt: 'consent', // force a refresh token even on repeat logins
    scope: SCOPES,
  });

  console.log('\n=== SEO MCP — OAuth login ===\n');
  console.log(`Make sure your OAuth client has this redirect URI:\n  ${REDIRECT_URI}\n`);
  console.log('1. Open this URL in a browser (log in as the CENTRAL account):\n');
  console.log(`   ${authUrl}\n`);
  console.log(`2. After approving, you'll be redirected back here.\n`);
  console.log(`Waiting for the callback on ${REDIRECT_URI} ...\n`);

  const code = await waitForCode();

  const { tokens } = await oauth2.getToken(code);

  if (!tokens.refresh_token) {
    console.error(
      '\nNo refresh token returned. This usually means you approved before ' +
        'without prompt=consent. Revoke access at ' +
        'https://myaccount.google.com/permissions and run this again.\n',
    );
    process.exit(1);
  }

  console.log('\n✅ Success! Add this line to your .env:\n');
  console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  console.log(
    'Keep GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET set too, then ' +
      'restart the server.\n',
  );
  process.exit(0);
}

/** Start a one-shot local server and resolve with the OAuth `code` param. */
function waitForCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url || !req.url.startsWith('/oauth2callback')) {
        res.writeHead(404).end('Not found');
        return;
      }
      const url = new URL(req.url, `http://localhost:${PORT}`);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end(`Authorization failed: ${error}. You can close this tab.`);
        server.close();
        reject(new Error(`Authorization failed: ${error}`));
        return;
      }
      if (!code) {
        res.writeHead(400).end('Missing authorization code.');
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        '<html><body style="font-family:sans-serif;padding:2rem">' +
          '<h2>✅ Authorized</h2><p>You can close this tab and return to the terminal.</p>' +
          '</body></html>',
      );
      server.close();
      resolve(code);
    });

    server.on('error', reject);
    server.listen(PORT);
  });
}

main().catch((err) => {
  console.error('\nOAuth login failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
