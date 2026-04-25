# Tools — Reference

Every tool, what it does, what it returns, with example calls.

---

## Search Console

### `gsc_query`

Pull performance data (clicks, impressions, CTR, position) by query/page/country/device/date.

**Inputs:**
- `startDate`, `endDate` — `YYYY-MM-DD` (default: last 28 days)
- `dimensions` — array, any of `query`, `page`, `country`, `device`, `date`, `searchAppearance` (default: `["query"]`)
- `rowLimit` — max rows (default 100, max 25,000)
- `siteUrl` — override the default Search Console site

**Example:**
```json
{
  "dimensions": ["query"],
  "rowLimit": 25,
  "startDate": "2026-04-01",
  "endDate": "2026-04-24"
}
```

### `gsc_inspect_url`

Inspect a URL — see indexation status, last crawl, structured data, mobile usability.

**Inputs:**
- `inspectionUrl` *(required)* — Full URL
- `siteUrl` — Override default site

### `gsc_request_indexing`

Request Google to (re)crawl or remove a URL via the Indexing API.

**Inputs:**
- `url` *(required)*
- `type` — `URL_UPDATED` (default) or `URL_DELETED`

> Note: Officially the Indexing API is for `JobPosting` and `BroadcastEvent` only, but in practice it works for any URL and accelerates crawl scheduling. Use sparingly — daily quota.

---

## Analytics (GA4)

### `ga4_run_report`

Run any GA4 report.

**Inputs:**
- `metrics` *(required)* — array of metric names (e.g. `["sessions","activeUsers","conversions","totalRevenue"]`)
- `dimensions` — array (e.g. `["pagePath","country","sessionSource"]`)
- `startDate`, `endDate` — `YYYY-MM-DD` or `"NdaysAgo"` / `"today"` (default: last 28 days)
- `limit` — default 100
- `propertyId` — override default GA4 property

**Example:**
```json
{
  "metrics": ["sessions", "conversions"],
  "dimensions": ["pagePath"],
  "startDate": "28daysago",
  "endDate": "today",
  "limit": 20
}
```

---

## Merchant Center

### `merchant_list`

List products in your Merchant Center catalog.

**Inputs:**
- `maxResults` — default 100, max 250
- `pageToken` — for pagination (returned as `nextPageToken` in the response)

### `merchant_status`

Get item-level status: approved, pending, disapproved, expiring. Includes disapproval reason codes.

**Inputs:** Same as `merchant_list`.

> Useful pattern: pull `merchant_status`, group by `itemLevelIssues[*].code`, surface the top disapproval reasons.

---

## Places API (New)

### `places_search_text`

Free-text search.

**Inputs:**
- `textQuery` *(required)* — e.g. `"mediterranean restaurants in Houston"`
- `locationBias` — `{lat, lng, radius}` (meters)
- `maxResults` — default 10, max 20
- `fields` — comma-separated field mask. Default returns id/name/address/location/rating/types.

### `places_search_nearby`

Radius search around a point.

**Inputs:**
- `lat`, `lng`, `radius` *(required)* — meters, max 50000
- `includedTypes` — array (e.g. `["restaurant","cafe"]`)
- `maxResults`, `fields` — same as above

### `places_get_details`

Full details on a specific place.

**Inputs:**
- `placeId` *(required)* — e.g. `ChIJ3RBHCWG_QIYRXqlqTIyTIf4`
- `fields` — default `*` (everything). Reduce for cheaper calls.

> Returns hours, photos URLs, reviews, phone, website, accessibility info, attributes (delivery/dine-in/takeout/etc.).

### `places_autocomplete`

Predict places as you type.

**Inputs:**
- `input` *(required)*
- `locationBias` — `{lat, lng, radius}`

---

## Maps

### `geocode`

Forward (address → lat/lng) or reverse (lat/lng → address).

**Inputs:**
- `mode` — `forward` (default) or `reverse`
- `address` — for forward
- `lat`, `lng` — for reverse

### `distance_matrix`

Travel time + distance for many origin/destination pairs.

**Inputs:**
- `origins`, `destinations` *(required)* — arrays of addresses or `"lat,lng"` strings
- `mode` — `driving` (default), `walking`, `bicycling`, `transit`
- `units` — `imperial` (default) or `metric`

**Example:**
```json
{
  "origins": ["912 Westheimer Rd, Houston, TX"],
  "destinations": [
    "Hobby Airport, Houston, TX",
    "IAH Airport, Houston, TX"
  ],
  "mode": "driving"
}
```

### `directions`

Turn-by-turn directions.

**Inputs:**
- `origin`, `destination` *(required)*
- `mode` — `driving` (default), `walking`, `bicycling`, `transit`

---

## Performance

### `pagespeed`

Run PageSpeed Insights (Lighthouse + CrUX field data) on any URL.

**Inputs:**
- `url` *(required)*
- `strategy` — `mobile` (default) or `desktop`
- `categories` — array (`performance` default; can include `accessibility`, `best-practices`, `seo`, `pwa`)

> Returns ~400-500 KB JSON. Worth piping through a summarizer if you only need scores.

---

## Translation

### `translate`

Cloud Translation v2.

**Inputs:**
- `text` *(required)* — string or array of strings
- `target` *(required)* — language code (e.g. `"es"`, `"ar"`, `"fr"`, `"zh-CN"`)
- `source` — optional source language code (auto-detected if omitted)

---

## Vision

### `vision_analyze`

Cloud Vision — analyze images.

**Inputs:**
- `imageUrl` *or* `imageBase64` — pick one
- `features` — array of feature types:
  - `LABEL_DETECTION` (default) — what's in the image
  - `TEXT_DETECTION` — OCR
  - `LOGO_DETECTION` — recognize brand logos
  - `LANDMARK_DETECTION` — recognize famous landmarks
  - `FACE_DETECTION` — face count + emotion
  - `SAFE_SEARCH_DETECTION` — adult/violence/medical/spoof/racy
  - `OBJECT_LOCALIZATION` — bounding-box objects
  - `IMAGE_PROPERTIES` — dominant colors
- `maxResults` — per feature, default 10

---

## The Escape Hatch

### `google_api_call`

Call any of the 100+ Google APIs you have enabled. Auth mode auto-selected by host.

**Inputs:**
- `host` *(required)* — e.g. `searchconsole.googleapis.com`, `documentai.googleapis.com`, `cloudbilling.googleapis.com`
- `path` *(required)* — e.g. `/v1/projects/myproject/sites`
- `method` — `GET` (default), `POST`, `PUT`, `PATCH`, `DELETE`
- `query` — object of query params
- `body` — JSON body for POST/PUT/PATCH
- `authMode` — `auto` (default), `apikey`, `oauth_user`, `sa_main`, `sa_merchant`
- `scopes` — for `sa_main` only (default: `["https://www.googleapis.com/auth/cloud-platform"]`)

**Example — Document AI batch process:**
```json
{
  "host": "us-documentai.googleapis.com",
  "path": "/v1/projects/myproject/locations/us/processors/abc123:process",
  "method": "POST",
  "body": { "rawDocument": { "content": "...", "mimeType": "application/pdf" } },
  "authMode": "sa_main"
}
```

**Example — Calendar Events list (note: claude.ai has a native Calendar connector that's better for most cases):**
```json
{
  "host": "www.googleapis.com",
  "path": "/calendar/v3/calendars/primary/events",
  "authMode": "oauth_user"
}
```

> The escape hatch makes this bridge a permanent investment — you don't need to rebuild it every time Google ships a new API.
