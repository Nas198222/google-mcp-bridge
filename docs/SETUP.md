# Setup Guide

End-to-end deployment from a fresh clone, with no prior assumptions. **Estimated time: 30-45 minutes** if you're new to Google Cloud and Cloudflare; ~10 minutes if you have both accounts already.

---

## Step 0 — Prerequisites

- **Cloudflare account** (free works) — https://dash.cloudflare.com/sign-up
- **Google Cloud account** — https://console.cloud.google.com (free $300 credit if new)
- **Node.js 20+** and **wrangler CLI** locally:
  ```bash
  npm install -g wrangler
  wrangler login
  ```
- **Python 3** (only for the OAuth refresh-token helper script)

---

## Step 1 — Set up Google Cloud project

### 1a. Create a project

1. Go to https://console.cloud.google.com/
2. Top-left dropdown → "New Project"
3. Name it (e.g. `my-mcp-bridge`)
4. Note the **Project ID** (will look like `my-mcp-bridge-123456`) — you'll paste this into `wrangler.toml`

### 1b. Enable APIs

In your project, go to **APIs & Services → Library** and enable each API you plan to use:

**For API-key tools (Maps/Places/Vision/Translate/PageSpeed):**
- Geocoding API
- Maps Distance Matrix API
- Maps Directions API
- Places API (New)
- PageSpeed Insights API
- Cloud Translation API
- Cloud Vision API

**For Search Console / GA4 / Indexing tools:**
- Google Search Console API
- Google Analytics Data API
- Google Indexing API

**For Merchant Center tools:**
- Content API for Shopping

You can enable more later — the `google_api_call` tool can hit anything you have enabled.

### 1c. Create the API key

1. **APIs & Services → Credentials → + Create Credentials → API key**
2. Copy the key (starts with `AIza`)
3. Click "Edit API key" to restrict it:
   - **Application restrictions:** None (or "HTTP referrers" with your bridge URL)
   - **API restrictions:** select the APIs above
4. Save

### 1d. Create the main service account

