/**
 * Loads Google service-account credentials once and hands out authenticated
 * clients for GSC (via googleapis) and GA4 (via the analytics client libs).
 *
 * Read-only scopes only — this server never writes to Google.
 */
import { google } from 'googleapis';
import { readFileSync } from 'node:fs';
import { config } from '../config.js';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/analytics.readonly',
];

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  project_id?: string;
  [key: string]: unknown;
}

let cachedCredentials: ServiceAccountCredentials | null = null;

/**
 * Resolve the raw credentials object from whichever env source is configured.
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
      'No Google credentials configured. Set one of GOOGLE_CREDENTIALS_JSON, ' +
        'GOOGLE_CREDENTIALS_BASE64, or GOOGLE_APPLICATION_CREDENTIALS.',
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

let cachedAuth: InstanceType<typeof google.auth.GoogleAuth> | null = null;

/**
 * A shared GoogleAuth instance built from googleapis' own bundled
 * google-auth-library, so its type matches what google.searchconsole() expects.
 * (A separate top-level google-auth-library copy would be a different, clashing
 * type.) The GA4 client libraries take plain credentials instead — see below.
 */
export function getGoogleAuth(): InstanceType<typeof google.auth.GoogleAuth> {
  if (cachedAuth) return cachedAuth;
  const credentials = loadCredentials();
  cachedAuth = new google.auth.GoogleAuth({
    credentials,
    scopes: GOOGLE_SCOPES,
  });
  return cachedAuth;
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

/** The service-account email — surfaced in errors/onboarding docs. */
export function getServiceAccountEmail(): string {
  return loadCredentials().client_email;
}
