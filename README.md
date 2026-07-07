# SEO MCP Server (Google Search Console + GA4)

A remote [MCP](https://modelcontextprotocol.io) server that gives your team's
Claude clients read-only access to **Google Search Console** and **Google
Analytics 4** data. Deploy it once at `https://domain.com/mcp`, hand each
teammate a bearer token, and they can query GSC & GA4 from Claude.

- **Transport:** Streamable HTTP (stateless), the current MCP standard
- **Auth to the endpoint:** shared bearer token(s)
- **Auth to Google:** one service account (everyone sees the same properties)
- **Runtime:** Node 20+ / TypeScript, `@modelcontextprotocol/sdk` v1

---

## Tools exposed

| Tool | What it does |
|------|--------------|
| `gsc_list_sites` | List Search Console properties the service account can access |
| `gsc_search_analytics` | Clicks / impressions / CTR / position by query, page, country, device, date (+ filters) |
| `ga4_list_properties` | List GA4 properties + their numeric IDs |
| `ga4_run_report` | Custom GA4 report: any dimensions/metrics, date range, filters, ordering |
| `ga4_realtime_report` | GA4 realtime data (~last 30 min) |
| `ga4_get_metadata` | Discover valid GA4 dimension/metric names for a property |

Typical flow the model follows: `gsc_list_sites` / `ga4_list_properties` to
discover targets → `ga4_get_metadata` to find field names → run the report.

---

## 1. Google setup (one time)

### a. Create a service account
1. In [Google Cloud Console](https://console.cloud.google.com/) pick or create a project.
2. Enable these APIs: **Google Search Console API**, **Google Analytics Data API**, **Google Analytics Admin API**.
3. **IAM & Admin → Service Accounts → Create service account.**
4. Create a **JSON key** for it and download the file. This is your credential.
5. Note the service-account email, e.g. `seo-mcp@your-project.iam.gserviceaccount.com`.

### b. Grant it access to your data
- **Search Console:** for each property → *Settings → Users and permissions → Add user* → the service-account email → **Restricted** (read) is enough.
- **GA4:** *Admin → Account/Property Access Management → Add* → the service-account email → **Viewer**.

> The server only requests read-only scopes
> (`webmasters.readonly`, `analytics.readonly`). It can never modify your data.

---

## 2. Configure

```bash
cp .env.example .env
```

Edit `.env`:

- `MCP_AUTH_TOKENS` — one or more bearer tokens (comma-separated). Generate with `openssl rand -hex 32`. Give a different token to each teammate so you can revoke individually.
- `MCP_ALLOWED_HOSTS` — your public host as clients send it. Behind HTTPS on your domain that's just `domain.com` (no port). For local testing use `localhost:3000,127.0.0.1:3000`.
- Google credentials — set **one** of:
  - `GOOGLE_APPLICATION_CREDENTIALS` = path to the JSON key file (recommended for Docker/VPS), or
  - `GOOGLE_CREDENTIALS_JSON` = the raw JSON, or
  - `GOOGLE_CREDENTIALS_BASE64` = base64 of the JSON (`base64 -w0 service-account.json`).

---

## 3. Run

### Local (dev)
```bash
npm install
npm run dev          # tsx watch, http://localhost:3000/mcp
```

### Local (built)
```bash
npm install
npm run build
npm start
```

Quick check:
```bash
curl http://localhost:3000/healthz            # -> {"status":"ok"}
```

---

## 4. Deploy to `domain.com/mcp`

The included **Docker + Caddy** setup is the least-friction path (Caddy gets a
TLS cert automatically). On a VPS with Docker and your domain's DNS pointing at it:

```bash
# 1. Put the key file here (git-ignored):
mkdir -p secrets && cp /path/to/service-account.json secrets/service-account.json

# 2. Configure
cp .env.example .env
#    set MCP_AUTH_TOKENS=... and MCP_ALLOWED_HOSTS=domain.com

# 3. Point Caddy at your domain
#    edit Caddyfile: replace "domain.com" with your real domain

# 4. Launch
docker compose up -d --build
```

Caddy serves `https://domain.com/mcp` (proxying `/mcp` and `/healthz` to the
Node container) and preserves the `Host` header, so `MCP_ALLOWED_HOSTS=domain.com`
matches. Verify:

```bash
curl https://domain.com/healthz               # -> {"status":"ok"}
```

> **Already have nginx / another proxy?** Just reverse-proxy `POST /mcp` to the
> Node process on port 3000 and make sure the upstream `Host` header stays your
> public domain (or add whatever host it forwards to `MCP_ALLOWED_HOSTS`).

> **Other hosts (Fly.io, Railway, Render, a plain container platform):** the
> image is a standard Node HTTP server — deploy it and set the same env vars.
> Serverless platforms (Cloudflare Workers / Vercel Edge) are **not** recommended
> here because the Google client libraries expect a Node runtime.

---

## 5. Connect a team member's Claude

Each teammate adds the remote server with their bearer token.

**Claude Code (CLI):**
```bash
claude mcp add --transport http seo https://domain.com/mcp \
  --header "Authorization: Bearer THEIR_TOKEN_HERE"
```

**Claude Desktop / other clients** — in the MCP servers config:
```json
{
  "mcpServers": {
    "seo": {
      "type": "http",
      "url": "https://domain.com/mcp",
      "headers": { "Authorization": "Bearer THEIR_TOKEN_HERE" }
    }
  }
}
```

Then ask Claude things like:
- “List our Search Console sites.”
- “For `sc-domain:example.com`, top 20 queries by clicks over the last 28 days.”
- “Run a GA4 report of active users and sessions by country, last 7 days, for property 123456789.”
- “What are the realtime active users right now on property 123456789?”

---

## Security notes

- **Bearer tokens** are compared in constant time; use long random values and rotate by editing `MCP_AUTH_TOKENS` and restarting.
- **DNS-rebinding protection** is on; the `Host` header must be in `MCP_ALLOWED_HOSTS`.
- **Read-only** Google scopes; the server exposes no write tools.
- Keep the service-account key and `.env` out of git (already in `.gitignore`).
- Everyone shares the service account's view of the data. For per-user
  permissions you'd switch to per-user OAuth — a larger change, not covered here.

---

## Project layout

```
src/
  config.ts          env parsing + validation
  google/auth.ts     load service-account creds, build authed clients (read-only)
  google/gsc.ts      Search Console wrapper (sites, search analytics)
  google/ga4.ts      GA4 Data + Admin wrappers (report, realtime, metadata, list)
  mcp/server.ts      builds the MCP server, registers the 6 tools
  index.ts           Express app: bearer auth, /mcp (stateless), /healthz
Dockerfile, docker-compose.yml, Caddyfile   deployment
.env.example                                 configuration template
```

## Troubleshooting

| Symptom | Fix |
|--------|-----|
| `401 Unauthorized` | Token missing/wrong. Check the `Authorization: Bearer` header vs `MCP_AUTH_TOKENS`. |
| `Invalid Host header` | Add the exact host (with port if any) clients send to `MCP_ALLOWED_HOSTS`. |
| Tool returns a permission error | Add the service-account email to that GSC property / GA4 property. |
| `DECODER routines::unsupported` | The private key is malformed — re-download the JSON key; keep `\n` escapes intact. |
| Empty GA4 rows | Check the date range and that the metric/dimension names exist (`ga4_get_metadata`). |
```
