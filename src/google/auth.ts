/**
 * Loads Google credentials and hands out authenticated clients for GSC (via
 * googleapis) and GA4 (via the analytics client libs).
 *
 * Two auth modes, chosen automatically by which env vars are present:
 *   - oauth           → authenticate AS a central Google account (agency Gmail
 *                       that clients add as a Viewer). Preferred for agencies.
 *   - service_account → authenticate as a service-account robot email.
 *
 * Read-only scopes only — this server never writes to Google.
 */
import { google } from 'googleapis';
import { readFileSync } from 'node:fs';
import { config } from '../config.js';

/** OAuth2 client type, sourced from googleapis' bundled auth library. */
type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/analytics.readonly',
];

export type AuthMode = 'oauth' | 'service_account';

/** Any client googleapis' `auth` option / gax's `authClient` accept. */
export type UnifiedAuthClient =
  | OAuth2Client
  | InstanceType<typeof google.auth.GoogleAuth>;

// ---------------------------------------------------------------------------
// Mode selection
// ---------------------------------------------------------------------------

/** True when all three OAuth env vars are present. */
function hasOAuthConfig(): boolean {
  const { clientId, clientSecret, refreshToken } = config.google.oauth;
  return Boolean(clientId && clientSecret && refreshToken);
}

/** True when any service-account credential source is configured. */
function hasServiceAccountConfig(): boolean {
  const { credentialsJson, credentialsBase64, credentialsPath } = config.google;
  return Boolean(credentialsJson || credentialsBase64 || credentialsPath);
}

/**
 * Which auth mode the server runs in. OAuth wins if configured, so an agency
 * can flip to the central account just by setting the OAuth env vars.
 */
export function getAuthMode(): AuthMode {
  if (hasOAuthConfig()) return 'oauth';
  if (hasServiceAccountConfig()) return 'service_account';
  throw new Error(
    'No Google auth configured. Set the GOOGLE_OAUTH_* vars (run ' +
      '`npm run oauth:login`) or a service-account credential ' +
      '(GOOGLE_CREDENTIALS_JSON / _BASE64 / GOOGLE_APPLICATION_CREDENTIALS).',
  );
}

// ---------------------------------------------------------------------------
// OAuth2 (central account)
// ---------------------------------------------------------------------------

let cachedOAuthClient: OAuth2Client | null = null;

/**
 * OAuth2 client seeded with the central account's refresh token. The library
 * transparently exchanges it for access tokens and refreshes them as needed.
 */
export function getOAuthClient(): OAuth2Client {
  if (cachedOAuthClient) return cachedOAuthClient;
  const { clientId, clientSecret, refreshToken } = config.google.oauth;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'OAuth mode requires GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, ' +
        'and GOOGLE_OAUTH_REFRESH_TOKEN. Run `npm run oauth:login` to obtain them.',
    );
  }
  const client = new google.auth.OAuth2(clientId, clientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  cachedOAuthClient = client;
  return client;
}

// ---------------------------------------------------------------------------
// Service account
// ---------------------------------------------------------------------------

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  project_id?: string;
  [key: string]: unknown;
}

let cachedCredentials: ServiceAccountCredentials | null = null;

/**
 * Resolve service-account credentials from whichever env source is configured.
 * Order: explicit JSON string → base64 → key file path.
 */
function loadCredentials(): ServiceAccountCredentials {
  if (cachedCredentials) return cachedCredentials;

  const { credentialsJson, credentialsBase64, credentialsPath } = config.google;

  let jsonText: string | undefined;

  if (credentialsJson) {
    jsonText = credentialsJson;
  } else if (credentialsBase64) {
    jsonText = Buffer.from(credentialsBase64, 'base64').toString('utf-8');
  } else if (credentialsPath) {
    jsonText = readFileSync(credentialsPath, 'utf-8');
  } else {
    throw new Error(
      'No service-account credentials configured. Set one of ' +
        'GOOGLE_CREDENTIALS_JSON, GOOGLE_CREDENTIALS_BASE64, or ' +
        'GOOGLE_APPLICATION_CREDENTIALS.',
    );
  }

  let parsed: ServiceAccountCredentials;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(
      'Google credentials are not valid JSON. If using base64, check the encoding.',
    );
  }

  if (!parsed.client_email || !parsed.private_key) {
    throw new Error(
      'Google credentials JSON is missing client_email or private_key.',
    );
  }

  cachedCredentials = parsed;
  return parsed;
}

let cachedGoogleAuth: InstanceType<typeof google.auth.GoogleAuth> | null = null;

/**
 * A GoogleAuth instance for the service account, built from googleapis' own
 * bundled google-auth-library so its type matches google.searchconsole().
 */
function getServiceAccountAuth(): InstanceType<typeof google.auth.GoogleAuth> {
  if (cachedGoogleAuth) return cachedGoogleAuth;
  const credentials = loadCredentials();
  cachedGoogleAuth = new google.auth.GoogleAuth({
    credentials,
    scopes: GOOGLE_SCOPES,
  });
  return cachedGoogleAuth;
}

/** Credentials shaped for the @google-analytics/* client constructors. */
export function getAnalyticsClientCredentials(): {
  client_email: string;
  private_key: string;
} {
  const credentials = loadCredentials();
  return {
    client_email: credentials.client_email,
    private_key: credentials.private_key,
  };
}

// ---------------------------------------------------------------------------
// Unified accessors used by the GSC / GA4 wrappers
// ---------------------------------------------------------------------------

/**
 * The auth client to pass to googleapis (`auth`) and gax (`authClient`).
 * Returns an OAuth2 client in oauth mode, or the service-account GoogleAuth
 * instance otherwise. Both are accepted by both libraries.
 */
export function getUnifiedAuthClient(): UnifiedAuthClient {
  return getAuthMode() === 'oauth'
    ? getOAuthClient()
    : getServiceAccountAuth();
}

/** Human-readable identity for startup logs and error hints. */
export function getIdentityLabel(): string {
  try {
    if (getAuthMode() === 'oauth') {
      return 'OAuth central account (via refresh token)';
    }
    return `service account ${loadCredentials().client_email}`;
  } catch {
    return 'the configured Google identity';
  }
}
