/**
 * Google Analytics 4 wrappers.
 *
 *  - Data API  (@google-analytics/data)  → reports, realtime, metadata
 *  - Admin API (@google-analytics/admin) → discover property IDs
 */
import { BetaAnalyticsDataClient } from '@google-analytics/data';
import { AnalyticsAdminServiceClient } from '@google-analytics/admin';
import { getAnalyticsClientCredentials, GOOGLE_SCOPES } from './auth.js';

let dataClient: BetaAnalyticsDataClient | null = null;
let adminClient: AnalyticsAdminServiceClient | null = null;

function data(): BetaAnalyticsDataClient {
  if (dataClient) return dataClient;
  dataClient = new BetaAnalyticsDataClient({
    credentials: getAnalyticsClientCredentials(),
    scopes: GOOGLE_SCOPES,
  });
  return dataClient;
}

function admin(): AnalyticsAdminServiceClient {
  if (adminClient) return adminClient;
  adminClient = new AnalyticsAdminServiceClient({
    credentials: getAnalyticsClientCredentials(),
    scopes: GOOGLE_SCOPES,
  });
  return adminClient;
}

/** Normalise a user-supplied property id to the `properties/{id}` form. */
export function normalizePropertyId(propertyId: string): string {
  const trimmed = propertyId.trim();
  return trimmed.startsWith('properties/') ? trimmed : `properties/${trimmed}`;
}

export interface Ga4Property {
  property: string;
  displayName: string;
  account: string;
  createTime?: string;
  currencyCode?: string;
  timeZone?: string;
}

/**
 * List GA4 properties visible to the service account, walking every account
 * it belongs to. Uses the Admin API account-summaries endpoint.
 */
export async function listProperties(): Promise<Ga4Property[]> {
  const properties: Ga4Property[] = [];
  const iterable = admin().listAccountSummariesAsync();
  for await (const summary of iterable) {
    for (const p of summary.propertySummaries ?? []) {
      properties.push({
        property: p.property ?? '',
        displayName: p.displayName ?? '',
        account: summary.account ?? '',
      });
    }
  }
  return properties;
}

export interface RunReportParams {
  propertyId: string;
  startDate: string;
  endDate: string;
  dimensions?: string[];
  metrics: string[];
  limit?: number;
  offset?: number;
  orderBys?: object[];
  dimensionFilter?: object;
  metricFilter?: object;
  keepEmptyRows?: boolean;
}

export interface ReportResult {
  dimensionHeaders: string[];
  metricHeaders: string[];
  rows: Array<{ dimensions: string[]; metrics: string[] }>;
  rowCount: number;
}

/** Run a standard GA4 report. */
export async function runReport(params: RunReportParams): Promise<ReportResult> {
  const [response] = await data().runReport({
    property: normalizePropertyId(params.propertyId),
    dateRanges: [{ startDate: params.startDate, endDate: params.endDate }],
    dimensions: (params.dimensions ?? []).map((name) => ({ name })),
    metrics: params.metrics.map((name) => ({ name })),
    limit: params.limit,
    offset: params.offset,
    orderBys: params.orderBys as never,
    dimensionFilter: params.dimensionFilter as never,
    metricFilter: params.metricFilter as never,
    keepEmptyRows: params.keepEmptyRows,
  });

  return {
    dimensionHeaders: (response.dimensionHeaders ?? []).map((h) => h.name ?? ''),
    metricHeaders: (response.metricHeaders ?? []).map((h) => h.name ?? ''),
    rows: (response.rows ?? []).map((row) => ({
      dimensions: (row.dimensionValues ?? []).map((v) => v.value ?? ''),
      metrics: (row.metricValues ?? []).map((v) => v.value ?? ''),
    })),
    rowCount: response.rowCount ?? 0,
  };
}

export interface RealtimeParams {
  propertyId: string;
  dimensions?: string[];
  metrics: string[];
  limit?: number;
}

/** Run a GA4 realtime report (data from roughly the last 30 minutes). */
export async function runRealtimeReport(
  params: RealtimeParams,
): Promise<ReportResult> {
  const [response] = await data().runRealtimeReport({
    property: normalizePropertyId(params.propertyId),
    dimensions: (params.dimensions ?? []).map((name) => ({ name })),
    metrics: params.metrics.map((name) => ({ name })),
    limit: params.limit,
  });

  return {
    dimensionHeaders: (response.dimensionHeaders ?? []).map((h) => h.name ?? ''),
    metricHeaders: (response.metricHeaders ?? []).map((h) => h.name ?? ''),
    rows: (response.rows ?? []).map((row) => ({
      dimensions: (row.dimensionValues ?? []).map((v) => v.value ?? ''),
      metrics: (row.metricValues ?? []).map((v) => v.value ?? ''),
    })),
    rowCount: response.rowCount ?? 0,
  };
}

export interface MetadataField {
  apiName: string;
  uiName: string;
  description: string;
  category: string;
}

/**
 * List the dimensions and metrics available for a property, including any
 * custom fields. Lets the model discover valid field names before reporting.
 */
export async function getMetadata(propertyId: string): Promise<{
  dimensions: MetadataField[];
  metrics: MetadataField[];
}> {
  const property = normalizePropertyId(propertyId);
  const [metadata] = await data().getMetadata({
    name: `${property}/metadata`,
  });

  return {
    dimensions: (metadata.dimensions ?? []).map((d) => ({
      apiName: d.apiName ?? '',
      uiName: d.uiName ?? '',
      description: d.description ?? '',
      category: d.category ?? '',
    })),
    metrics: (metadata.metrics ?? []).map((m) => ({
      apiName: m.apiName ?? '',
      uiName: m.uiName ?? '',
      description: m.description ?? '',
      category: m.category ?? '',
    })),
  };
}
