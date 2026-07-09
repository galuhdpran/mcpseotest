/**
 * Google Search Console (Search Analytics) wrapper.
 *
 * Uses the googleapis `searchconsole` client (v1 of the Search Console API,
 * which supersedes the old `webmasters` name but exposes the same
 * searchanalytics.query endpoint).
 */
import { google, searchconsole_v1 } from 'googleapis';
import { getUnifiedAuthClient } from './auth.js';

let cachedClient: searchconsole_v1.Searchconsole | null = null;

function client(): searchconsole_v1.Searchconsole {
  if (cachedClient) return cachedClient;
  // Works for both an OAuth2 client and a service-account GoogleAuth instance.
  cachedClient = google.searchconsole({
    version: 'v1',
    auth: getUnifiedAuthClient() as Parameters<
      typeof google.searchconsole
    >[0]['auth'],
  });
  return cachedClient;
}

export interface GscSite {
  siteUrl: string;
  permissionLevel: string;
}

/** List every property the service account has been granted access to. */
export async function listSites(): Promise<GscSite[]> {
  const res = await client().sites.list();
  const entries = res.data.siteEntry ?? [];
  return entries.map((e) => ({
    siteUrl: e.siteUrl ?? '',
    permissionLevel: e.permissionLevel ?? 'unknown',
  }));
}

export interface SearchAnalyticsParams {
  siteUrl: string;
  startDate: string;
  endDate: string;
  dimensions?: string[];
  rowLimit?: number;
  startRow?: number;
  searchType?: string;
  dataState?: string;
  dimensionFilterGroups?: searchconsole_v1.Schema$ApiDimensionFilterGroup[];
}

export interface SearchAnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/**
 * Run a Search Analytics query. Returns rows plus the dimension names so the
 * caller (and the model) can line keys up with their meaning.
 */
export async function searchAnalytics(
  params: SearchAnalyticsParams,
): Promise<{ dimensions: string[]; rows: SearchAnalyticsRow[] }> {
  const dimensions = params.dimensions ?? [];
  const res = await client().searchanalytics.query({
    siteUrl: params.siteUrl,
    requestBody: {
      startDate: params.startDate,
      endDate: params.endDate,
      dimensions,
      rowLimit: params.rowLimit ?? 1000,
      startRow: params.startRow ?? 0,
      type: params.searchType,
      dataState: params.dataState,
      dimensionFilterGroups: params.dimensionFilterGroups,
    },
  });

  const rows = (res.data.rows ?? []).map((r) => ({
    keys: r.keys ?? [],
    clicks: r.clicks ?? 0,
    impressions: r.impressions ?? 0,
    ctr: r.ctr ?? 0,
    position: r.position ?? 0,
  }));

  return { dimensions, rows };
}
