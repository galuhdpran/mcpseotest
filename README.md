# SEO MCP Server (Google Search Console + GA4)

A remote [MCP](https://modelcontextprotocol.io) server that gives your team's
Claude clients read-only access to **Google Search Console** and **Google
Analytics 4** data. Deploy it once at `https://domain.com/mcp`, hand each
teammate a bearer token, and they can query GSC & GA4 from Claude.

- **Transport:** Streamable HTTP (stateless), the current MCP standard
- **Auth to the endpoint:** built-in OAuth server for browser custom connectors on claude.ai; **optional** static bearer token(s) for Claude Code CLI / Desktop
- **Auth to Google:** OAuth central account (recommended for agencies) **or** a service account
- **Runtime:** Node 20+ / TypeScript, `@modelcontextprotocol/sdk` v1

---

## Tools exposed

| Tool | What it does |
|------|--------------|
| `gsc_list_sites` | List Search Console properties the configured identity can access |
| `gsc_search_analytics` | Clicks / impressions / CTR / position by query, page, country, device, date (+ filters) |
| `ga4_list_properties` | List GA4 properties + their numeric IDs |
| `ga4_run_report` | Custom GA4 report: any dimensions/metrics, date range, filters, ordering |
| `ga4_realtime_report` | GA4 realtime data (~last 30 min) |
| `ga4_get_metadata` | Discover valid GA4 dimension/metric names for a property |

Typical flow the model follows: `gsc_list_sites` / `ga4_list_properties` to
discover targets → `ga4_get_metadata` to find field names → run the report.

---

## 1. Google setup (one time)

Pick **one** auth mode. Both use read-only scopes
(`webmasters.readonly`, `analytics.readonly`) — the server can never modify data.

| | OAuth central account | Service account |
|---|---|---|
| Server acts as | your agency Gmail | a robot `…iam.gserviceaccount.com` |
| Clients add | that Gmail (as they already do for staff) | the robot email |
| Best for | **agencies with many clients** | a single team, fixed properties |

### Mode A — OAuth central account (recommended for agencies)

The server authenticates AS one Google account. Any GSC/GA4 property that
account can see becomes readable automatically — adding a new client is just
"add our Gmail as a Viewer", exactly like you already onboard staff.

1. [Google Cloud Console](https://console.cloud.google.com/): pick/create a project.
2. Enable APIs: **Google Search Console API**, **Google Analytics Data API**, **Google Analytics Admin API**.
3. **APIs & Services → OAuth consent screen:** User type **External**; add the
   two read-only scopes above; add your central account as a **test user**.
   Then **Publish to Production** (see the refresh-token note below).
4. **APIs & Services → Credentials → Create OAuth client ID → Web application.**
   Add redirect URI `http://localhost:5555/oauth2callback`. Copy the **client
   ID** and **client secret**.
5. Put them in `.env` (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`),
   then run the one-time login to get a refresh token:
   ```bash
   npm install
   npm run oauth:login
   ```
   Open the printed URL, **log in as the central account** (e.g.
   `revincolabs@gmail.com`), approve, and paste the printed
   `GOOGLE_OAUTH_REFRESH_TOKEN` into `.env`.

**Grant client access:** each client adds your central account —
- **GA4:** *Admin → Account/Property Access Management → Add* → the Gmail → **Viewer**
  (add at **Account** level to cover all its properties at once).
- **Search Console:** per property → *Settings → Users and permissions → Add user* → the Gmail → **Restricted**.

> ⚠️ **Refresh-token longevity.** While the OAuth app is in **Testing**, Google
> expires the refresh token after **7 days** (server would need re-login).
> **Publish the app to Production** (consent screen → Publish app) to make it
> long-lived. For your own read-only account you can safely click through the
> "unverified app" warning.

### Mode B — Service account (single team / fixed properties)

1. Cloud Console → enable the same 3 APIs.
2. **IAM & Admin → Service Accounts → Create service account.**
3. Create a **JSON key**, download it. Note the email (`…iam.gserviceaccount.com`).
4. Grant it access to your data:
   - **Search Console:** per property → *Users and permissions → Add user* → the service-account email → **Restricted**.
   - **GA4:** *Admin → Access Management → Add* → the service-account email → **Viewer**.

---

## 2. Configure

```bash
cp .env.example .env
```

Edit `.env`:

- `MCP_AUTH_TOKENS` — **optional** static bearer tokens (comma-separated) for CLI/Desktop; generate with `openssl rand -hex 32`, one per teammate to revoke individually. Leave unset to allow **OAuth-only** access (browser connectors); if you do, you must set `MCP_OAUTH_PASSWORD` for the consent screen.
- `MCP_ALLOWED_HOSTS` — your public host as clients send it. Behind HTTPS on your domain that's just `domain.com` (no port). For local testing use `localhost:3000,127.0.0.1:3000`.
- **Browser OAuth (optional)** — only needed to add the server via the *Add custom connector* dialog in the claude.ai browser app (that dialog requires OAuth; CLI/Desktop don't need this). Set `MCP_PUBLIC_URL` (this server's public origin, e.g. `https://domain.com`) and `MCP_OAUTH_JWT_SECRET` (`openssl rand -hex 32`). Optionally `MCP_OAUTH_PASSWORD` for a shared team password on the consent screen. See step 5. Nothing to register in Google Cloud — Claude self-registers via DCR.
- Google auth — pick the mode you set up in step 1:
  - **OAuth:** `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN` (from `npm run oauth:login`). If these three are set, the server uses OAuth.
  - **Service account** (used when the OAuth vars are absent): set **one** of `GOOGLE_APPLICATION_CREDENTIALS` (path to JSON key — best for Docker/VPS), `GOOGLE_CREDENTIALS_JSON` (raw JSON), or `GOOGLE_CREDENTIALS_BASE64` (`base64 -w0 service-account.json`).

The startup log prints which mode is active: `Google auth: oauth …` or `Google auth: service_account …`.

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
# 1. Configure
cp .env.example .env
#    set MCP_ALLOWED_HOSTS=domain.com
#    Google (OAuth central account): set the three GOOGLE_OAUTH_* vars (no key file)
#    Browser connector (OAuth): set MCP_PUBLIC_URL + MCP_OAUTH_JWT_SECRET (+ MCP_OAUTH_PASSWORD)
#    MCP_AUTH_TOKENS is optional (only for CLI/Desktop static-header access)
#    Google via service account instead? see step 1b below

# 1b. (Service-account mode only) The default docker-compose.yml no longer mounts
#     secrets. Re-add to the mcp service:
#       environment: - GOOGLE_APPLICATION_CREDENTIALS=/app/secrets/service-account.json
#       volumes:     - ./secrets:/app/secrets:ro
#     then drop the key file in place:
mkdir -p secrets && cp /path/to/service-account.json secrets/service-account.json

# 2. Point Caddy at your domain
#    edit Caddyfile: replace "domain.com" with your real domain

# 3. Launch
docker compose up -d --build
```

> **OAuth mode + Docker:** the three `GOOGLE_OAUTH_*` values come from `.env`
> (already wired via `env_file`), so no `secrets/` mount is required. The refresh
> token is long-lived only if the OAuth app is **Published to Production**.

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

Two ways to connect: the **browser** (OAuth — nothing to paste, works whenever
the OAuth vars are set) or **Claude Code CLI / Desktop** with a static header
(**only if `MCP_AUTH_TOKENS` is set** — otherwise use the browser).

**Claude Code (CLI)** — requires `MCP_AUTH_TOKENS`:
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

**Browser (claude.ai custom connector)** — requires the browser-OAuth vars from
step 2 (`MCP_PUBLIC_URL` + `MCP_OAUTH_JWT_SECRET`). The browser dialog needs
OAuth, so a static header won't work; the built-in OAuth server handles it:

1. *Settings → Connectors → Add custom connector* (Team/Enterprise: *Admin
   settings → Connectors*). Enter `https://domain.com/mcp`.
2. In **Advanced settings**, leave **OAuth Client ID/Secret blank** — Claude
   registers itself automatically. Click **Add**, then **Connect**.
3. A consent screen hosted by the server appears; the user enters
   `MCP_OAUTH_PASSWORD` or any `MCP_AUTH_TOKENS` value to approve.

Then ask Claude things like:
- “List our Search Console sites.”
- “For `sc-domain:example.com`, top 20 queries by clicks over the last 28 days.”
- “Run a GA4 report of active users and sessions by country, last 7 days, for property 123456789.”
- “What are the realtime active users right now on property 123456789?”

---

## Security notes

- **Static bearer tokens** (`MCP_AUTH_TOKENS`) are optional and compared in constant time; use long random values, rotate by editing the var and restarting, or omit entirely to require OAuth for all clients.
- **DNS-rebinding protection** is on; the `Host` header must be in `MCP_ALLOWED_HOSTS`.
- **Read-only** Google scopes; the server exposes no write tools.
- Keep the service-account key, OAuth refresh token, and `.env` out of git (already in `.gitignore`).
- All clients share one identity's view of the data (the OAuth central account, or the service account). For true per-user permissions you'd give each user their own OAuth login — a larger change, not covered here.
- **Built-in OAuth server** (browser connectors) is a *gate*, not a per-user identity: the consent screen just checks `MCP_OAUTH_PASSWORD` / `MCP_AUTH_TOKENS`. Its tokens are stateless, HMAC-signed with `MCP_OAUTH_JWT_SECRET` (keep it secret; rotating it invalidates all issued tokens), short-lived (access ~1h), and cannot be individually revoked before expiry. Access tokens are bound to this server's resource URL (`aud`).

---

## Project layout

```
src/
  config.ts             env parsing + validation
  google/auth.ts        OAuth / service-account modes, build authed clients (read-only)
  google/gsc.ts         Search Console wrapper (sites, search analytics)
  google/ga4.ts         GA4 Data + Admin wrappers (report, realtime, metadata, list)
  mcp/server.ts         builds the MCP server, registers the 6 tools
  oauth/tokens.ts       signed stateless OAuth artefacts (client ids, codes, tokens)
  oauth/provider.ts     OAuthServerProvider impl (DCR, code/token exchange, verify)
  oauth/consent.ts      consent screen + POST /oauth/consent handler
  scripts/oauth-login.ts one-time refresh-token grabber (npm run oauth:login)
  index.ts              Express app: bearer auth, optional OAuth server, /mcp, /healthz
Dockerfile, docker-compose.yml, Caddyfile   deployment
.env.example                                 configuration template
```

## Troubleshooting

| Symptom | Fix |
|--------|-----|
| `401 Unauthorized` | Token missing/wrong. Check the `Authorization: Bearer` header vs `MCP_AUTH_TOKENS`. |
| Browser connector: "couldn't register" / OAuth error | Set `MCP_PUBLIC_URL` + `MCP_OAUTH_JWT_SECRET` and restart (that mounts the OAuth server). Leave OAuth Client ID/Secret blank in the dialog. |
| Consent screen rejects the credential | Enter `MCP_OAUTH_PASSWORD` or a value from `MCP_AUTH_TOKENS`. |
| `Invalid Host header` | Add the exact host (with port if any) clients send to `MCP_ALLOWED_HOSTS`. |
| Tool returns a permission error | Add the active identity (OAuth central account, or the service-account email — see the startup log) to that GSC/GA4 property. |
| `invalid_client` / `invalid_grant` | OAuth client id/secret wrong, or the refresh token expired (publish the OAuth app to Production, then re-run `npm run oauth:login`). |
| `DECODER routines::unsupported` | Service-account private key malformed — re-download the JSON key; keep `\n` escapes intact. |
| Empty GA4 rows | Check the date range and that the metric/dimension names exist (`ga4_get_metadata`). |
```
