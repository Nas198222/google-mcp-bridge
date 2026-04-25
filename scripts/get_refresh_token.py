#!/usr/bin/env python3
"""
One-time helper: capture a Google OAuth refresh token for the user-data APIs
this bridge supports (Search Console, GA4, Indexing).

Usage:
    pip3 install google-auth-oauthlib
    python3 scripts/get_refresh_token.py

Walks you through Google's consent flow in the browser, then prints:
    - your refresh_token  (paste into Cloudflare secret GOOGLE_OAUTH_REFRESH_TOKEN)
    - your client_id      (paste into Cloudflare secret GOOGLE_OAUTH_CLIENT_ID)
    - your client_secret  (paste into Cloudflare secret GOOGLE_OAUTH_CLIENT_SECRET)

You'll be prompted for the OAuth client_id and client_secret first (from
Google Cloud Console → Credentials → OAuth 2.0 Client IDs).

The redirect URI must be: http://localhost:8765/
(Add it under "Authorized redirect URIs" on the OAuth client.)
"""
import json
import sys

try:
    from google_auth_oauthlib.flow import InstalledAppFlow
except ImportError:
    print("Missing dependency. Install with:  pip3 install google-auth-oauthlib", file=sys.stderr)
    sys.exit(1)

# Edit this list if you need additional scopes (e.g. Drive, Calendar, GBP).
SCOPES = [
    "https://www.googleapis.com/auth/webmasters",
    "https://www.googleapis.com/auth/webmasters.readonly",
    "https://www.googleapis.com/auth/analytics.readonly",
    "https://www.googleapis.com/auth/indexing",
    # Uncomment if you also want GBP (Google Business Profile) tools later:
    # "https://www.googleapis.com/auth/business.manage",
    # Uncomment for Drive read access:
    # "https://www.googleapis.com/auth/drive.readonly",
]

REDIRECT_PORT = 8765


def main() -> None:
    print("=" * 60)
    print(" Google OAuth Refresh Token Capture")
    print("=" * 60)
    print()
    print("Steps before running:")
    print("  1. Google Cloud Console → APIs & Services → Credentials")
    print("  2. Create or open an OAuth 2.0 Client ID (type: Web application)")
    print(f"  3. Add this redirect URI:  http://localhost:{REDIRECT_PORT}/")
    print("  4. Save, then paste the values below.")
    print()
    client_id = input("Client ID:     ").strip()
    client_secret = input("Client Secret: ").strip()
    if not client_id or not client_secret:
        sys.exit("Need both client_id and client_secret.")

    flow = InstalledAppFlow.from_client_config(
        {
            "web": {
                "client_id": client_id,
                "client_secret": client_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [f"http://localhost:{REDIRECT_PORT}/"],
            }
        },
        scopes=SCOPES,
    )
    creds = flow.run_local_server(
        port=REDIRECT_PORT,
        prompt="consent",  # forces refresh_token issuance
        access_type="offline",
        open_browser=True,
    )

    if not creds.refresh_token:
        sys.exit(
            "Got an access token but no refresh token. Re-run with prompt=consent. "
            "If your OAuth consent screen status is 'Testing', tokens expire after 7 days; "
            "publish the app for permanent tokens."
        )

    print()
    print("=" * 60)
    print(" SUCCESS — set these in Cloudflare Pages secrets:")
    print("=" * 60)
    print()
    print(f"GOOGLE_OAUTH_CLIENT_ID:     {creds.client_id}")
    print(f"GOOGLE_OAUTH_CLIENT_SECRET: {creds.client_secret}")
    print(f"GOOGLE_OAUTH_REFRESH_TOKEN: {creds.refresh_token}")
    print()
    print("Wrangler one-liners:")
    print(f"  echo '{creds.client_id}'     | wrangler pages secret put GOOGLE_OAUTH_CLIENT_ID --project-name=YOUR-PROJECT")
    print(f"  echo '{creds.client_secret}' | wrangler pages secret put GOOGLE_OAUTH_CLIENT_SECRET --project-name=YOUR-PROJECT")
    print(f"  echo '{creds.refresh_token}' | wrangler pages secret put GOOGLE_OAUTH_REFRESH_TOKEN --project-name=YOUR-PROJECT")
    print()
    print("Token expiry:")
    print("  - Refresh token: 7 days (if OAuth app is in 'Testing' status)")
    print("  - Refresh token: permanent (if OAuth app is 'Published')")
    print("  - Access token: 60 minutes (the bridge auto-refreshes from your refresh token)")


if __name__ == "__main__":
    main()