1. **IAM & Admin → Service Accounts → Create Service Account**
2. Name: `mcp-bridge-main`
3. Grant role: `Project → Editor` (or narrower if you know what you need)
4. **Done** → click into the SA → **Keys → Add Key → JSON**
5. Save the downloaded file somewhere safe (you'll feed its contents to wrangler in Step 4)

### 1e. (Optional) Merchant Center service account

If you'll use Merchant Center tools:

1. Repeat step 1d with name `mcp-bridge-merchant`
2. Go to https://merchants.google.com/ → Settings → Account access (or Users)
3. Add the SA email (e.g. `mcp-bridge-merchant@my-mcp-bridge-123456.iam.gserviceaccount.com`) as a user with "Standard" or "Admin" access
4. Wait ~1 minute for the link to propagate

### 1f. OAuth client + refresh token

Required for Search Console, GA4, and Indexing API tools (anything that needs *your* user data).

1. **APIs & Services → OAuth consent screen** (skip if already configured)
   - User type: **External**
   - App name, user support email, developer email — fill in
   - Scopes: skip (we'll specify per-call)
   - Test users: add your own email
   - Save

2. **APIs & Services → Credentials → + Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorized redirect URIs: `http://localhost:8765/`  (we'll use this for the one-time refresh-token capture)
   - Save → copy `Client ID` and `Client Secret`

3. **Capture the refresh token (one-time):**
   ```bash
   pip3 install google-auth-oauthlib
   python3 scripts/get_refresh_token.py
   ```
   The script will:
   - Open your browser for Google's consent screen
   - Catch the redirect on `localhost:8765`
   - Print your refresh token
   
   Copy that token — you'll paste it as a secret in Step 4.

4. **⚠️ Make refresh tokens permanent (recommended):**
   While your OAuth consent screen is in "Testing" status, refresh tokens auto-expire after 7 days. To stop the weekly re-auth:
   - **APIs & Services → OAuth consent screen → Publishing status → "Publish app"**
   - You don't need Google verification for personal/private use cases — just publish
   
   Refresh tokens captured AFTER publishing become permanent.

---

## Step 2 — Cloudflare setup

### 2a. KV namespace

```bash
wrangler kv namespace create "TOKENS"
```

It prints something like:
```
✨ Success!
[[kv_namespaces]]
binding = "TOKENS"
id = "a1a38fc779c54147a8e06d82b145c1ac"
```

Copy that **id**.

### 2b. Pages project

Pick a name (it becomes your subdomain: `<name>.pages.dev`):

```bash
wrangler pages project create your-google-mcp --production-branch=main
```

---

## Step 3 — Configure `wrangler.toml`

```bash
cp wrangler.toml.example wrangler.toml
```

Edit `wrangler.toml` and fill in:

| Field | Value |
|---|---|
| `name` | The Pages project name from Step 2b |
| `id` (under `[[kv_namespaces]]`) | The KV ID from Step 2a |
| `ALLOWED_EMAIL` | Your email (must match what you'll type in the login form) |
| `ISSUER` | `https://<your-pages-project>.pages.dev` |
| `SITE_NAME` / `LOGIN_TITLE` | Branding for the login page |
| `GOOGLE_PROJECT_ID` | Project ID from Step 1a |
| `GOOGLE_API_KEY` | API key from Step 1c |
| `MERCHANT_ID` | Your Merchant Center ID (or leave empty) |
| `GA4_PROPERTY_ID` | Your GA4 property ID (or leave empty) |
| `GSC_SITE_URL` | Your verified Search Console site URL with trailing slash (or leave empty) |

---

## Step 4 — Set Cloudflare secrets

These are encrypted and never visible in code:

```bash
PROJECT=your-google-mcp

# 1. Admin password for the bridge login form
echo "$(openssl rand -hex 12)" | wrangler pages secret put ADMIN_PASSWORD --project-name=$PROJECT

# 2. Service account JSON (paste the entire JSON file contents)
cat ~/path/to/sa-main.json | wrangler pages secret put GCP_SERVICE_ACCOUNT_JSON --project-name=$PROJECT

# 3. Merchant SA JSON (skip if not using Merchant Center)
cat ~/path/to/sa-merchant.json | wrangler pages secret put MERCHANT_SERVICE_ACCOUNT_JSON --project-name=$PROJECT

# 4. OAuth client + refresh token (skip if not using GSC/GA4/Indexing)
echo "your-client-id.apps.googleusercontent.com" | wrangler pages secret put GOOGLE_OAUTH_CLIENT_ID --project-name=$PROJECT
echo "your-client-secret" | wrangler pages secret put GOOGLE_OAUTH_CLIENT_SECRET --project-name=$PROJECT
echo "your-refresh-token" | wrangler pages secret put GOOGLE_OAUTH_REFRESH_TOKEN --project-name=$PROJECT
```

> Save the admin password somewhere safe — you'll need it every time you (re)authorize the bridge from claude.ai.

---

## Step 5 — Deploy

```bash
wrangler pages deploy ./public --project-name=your-google-mcp --branch=main
```

Wait for the URL it prints (e.g. `https://your-google-mcp.pages.dev`).

### Verify deploy

```bash
curl https://your-google-mcp.pages.dev/health
```

You should see JSON with `"status": "ok"` and `"tools": 17`.

---

## Step 6 — Connect from claude.ai

1. Open https://claude.ai
2. **Settings** (bottom-left) → **Connectors**
3. **Add custom connector**
4. **MCP Server URL:** `https://your-google-mcp.pages.dev/mcp`
5. claude.ai opens your bridge's login page
6. Email: the `ALLOWED_EMAIL` from `wrangler.toml`
7. Password: the `ADMIN_PASSWORD` you set in Step 4
8. Click **Authorize** → claude.ai redirects back, shows the 17 tools

You're done. Try a tool:

> *"Look up Aladdin Mediterranean Cuisine in Houston using places_search_text"*

---

## Troubleshooting

### "invalid_grant" when calling GSC/GA4 tools
Your refresh token expired. Re-run `scripts/get_refresh_token.py` and update the `GOOGLE_OAUTH_REFRESH_TOKEN` secret. **To prevent this, publish your OAuth app** (Step 1f.4).

### "Wrong email or password" on the bridge login page
- Email must match `ALLOWED_EMAIL` in `wrangler.toml` (case-insensitive)
- Password must match `ADMIN_PASSWORD` secret
- Both are checked server-side. Whitespace matters for the password.

### Tool returns "SA token exchange failed"
The service account JSON might be malformed. Verify with:
```bash
echo "$(cat ~/path/to/sa.json)" | python3 -m json.tool
```
Then re-set the secret.

### Tool returns "HTTP 403 Forbidden"
The API isn't enabled on your project. Go to **APIs & Services → Library** and enable it.

### Tool returns "REQUEST_DENIED" with API key
The API key is restricted to a different list of APIs. Edit it in **Credentials**.

### Cloudflare deploy fails with "Multiple accounts available"
Set the account ID env var:
```bash
export CLOUDFLARE_ACCOUNT_ID=<your-account-id>
```

---

## Updating

When the upstream repo updates:

```bash
git pull
wrangler pages deploy ./public --project-name=your-google-mcp --branch=main
```

Secrets persist across deploys — no need to re-set them.
