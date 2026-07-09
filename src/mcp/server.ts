/**
 * Builds the MCP server and registers all GSC + GA4 tools.
 *
 * A fresh McpServer is created per request by index.ts (stateless transport),
 * so this module just describes the tools.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import * as gsc from '../google/gsc.js';
import * as ga4 from '../google/ga4.js';
import { getIdentityLabel } from '../google/auth.js';

/** Wrap any JSON-serialisable value as an MCP text result. */
function jsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

/** Turn a thrown error into a readable MCP tool error (isError: true). */
function errorResult(error: unknown, hint?: string): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  const suffix = hint ? `\n\nHint: ${hint}` : '';
  return {
    content: [{ type: 'text', text: `Error: ${message}${suffix}` }],
    isError: true,
  };
}

const PERMISSION_HINT =
  'If this is a permission error, make sure ' +
  `${getIdentityLabel()} has been added to the GSC property / GA4 account.`;

export function buildServer(): McpServer {
  const server = new McpServer(
    { name: 'seo-mcp', version: '1.0.0' },
    {
      capabilities: { tools: {}, logging: {} },
      instructions:
        'Provides read-only access to Google Search Console (GSC) and ' +
        'Google Analytics 4 (GA4). Use gsc_list_sites / ga4_list_properties ' +
        'first to discover which properties are available, and ga4_get_metadata ' +
        'to discover valid GA4 dimension/metric names before running a report.',
    },
  );

  // ---------------------------------------------------------------------------
  // Google Search Console
  // ---------------------------------------------------------------------------

  server.registerTool(
    'gsc_list_sites',
    {
      title: 'GSC: list sites',
      description:
        'List all Search Console properties (sites) the service account can ' +
        'access, with permission levels. Call this to find valid siteUrl values.',
      inputSchema: {},
    },
    async (): Promise<CallToolResult> => {
      try {
        return jsonResult(await gsc.listSites());
      } catch (error) {
        return errorResult(error, PERMISSION_HINT);
      }
    },
  );

  server.registerTool(
    'gsc_search_analytics',
    {
      title: 'GSC: search analytics',
      description:
        'Query Search Console search analytics: clicks, impressions, CTR, and ' +
        'average position. Group by dimensions (query, page, country, device, ' +
        'searchAppearance, date) and optionally filter. Dates are YYYY-MM-DD.',
      inputSchema: {
        siteUrl: z
          .string()
          .describe(
            'Property URL exactly as shown by gsc_list_sites, e.g. ' +
              '"https://example.com/" or "sc-domain:example.com".',
          ),
        startDate: z.string().describe('Start date, YYYY-MM-DD (inclusive).'),
        endDate: z.string().describe('End date, YYYY-MM-DD (inclusive).'),
        dimensions: z
          .array(
            z.enum([
              'query',
              'page',
              'country',
              'device',
              'searchAppearance',
              'date',
            ]),
          )
          .optional()
          .describe('Dimensions to group by. Omit for site totals.'),
        rowLimit: z
          .number()
          .int()
          .min(1)
          .max(25000)
          .optional()
          .describe('Max rows to return (default 1000, max 25000).'),
        startRow: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Zero-based row offset for pagination (default 0).'),
        searchType: z
          .enum(['web', 'image', 'video', 'news', 'discover', 'googleNews'])
          .optional()
          .describe('Search surface / type. Defaults to all web.'),
        dataState: z
          .enum(['final', 'all'])
          .optional()
          .describe('"all" includes fresh (not-yet-final) data.'),
        query: z
          .string()
          .optional()
          .describe('Convenience filter: only rows whose query contains this.'),
        page: z
          .string()
          .optional()
          .describe('Convenience filter: only rows whose page contains this.'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args): Promise<CallToolResult> => {
      try {
        const filters: Array<{
          dimension: string;
          operator: string;
          expression: string;
        }> = [];
        if (args.query) {
          filters.push({
            dimension: 'query',
            operator: 'contains',
            expression: args.query,
          });
        }
        if (args.page) {
          filters.push({
            dimension: 'page',
            operator: 'contains',
            expression: args.page,
          });
        }

        const result = await gsc.searchAnalytics({
          siteUrl: args.siteUrl,
          startDate: args.startDate,
          endDate: args.endDate,
          dimensions: args.dimensions,
          rowLimit: args.rowLimit,
          startRow: args.startRow,
          searchType: args.searchType,
          dataState: args.dataState,
          dimensionFilterGroups:
            filters.length > 0 ? [{ filters }] : undefined,
        });
        return jsonResult(result);
      } catch (error) {
        return errorResult(error, PERMISSION_HINT);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Google Analytics 4
  // ---------------------------------------------------------------------------

  server.registerTool(
    'ga4_list_properties',
    {
      title: 'GA4: list properties',
      description:
        'List all GA4 properties the service account can access, with their ' +
        'numeric property IDs. Call this to find valid propertyId values.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async (): Promise<CallToolResult> => {
      try {
        return jsonResult(await ga4.listProperties());
      } catch (error) {
        return errorResult(error, PERMISSION_HINT);
      }
    },
  );

  server.registerTool(
    'ga4_run_report',
    {
      title: 'GA4: run report',
      description:
        'Run a GA4 report over a date range with chosen dimensions and ' +
        'metrics. Use ga4_get_metadata to discover valid field names. ' +
        'Dates are YYYY-MM-DD or relative like "7daysAgo"/"today"/"yesterday".',
      inputSchema: {
        propertyId: z
          .string()
          .describe('GA4 property ID, e.g. "123456789" or "properties/123456789".'),
        startDate: z.string().describe('Start date: YYYY-MM-DD or NdaysAgo/today/yesterday.'),
        endDate: z.string().describe('End date: YYYY-MM-DD or NdaysAgo/today/yesterday.'),
        metrics: z
          .array(z.string())
          .min(1)
          .describe('Metric API names, e.g. ["activeUsers","sessions","screenPageViews"].'),
        dimensions: z
          .array(z.string())
          .optional()
          .describe('Dimension API names, e.g. ["date","country","pagePath"].'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(250000)
          .optional()
          .describe('Max rows (default GA4 = 10000).'),
        offset: z.number().int().min(0).optional().describe('Row offset for pagination.'),
        orderBys: z
          .array(z.record(z.string(), z.any()))
          .optional()
          .describe('GA4 OrderBy objects, e.g. [{"metric":{"metricName":"sessions"},"desc":true}].'),
        dimensionFilter: z
          .record(z.string(), z.any())
          .optional()
          .describe('GA4 FilterExpression on dimensions (raw API shape).'),
        metricFilter: z
          .record(z.string(), z.any())
          .optional()
          .describe('GA4 FilterExpression on metrics (raw API shape).'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args): Promise<CallToolResult> => {
      try {
        return jsonResult(
          await ga4.runReport({
            propertyId: args.propertyId,
            startDate: args.startDate,
            endDate: args.endDate,
            metrics: args.metrics,
            dimensions: args.dimensions,
            limit: args.limit,
            offset: args.offset,
            orderBys: args.orderBys,
            dimensionFilter: args.dimensionFilter,
            metricFilter: args.metricFilter,
          }),
        );
      } catch (error) {
        return errorResult(error, PERMISSION_HINT);
      }
    },
  );

  server.registerTool(
    'ga4_realtime_report',
    {
      title: 'GA4: realtime report',
      description:
        'Run a GA4 realtime report (roughly the last 30 minutes). Common ' +
        'metrics: activeUsers, eventCount. Common dimensions: unifiedScreenName, ' +
        'country, deviceCategory.',
      inputSchema: {
        propertyId: z
          .string()
          .describe('GA4 property ID, e.g. "123456789" or "properties/123456789".'),
        metrics: z
          .array(z.string())
          .min(1)
          .describe('Realtime metric API names, e.g. ["activeUsers"].'),
        dimensions: z
          .array(z.string())
          .optional()
          .describe('Realtime dimension API names, e.g. ["country","deviceCategory"].'),
        limit: z.number().int().min(1).max(250000).optional().describe('Max rows.'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args): Promise<CallToolResult> => {
      try {
        return jsonResult(
          await ga4.runRealtimeReport({
            propertyId: args.propertyId,
            metrics: args.metrics,
            dimensions: args.dimensions,
            limit: args.limit,
          }),
        );
      } catch (error) {
        return errorResult(error, PERMISSION_HINT);
      }
    },
  );

  server.registerTool(
    'ga4_get_metadata',
    {
      title: 'GA4: get metadata',
      description:
        'List the dimensions and metrics available for a GA4 property ' +
        '(including custom fields). Use this to find valid field names before ' +
        'calling ga4_run_report.',
      inputSchema: {
        propertyId: z
          .string()
          .describe('GA4 property ID, e.g. "123456789" or "properties/123456789".'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args): Promise<CallToolResult> => {
      try {
        return jsonResult(await ga4.getMetadata(args.propertyId));
      } catch (error) {
        return errorResult(error, PERMISSION_HINT);
      }
    },
  );

  return server;
}
