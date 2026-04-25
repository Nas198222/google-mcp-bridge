# Google APIs MCP Bridge

Self-hostable [Model Context Protocol](https://modelcontextprotocol.io/) server that exposes Google's APIs to **claude.ai web** (and any other MCP client that speaks OAuth 2.1 + PKCE).

Runs on **Cloudflare Pages Functions**. One-file-per-concern. No build step. Deploy in ~10 minutes.

> **You bring your own keys.** This repo ships zero credentials. You'll plug in your own Google Cloud project, your own service account, your own API key, and your own OAuth client.

---

## What it gives you

17 tools covering the most-used Google APIs, all callable from claude.ai's `Connectors` interface:

| Category | Tool | API |
|---|---|---|
| **Search Console** | `gsc_query` | Search Analytics — clicks, impressions, CTR, position |
| | `gsc_inspect_url` | URL Inspection — indexation, last crawl, structured data |
| | `gsc_request_indexing` | Indexing API — request (re)crawl |
| **Analytics** | `ga4_run_report` | GA4 Data API — any report (sessions, conversions, pages, etc.) |
| **Merchant Center** | `merchant_list` | Content API — list products |
| | `merchant_status` | Content API — disapproval reasons + item-level status |
| **Places (New)** | `places_search_text` | Text search |
| | `places_search_nearby` | Radius search |
| | `places_get_details` | Full place details (hours, photos, reviews) |
| | `places_autocomplete` | Predictions |
| **Maps** | `geocode` | Forward + reverse geocoding |
| | `distance_matrix` | Travel time + distance |
| | `directions` | Turn-by-turn |
| **Performance** | `pagespeed` | PageSpeed Insights — Core Web Vitals lab + field |
| **Translation** | `translate` | Cloud Translation v2 |
| **Vision** | `vision_analyze` | Cloud Vision — labels, OCR, logos, faces, safe-search |
| **Escape hatch** | `google_api_call` | **Generic — call any of the 100+ Google APIs you have enabled** |

---

## Architecture

```
claude.ai web
     │
     │  OAuth 2.1 + PKCE
     ▼
┌─────────────────────────────────────────┐
│  Cloudflare Pages Function              │
│  ┌────────────────────────────────────┐ │
│  │  /authorize   → email+pw login     │ │
│  │  /token       → exchange code      │ │
│  │  /mcp         → JSON-RPC over HTTP │ │
│  └────────────────────────────────────┘ │
│           │                             │
│           ▼  (auth mode auto-selected)  │
│  ┌────────────────────────────────────┐ │
│  │  API key  ─→ Maps, Places, Vision, │ │
│  │              Translate, PageSpeed  │ │
│  │  SA JWT   ─→ Merchant Center       │ │
│  │  OAuth ref→ GSC, GA4, Indexing     │ │
│  └────────────────────────────────────┘ │
│           │                             │
│  ┌────────────────────────────────────┐ │
│  │  KV (TOKENS): OAuth codes,         │ │
│  │  bridge access tokens, cached      │ │
│  │  Google access tokens (55 min TTL) │ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
              │
              ▼
       Google APIs
```

---

## Quick start

### Prerequisites

You'll need:

- A **Cloudflare account** (free tier works)
- `wrangler` CLI: `npm install -g wrangler && wrangler login`
- A **Google Cloud project** with the APIs you want enabled (free for most usage)
- A **Google Cloud service account** with key JSON
- A **Google API key** (for keyless APIs like Maps/Places)
- An **OAuth 2.0 client** + **refresh token** (for user-data APIs like GSC/GA4)
- **Optional:** A separate **Merchant Center service account** if you use Merchant Center

See [`docs/SETUP.md`](docs/SETUP.md) for the full step-by-step.

### TL;DR deploy

```bash
git clone https://github.com/Nas198222/google-mcp-bridge.git
cd google-mcp-bridge

# 1. Configure
cp wrangler.toml.example wrangler.toml
# Edit wrangler.toml — fill in your project name, email, API key, etc.

# 2. Create KV namespace, paste the returned id back into wrangler.toml
wrangler kv namespace create "TOKENS"

# 3. Create Pages project
wrangler pages project create your-google-mcp --production-branch=main

# 4. Set secrets (ADMIN_PASSWORD is what you'll type into claude.ai)
echo "your-strong-password" | wrangler pages secret put ADMIN_PASSWORD --project-name=your-google-mcp
echo "$(cat ~/path/to/sa-main.json)" | wrangler pages secret put GCP_SERVICE_ACCOUNT_JSON --project-name=your-google-mcp
echo "$(cat ~/path/to/sa-merchant.json)" | wrangler pages secret put MERCHANT_SERVICE_ACCOUNT_JSON --project-name=your-google-mcp
echo "your-oauth-client-id" | wrangler pages secret put GOOGLE_OAUTH_CLIENT_ID --project-name=your-google-mcp
echo "your-oauth-client-secret" | wrangler pages secret put GOOGLE_OAUTH_CLIENT_SECRET --project-name=your-google-mcp
echo "your-oauth-refresh-token" | wrangler pages secret put GOOGLE_OAUTH_REFRESH_TOKEN --project-name=your-google-mcp

# 5. Deploy
wrangler pages deploy ./public --project-name=your-google-mcp --branch=main

# 6. Connect from claude.ai
# Settings → Connectors → Add custom connector
# URL: https://your-google-mcp.pages.dev/mcp
```

---

## Documentation

- [`docs/SETUP.md`](docs/SETUP.md) — Step-by-step deploy with screenshots
- [`docs/TOOLS.md`](docs/TOOLS.md) — Every tool, what it returns, example payloads
- [`docs/API_AUTH.md`](docs/API_AUTH.md) — Which Google API uses which auth mode + required scopes

---

## Required Google connections (overview)

The 17 tools call Google APIs through three different auth flows. You need to set up each one to use that category of tools. **You can deploy with any subset and skip the rest** — tools that don't have credentials simply error out.

### 1. API Key (simplest)

Used by: `geocode`, `distance_matrix`, `directions`, `places_*`, `pagespeed`, `translate`, `vision_analyze`

**Setup:**
1. Go to https://console.cloud.google.com/apis/credentials
2. Create an API key
3. Enable these APIs in your project:
   - Geocoding API
   - Distance Matrix API
   - Directions API
   - Places API (New)
   - PageSpeed Insights API
   - Cloud Translation API
   - Cloud Vision API
4. Paste the key into `wrangler.toml` as `GOOGLE_API_KEY`

### 2. Service Account (for unattended access)

Used by: `merchant_list`, `merchant_status`, and the `sa_main` mode of `google_api_call`

**Setup:**
1. https://console.cloud.google.com/iam-admin/serviceaccounts
2. Create a service account, download the JSON key
3. For Merchant Center: link the SA email in Merchant Center → Settings → Users
4. Set the JSON as the secret: `cat sa.json | wrangler pages secret put GCP_SERVICE_ACCOUNT_JSON --project-name=your-google-mcp`
5. Repeat with `MERCHANT_SERVICE_ACCOUNT_JSON` for the Merchant SA (can be the same one)

### 3. OAuth User Refresh Token (for user-data APIs)

Used by: `gsc_query`, `gsc_inspect_url`, `gsc_request_indexing`, `ga4_run_report`, and the `oauth_user` mode of `google_api_call`

**Setup:**
1. https://console.cloud.google.com/apis/credentials → "Create OAuth 2.0 Client ID" → Web app
2. Use the included `scripts/get_refresh_token.py` (see [`docs/SETUP.md`](docs/SETUP.md)) to walk through Google's consent flow ONCE and capture a long-lived refresh token
3. Set the three secrets:
   - `GOOGLE_OAUTH_CLIENT_ID`
   - `GOOGLE_OAUTH_CLIENT_SECRET`
   - `GOOGLE_OAUTH_REFRESH_TOKEN`

> **⚠️ 7-day refresh token expiry:** While your OAuth consent screen is in "Testing" status, refresh tokens expire after 7 days. To make them permanent, **publish** your OAuth app in the Google Cloud Console. See [`docs/SETUP.md`](docs/SETUP.md) for the one-click change.

---

## Security

- Single-tenant by design: only the `ALLOWED_EMAIL` configured in `wrangler.toml` can authorize via the bridge.
- Bridge access tokens (the ones claude.ai sees) are 32-byte random hex, stored in Cloudflare KV with a 24-hour TTL.
- Google access tokens fetched from refresh / SA JWT are cached in KV with a 55-minute TTL (Google issues 60-min tokens).
- All secrets stored as Cloudflare Pages secrets (encrypted at rest, never visible in code or build logs).
- The bridge never logs request bodies or response data. Cloudflare access logs only see metadata.
- Recommended: lock the API key down in Google Cloud Console → restrict it to specific APIs and (optionally) HTTP referrers.

---

## What this is not

- **Not multi-tenant.** Designed for one user (you). If you want to share with multiple people, give them the same admin password — there's no per-user provisioning.
- **Not a full MCP server framework.** Single-file router; minimal abstractions. Read the code, adapt as needed.
- **Not feature-complete for every Google API.** Use the `google_api_call` escape hatch for anything not in the named tools.

---

## Contributing

PRs welcome. Things on the roadmap:

- More named tool wrappers (Drive, Calendar, Gmail) — though several are now native MCP connectors in claude.ai itself
- Optional CRON triggers for scheduled syncs
- Multi-tenant mode (per-user OAuth) for orgs

---

## License

MIT — see [`LICENSE`](LICENSE).

---

## Acknowledgements

Inspired by the official [@modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) project and the Cloudflare Workers MCP examples. Built standalone because deploying a stateless OAuth-wrapped MCP bridge to Cloudflare Pages is genuinely 10 minutes once you know the recipe.
