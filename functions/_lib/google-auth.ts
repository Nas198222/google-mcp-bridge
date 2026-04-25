/**
 * Google authentication helpers for Cloudflare Workers / Pages Functions.
 *
 * Two flows supported:
 *   1. Service account flow: sign a JWT with the SA private key, exchange for an
 *      access token. Used for Maps/Places/Vision/Translate/PageSpeed and Merchant
 *      Center (its own SA).
 *   2. User OAuth refresh flow: exchange a refresh_token for a fresh access token.
 *      Used for Search Console, GA4, Indexing API, Drive (read), GBP.
 *
 * Tokens are cached in KV with a 55-minute TTL (Google access tokens are valid
 * for 60 minutes; we leave a 5-minute safety margin).
 */

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  project_id: string;
  token_uri: string;
}

interface OAuthClient {
  client_id: string;
  client_secret: string;
  refresh_token: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

const TOKEN_CACHE_TTL_SECONDS = 55 * 60;
const GOOGLE_TOKEN_URI = 'https://oauth2.googleapis.com/token';

function base64UrlEncode(input: string | ArrayBuffer): string {
  const bytes = typeof input === 'string'
    ? new TextEncoder().encode(input)
    : new Uint8Array(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const cleaned = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const keyBuffer = pemToArrayBuffer(pem);
  return crypto.subtle.importKey(
    'pkcs8',
    keyBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function signServiceAccountJwt(sa: ServiceAccountKey, scopes: string[]): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email,
    scope: scopes.join(' '),
    aud: sa.token_uri || GOOGLE_TOKEN_URI,
    iat: now,
    exp: now + 3600,
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const toSign = `${encodedHeader}.${encodedPayload}`;

  const key = await importPrivateKey(sa.private_key);
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(toSign),
  );

  return `${toSign}.${base64UrlEncode(signature)}`;
}

export interface AccessTokenContext {
  kv: KVNamespace;
  cacheKey: string;
}

export async function getServiceAccountToken(
  ctx: AccessTokenContext,
  serviceAccountJson: string,
  scopes: string[],
): Promise<string> {
  const cached = await ctx.kv.get(ctx.cacheKey);
  if (cached) return cached;

  const sa = JSON.parse(serviceAccountJson) as ServiceAccountKey;
  const jwt = await signServiceAccountJwt(sa, scopes);

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  });

  const resp = await fetch(sa.token_uri || GOOGLE_TOKEN_URI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`SA token exchange failed: ${resp.status} ${err}`);
  }

  const tokenResp = (await resp.json()) as TokenResponse;
  await ctx.kv.put(ctx.cacheKey, tokenResp.access_token, { expirationTtl: TOKEN_CACHE_TTL_SECONDS });
  return tokenResp.access_token;
}

export async function getOAuthRefreshToken(
  ctx: AccessTokenContext,
  client: OAuthClient,
): Promise<string> {
  const cached = await ctx.kv.get(ctx.cacheKey);
  if (cached) return cached;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: client.client_id,
    client_secret: client.client_secret,
    refresh_token: client.refresh_token,
  });

  const resp = await fetch(GOOGLE_TOKEN_URI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OAuth refresh failed: ${resp.status} ${err}`);
  }

  const tokenResp = (await resp.json()) as TokenResponse;
  await ctx.kv.put(ctx.cacheKey, tokenResp.access_token, { expirationTtl: TOKEN_CACHE_TTL_SECONDS });
  return tokenResp.access_token;
}
