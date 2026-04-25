# API Auth — what each tool talks to and how it authenticates

This bridge talks to Google APIs through three different auth flows. The right one is auto-selected per tool. This page documents which API each tool hits, what auth it uses, and what scopes/permissions you need.

---

## Auth modes

### 1. API key (`apikey`)

**What:** A single API key in a query string.

**Setup:** [Google Cloud Console → Credentials → Create API Key](https://console.cloud.google.com/apis/credentials).

**Used by:** `geocode`, `distance_matrix`, `directions`, `places_*`, `pagespeed`, `translate`, `vision_analyze`

**Why these:** These APIs are designed for keyless apps (mobile, web frontends) and don't require a per-user identity. They charge against your project's quota.

### 2. Service account JWT (`sa_main` and `sa_merchant`)

**What:** The bridge signs a JWT with the SA's private key (using Web Crypto in the Worker), exchanges it for a 1-hour access token at `oauth2.googleapis.com/token`, caches it for 55 minutes.

**Setup:** [Google Cloud Console → IAM → Service Accounts → Create](https://console.cloud.google.com/iam-admin/serviceaccounts).

**Used by:** `merchant_list`, `merchant_status`, and the `sa_main` fallback for any unhandled API in `google_api_call`.

**Why these:** Merchant Center supports SA-based access (via Merchant Center user linking). Many other Google Cloud APIs (Vertex AI, Storage, BigQuery, Document AI, etc.) work the same way through `google_api_call` with `authMode=sa_main`.

**Required scopes (set per-call by tool):**
- Merchant: `https://www.googleapis.com/auth/content`
- Generic: `https://www.googleapis.com/auth/cloud-platform`

### 3. User OAuth refresh token (`oauth_user`)

**What:** A long-lived refresh token captured once via Google's consent flow, stored as a Cloudflare secret. The bridge exchanges it for a 1-hour access token, caches it for 55 minutes.

**Setup:** OAuth client + run `scripts/get_refresh_token.py` once. See [`SETUP.md`](SETUP.md#1f-oauth-client--refresh-token).

**Used by:** `gsc_query`, `gsc_inspect_url`, `gsc_request_indexing`, `ga4_run_report`, and the `oauth_user` mode of `google_api_call`.

**Why these:** Search Console, GA4, GBP, Drive, etc. are tied to *your user account*. Service accounts can't see your Search Console data unless explicitly added (and even then, GA4 still wants user OAuth in most flows).

**Required scopes** (set on the consent screen during refresh-token capture; the bridge requests all of them):
- `https://www.googleapis.com/auth/webmasters.readonly` (Search Console reads)
- `https://www.googleapis.com/auth/webmasters` (URL inspection — needs full webmasters)
- `https://www.googleapis.com/auth/indexing` (Indexing API)
- `https://www.googleapis.com/auth/analytics.readonly` (GA4 reads)
- (Optional) `https://www.googleapis.com/auth/business.manage` if you want to add GBP tools

---

## Tool-by-tool breakdown

| Tool | Auth | Endpoint(s) | API to enable in GCP |
|---|---|---|---|
| `gsc_query` | `oauth_user` | `searchconsole.googleapis.com/webmasters/v3/sites/.../searchAnalytics/query` | Search Console API |
| `gsc_inspect_url` | `oauth_user` | `searchconsole.googleapis.com/v1/urlInspection/index:inspect` | Search Console API |
| `gsc_request_indexing` | `oauth_user` | `indexing.googleapis.com/v3/urlNotifications:publish` | Indexing API |
| `ga4_run_report` | `oauth_user` | `analyticsdata.googleapis.com/v1beta/properties/{id}:runReport` | Google Analytics Data API |
| `merchant_list` | `sa_merchant` | `shoppingcontent.googleapis.com/content/v2.1/{merchant}/products` | Content API for Shopping |
| `merchant_status` | `sa_merchant` | `shoppingcontent.googleapis.com/content/v2.1/{merchant}/productstatuses` | Content API for Shopping |
| `places_search_text` | `apikey` | `places.googleapis.com/v1/places:searchText` | Places API (New) |
| `places_search_nearby` | `apikey` | `places.googleapis.com/v1/places:searchNearby` | Places API (New) |
| `places_get_details` | `apikey` | `places.googleapis.com/v1/places/{id}` | Places API (New) |
| `places_autocomplete` | `apikey` | `places.googleapis.com/v1/places:autocomplete` | Places API (New) |
| `geocode` | `apikey` | `maps.googleapis.com/maps/api/geocode/json` | Geocoding API |
| `distance_matrix` | `apikey` | `maps.googleapis.com/maps/api/distancematrix/json` | Distance Matrix API |
| `directions` | `apikey` | `maps.googleapis.com/maps/api/directions/json` | Directions API |
| `pagespeed` | `apikey` | `www.googleapis.com/pagespeedonline/v5/runPagespeed` | PageSpeed Insights API |
| `translate` | `apikey` | `translation.googleapis.com/language/translate/v2` | Cloud Translation API |
| `vision_analyze` | `apikey` | `vision.googleapis.com/v1/images:annotate` | Cloud Vision API |
| `google_api_call` | auto (or override) | any | depends on the call |

---

## How `google_api_call` auto-selects auth

The escape hatch picks an auth mode based on the host:

| Host pattern | Auth |
|---|---|
| `maps.googleapis.com`, `places.googleapis.com`, `translation.googleapis.com`, `vision.googleapis.com` | `apikey` |
| `searchconsole.googleapis.com`, `webmasters.googleapis.com`, `analyticsdata.googleapis.com`, `analyticsadmin.googleapis.com`, `indexing.googleapis.com`, `mybusiness*.googleapis.com` | `oauth_user` |
| `shoppingcontent.googleapis.com` | `sa_merchant` |
| Everything else | `sa_main` |

You can override with the `authMode` parameter in the tool call.

---

## Quotas

- Each Google API has its own quota — check at https://console.cloud.google.com/apis/api/{api}/quotas
- Most have generous free tiers (Maps APIs: 28K free calls/month; Vision: 1K free/month; Search Console: unlimited reads)
- The bridge does not bill — Google bills your project directly

---

## Security model

- **API key** is exposed in the deployed bundle (Cloudflare Workers env vars are visible to the worker code, but not in the public response). To avoid abuse, restrict the key in Google Cloud Console:
  - Restrict to specific APIs
  - (Optional) Restrict to your bridge's domain via HTTP-referrer rule
- **Service account JSON** and **OAuth refresh token** are Cloudflare Pages secrets — encrypted at rest, only visible to running worker code, never logged.
- Bridge access tokens (the ones issued to claude.ai) are 32-byte random hex, stored in Cloudflare KV with a 24-hour TTL. They have no relationship to your Google access tokens — even if a bridge token leaks, it can only call your bridge endpoints.
- The bridge admits only one user (`ALLOWED_EMAIL`) — not multi-tenant.
