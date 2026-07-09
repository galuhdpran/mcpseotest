/**
 * The consent / login screen for the built-in authorization server.
 *
 * Because the MCP server authenticates as a single central Google account,
 * there are no per-user identities to log in with. The consent step is purely a
 * gate: the user proves they're allowed to connect by entering a credential —
 * either the shared team password (MCP_OAUTH_PASSWORD) or any personal token
 * from MCP_AUTH_TOKENS (so individual tokens can still be revoked).
 *
 * Flow: the SDK's /authorize handler calls provider.authorize(), which renders
 * renderConsentPage() carrying a signed `authreq`. The form POSTs to
 * /oauth/consent (this router), which validates the credential, mints an
 * authorization code, and redirects back to the client's redirect_uri.
 */
import { Router, urlencoded, type Request, type Response } from 'express';
import { timingSafeEqual } from 'node:crypto';

import { config } from '../config.js';
import { signAuthCode, verifyAuthRequest } from './tokens.js';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

const PAGE_STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    margin: 0; min-height: 100vh; display: flex; align-items: center;
    justify-content: center; background: #f5f5f7; color: #1d1d1f; padding: 24px;
  }
  .card {
    width: 100%; max-width: 400px; background: #fff; border-radius: 14px;
    padding: 28px; box-shadow: 0 8px 30px rgba(0,0,0,.08);
  }
  h1 { font-size: 20px; margin: 0 0 6px; }
  p { font-size: 14px; line-height: 1.5; color: #555; margin: 0 0 18px; }
  .host { font-weight: 600; color: #1d1d1f; }
  label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; }
  input[type=password] {
    width: 100%; padding: 11px 12px; font-size: 15px; border: 1px solid #ccc;
    border-radius: 9px; background: #fff; color: #1d1d1f;
  }
  button {
    width: 100%; margin-top: 18px; padding: 12px; font-size: 15px; font-weight: 600;
    border: 0; border-radius: 9px; background: #1a1a1a; color: #fff; cursor: pointer;
  }
  button:hover { background: #000; }
  .error {
    background: #fdecec; color: #b3261e; font-size: 13px; padding: 10px 12px;
    border-radius: 9px; margin-bottom: 16px;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #1a1a1a; color: #f5f5f7; }
    .card { background: #262626; box-shadow: none; }
    p { color: #b0b0b0; } .host { color: #f5f5f7; }
    input[type=password] { background: #1a1a1a; color: #f5f5f7; border-color: #444; }
    button { background: #f5f5f7; color: #1a1a1a; } button:hover { background: #fff; }
    .error { background: #3a1f1e; color: #f2b8b5; }
  }
`;

export interface ConsentPageOptions {
  clientName: string;
  redirectHost: string;
  authRequest: string;
  error?: string;
}

export function renderConsentPage(opts: ConsentPageOptions): string {
  const client = escapeHtml(opts.clientName);
  const host = escapeHtml(opts.redirectHost);
  const authReq = escapeHtml(opts.authRequest);
  const errorHtml = opts.error
    ? `<div class="error">${escapeHtml(opts.error)}</div>`
    : '';
  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sambungkan ke SEO MCP</title>
  <style>${PAGE_STYLE}</style>
</head>
<body>
  <div class="card">
    <h1>Sambungkan ke SEO MCP</h1>
    <p><strong>${client}</strong> (<span class="host">${host}</span>) meminta akses
       ke server SEO MCP (Search Console &amp; Analytics, read-only).
       Masukkan password tim atau token pribadimu untuk menyetujui.</p>
    ${errorHtml}
    <form method="POST" action="/oauth/consent">
      <input type="hidden" name="authreq" value="${authReq}" />
      <label for="credential">Password / token</label>
      <input id="credential" name="credential" type="password" autocomplete="off"
             autofocus required />
      <button type="submit">Setujui &amp; sambungkan</button>
    </form>
  </div>
</body>
</html>`;
}

function renderErrorPage(message: string): string {
  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>SEO MCP</title><style>${PAGE_STYLE}</style></head>
<body><div class="card"><h1>Tidak bisa melanjutkan</h1>
<p>${escapeHtml(message)}</p></div></body></html>`;
}

/** Constant-time check against the shared password and every personal token. */
function isValidCredential(presented: string): boolean {
  if (!presented) return false;
  const candidates = [...config.authTokens];
  if (config.oauth.loginPassword) candidates.push(config.oauth.loginPassword);

  const presentedBuf = Buffer.from(presented);
  let ok = false;
  for (const candidate of candidates) {
    const candidateBuf = Buffer.from(candidate);
    if (
      candidateBuf.length === presentedBuf.length &&
      timingSafeEqual(candidateBuf, presentedBuf)
    ) {
      ok = true;
    }
  }
  return ok;
}

/**
 * Router for the consent form POST. Mounted at the app root; uses its own
 * urlencoded body parser so it works alongside the global JSON parser.
 */
export function consentRouter(): Router {
  const router = Router();

  router.post(
    '/oauth/consent',
    urlencoded({ extended: false }),
    (req: Request, res: Response): void => {
      const authRequest = typeof req.body?.authreq === 'string' ? req.body.authreq : '';
      const credential =
        typeof req.body?.credential === 'string' ? req.body.credential : '';

      const authReq = verifyAuthRequest(authRequest);
      if (!authReq) {
        res
          .status(400)
          .type('html')
          .send(
            renderErrorPage(
              'Permintaan otorisasi tidak valid atau sudah kedaluwarsa. ' +
                'Silakan ulangi dari Claude.',
            ),
          );
        return;
      }

      if (!isValidCredential(credential)) {
        res
          .status(401)
          .type('html')
          .send(
            renderConsentPage({
              clientName: authReq.client_name ?? 'MCP Client',
              redirectHost: new URL(authReq.redirect_uri).host,
              authRequest,
              error: 'Password atau token salah. Coba lagi.',
            }),
          );
        return;
      }

      const code = signAuthCode({
        client_id: authReq.client_id,
        redirect_uri: authReq.redirect_uri,
        code_challenge: authReq.code_challenge,
        scope: authReq.scope,
        resource: authReq.resource,
      });

      const redirect = new URL(authReq.redirect_uri);
      redirect.searchParams.set('code', code);
      if (authReq.state) redirect.searchParams.set('state', authReq.state);
      res.redirect(302, redirect.href);
    },
  );

  return router;
}
