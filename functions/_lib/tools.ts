/**
 * Tool definitions and dispatcher for the Google APIs MCP bridge.
 *
 * Each tool maps to a Google API endpoint with the right auth flow:
 *   - Public/keyed APIs: API key in query param
 *   - Service-account APIs (Merchant): SA JWT → access token
 *   - User-OAuth APIs (GSC, GA4, Indexing, GBP): refresh token → access token
 *   - Generic escape hatch: lets the caller specify everything
 */

import { getOAuthRefreshToken, getServiceAccountToken, AccessTokenContext } from './google-auth';

export interface ToolEnv {
  TOKENS: KVNamespace;
  GOOGLE_API_KEY: string;
  GOOGLE_PROJECT_ID: string;
  MERCHANT_ID: string;
  GA4_PROPERTY_ID: string;
  GSC_SITE_URL: string;
  GCP_SERVICE_ACCOUNT_JSON: string;
  MERCHANT_SERVICE_ACCOUNT_JSON: string;
  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;
  GOOGLE_OAUTH_REFRESH_TOKEN: string;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCallResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export const TOOLS: ToolDef[] = [
  {
    name: 'gsc_query',
    description:
      'Query Google Search Console performance data (clicks, impressions, CTR, position) for the verified site. Group by query, page, country, device, or date.',
    inputSchema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'YYYY-MM-DD (default: 28 days ago)' },
        endDate: { type: 'string', description: 'YYYY-MM-DD (default: today)' },
        dimensions: {
          type: 'array',
          items: { type: 'string', enum: ['query', 'page', 'country', 'device', 'date', 'searchAppearance'] },
          description: 'How to group the results',
        },
        rowLimit: { type: 'number', description: 'Max rows to return (default: 100, max: 25000)' },
        siteUrl: { type: 'string', description: 'Override default site URL' },
      },
    },
  },
  {
    name: 'gsc_inspect_url',
    description:
      'Inspect a URL in Search Console — see indexation status, last crawl, structured data, mobile usability, AMP, and any issues Google detected.',
    inputSchema: {
      type: 'object',
      properties: {
        inspectionUrl: { type: 'string', description: 'Full URL to inspect' },
        siteUrl: { type: 'string', description: 'Override default site URL' },
      },
      required: ['inspectionUrl'],
    },
  },
  {
    name: 'gsc_request_indexing',
    description:
      'Request Google to (re)crawl a URL via the Indexing API. Use after fixing issues. type=URL_UPDATED for new/updated, URL_DELETED for removed.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full URL to submit' },
        type: { type: 'string', enum: ['URL_UPDATED', 'URL_DELETED'], description: 'Default: URL_UPDATED' },
      },
      required: ['url'],
    },
  },
  {
    name: 'ga4_run_report',
    description:
      'Run a Google Analytics 4 report. Specify metrics, dimensions, and date range. Returns rows of data.',
    inputSchema: {
      type: 'object',
      properties: {
        metrics: {
          type: 'array',
          items: { type: 'string' },
          description: 'e.g. ["sessions","activeUsers","conversions","totalRevenue"]',
        },
        dimensions: {
          type: 'array',
          items: { type: 'string' },
          description: 'e.g. ["pagePath","country","sessionSource"]',
        },
        startDate: { type: 'string', description: 'YYYY-MM-DD or "Ndaysago" (default: 28daysago)' },
        endDate: { type: 'string', description: 'YYYY-MM-DD or "today" (default: today)' },
        limit: { type: 'number', description: 'Default 100' },
        propertyId: { type: 'string', description: 'Override default GA4 property ID' },
      },
      required: ['metrics'],
    },
  },
  {
    name: 'merchant_list',
    description:
      'List all products in Google Merchant Center with their basic info (id, title, link, price, availability).',
    inputSchema: {
      type: 'object',
      properties: {
        maxResults: { type: 'number', description: 'Default 100, max 250' },
        pageToken: { type: 'string', description: 'For pagination' },
      },
    },
  },
  {
    name: 'merchant_status',
    description:
      'Get item-level status (approved/disapproved/pending) and disapproval reasons for all Merchant Center products.',
    inputSchema: {
      type: 'object',
      properties: {
        maxResults: { type: 'number', description: 'Default 100, max 250' },
        pageToken: { type: 'string', description: 'For pagination' },
      },
    },
  },
  {
    name: 'places_search_text',
    description:
      'Google Places API (New) text search. Find places matching a free-text query. Returns name, address, location, ratings, types, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        textQuery: { type: 'string', description: 'e.g. "mediterranean restaurants in Houston"' },
        locationBias: {
          type: 'object',
          description: 'Optional: bias toward a circle (lat, lng, radius_meters)',
          properties: {
            lat: { type: 'number' },
            lng: { type: 'number' },
            radius: { type: 'number' },
          },
        },
        maxResults: { type: 'number', description: 'Default 10, max 20' },
        fields: {
          type: 'string',
          description: 'Comma-separated field mask (default: places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.types)',
        },
      },
      required: ['textQuery'],
    },
  },
  {
    name: 'places_search_nearby',
    description:
      'Google Places API (New) nearby search. Find places within a radius around a location.',
    inputSchema: {
      type: 'object',
      properties: {
        lat: { type: 'number' },
        lng: { type: 'number' },
        radius: { type: 'number', description: 'Meters, max 50000' },
        includedTypes: {
          type: 'array',
          items: { type: 'string' },
          description: 'e.g. ["restaurant","cafe"]',
        },
        maxResults: { type: 'number', description: 'Default 10, max 20' },
        fields: { type: 'string', description: 'Field mask' },
      },
      required: ['lat', 'lng', 'radius'],
    },
  },
  {
    name: 'places_get_details',
    description:
      'Google Places API (New) — get full details on a specific place by ID, including hours, photos, reviews, attributes.',
    inputSchema: {
      type: 'object',
      properties: {
        placeId: { type: 'string', description: 'Place ID (e.g. ChIJ...)' },
        fields: {
          type: 'string',
          description: 'Comma-separated field mask. Default: most useful fields. Use "*" for everything.',
        },
      },
      required: ['placeId'],
    },
  },
  {
    name: 'places_autocomplete',
    description:
      'Google Places API (New) autocomplete — predict places as the user types.',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'Partial query' },
        locationBias: {
          type: 'object',
          properties: {
            lat: { type: 'number' },
            lng: { type: 'number' },
            radius: { type: 'number' },
          },
        },
      },
      required: ['input'],
    },
  },
  {
    name: 'geocode',
    description:
      'Google Maps Geocoding — convert an address to lat/lng coordinates. Set mode=reverse to convert lat/lng to an address.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['forward', 'reverse'], description: 'Default: forward' },
        address: { type: 'string', description: 'Address (forward mode)' },
        lat: { type: 'number', description: 'Latitude (reverse mode)' },
        lng: { type: 'number', description: 'Longitude (reverse mode)' },
      },
    },
  },
  {
    name: 'distance_matrix',
    description:
      'Google Maps Distance Matrix — get travel time and distance between origins and destinations. Useful for delivery zones, ETA calculations.',
    inputSchema: {
      type: 'object',
      properties: {
        origins: {
          type: 'array',
          items: { type: 'string' },
          description: 'Addresses or "lat,lng" strings',
        },
        destinations: {
          type: 'array',
          items: { type: 'string' },
        },
        mode: { type: 'string', enum: ['driving', 'walking', 'bicycling', 'transit'], description: 'Default: driving' },
        units: { type: 'string', enum: ['metric', 'imperial'], description: 'Default: imperial' },
      },
      required: ['origins', 'destinations'],
    },
  },
  {
    name: 'directions',
    description:
      'Google Maps Directions API — get turn-by-turn directions between two locations.',
    inputSchema: {
      type: 'object',
      properties: {
        origin: { type: 'string', description: 'Address or "lat,lng"' },
        destination: { type: 'string' },
        mode: { type: 'string', enum: ['driving', 'walking', 'bicycling', 'transit'] },
      },
      required: ['origin', 'destination'],
    },
  },
  {
    name: 'pagespeed',
    description:
      'PageSpeed Insights — Core Web Vitals lab + field data for any URL. Strategy can be mobile or desktop.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        strategy: { type: 'string', enum: ['mobile', 'desktop'], description: 'Default: mobile' },
        categories: {
          type: 'array',
          items: { type: 'string', enum: ['performance', 'accessibility', 'best-practices', 'seo', 'pwa'] },
          description: 'Default: ["performance"]',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'translate',
    description:
      'Google Cloud Translation v2 — translate text between languages. Auto-detects source language if not specified.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to translate (or array of strings)' },
        target: { type: 'string', description: 'Target language code (e.g. "es","ar","fr")' },
        source: { type: 'string', description: 'Optional source language code' },
      },
      required: ['text', 'target'],
    },
  },
  {
    name: 'vision_analyze',
    description:
      'Google Cloud Vision — analyze an image. Pass either imageUrl or imageBase64. Features: labels, text (OCR), logos, landmarks, faces, safe-search.',
    inputSchema: {
      type: 'object',
      properties: {
        imageUrl: { type: 'string', description: 'Public URL of image' },
        imageBase64: { type: 'string', description: 'Base64-encoded image data (alternative)' },
        features: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['LABEL_DETECTION', 'TEXT_DETECTION', 'LOGO_DETECTION', 'LANDMARK_DETECTION', 'FACE_DETECTION', 'SAFE_SEARCH_DETECTION', 'OBJECT_LOCALIZATION', 'IMAGE_PROPERTIES'],
          },
          description: 'Default: ["LABEL_DETECTION"]',
        },
        maxResults: { type: 'number', description: 'Per feature (default 10)' },
      },
    },
  },
  {
    name: 'google_api_call',
    description:
      'Generic escape hatch — call ANY of the 120+ enabled Google APIs on this account. Specify the host, path, method, query params, and body. Auth is auto-selected based on the host: Maps/Places use API key; user-data APIs use OAuth refresh; Merchant uses its dedicated SA; everything else uses the main service account.',
    inputSchema: {
      type: 'object',
      properties: {
        host: { type: 'string', description: 'e.g. "maps.googleapis.com", "searchconsole.googleapis.com"' },
        path: { type: 'string', description: 'e.g. "/maps/api/place/details/json"' },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], description: 'Default: GET' },
        query: { type: 'object', description: 'Query parameters as object' },
        body: { type: 'object', description: 'JSON body for POST/PUT/PATCH' },
        authMode: {
          type: 'string',
          enum: ['auto', 'apikey', 'oauth_user', 'sa_main', 'sa_merchant'],
          description: 'Default: auto. Override if needed.',
        },
        scopes: {
          type: 'array',
          items: { type: 'string' },
          description: 'OAuth scopes for sa_main mode (default: cloud-platform)',
        },
      },
      required: ['host', 'path'],
    },
  },
];

// ===== Helpers =====

function ok(text: string): ToolCallResult {
  return { content: [{ type: 'text', text }] };
}

function err(text: string): ToolCallResult {
  return { content: [{ type: 'text', text }], isError: true };
}

async function googleFetch(
  url: string,
  init: RequestInit & { authHeader?: string } = {},
): Promise<unknown> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (init.authHeader) headers['Authorization'] = init.authHeader;

  const resp = await fetch(url, { ...init, headers });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 800)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function urlWithParams(base: string, params: Record<string, string | number | undefined>): string {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  return url.toString();
}

function defaultDateRange(daysBack: number): { startDate: string; endDate: string } {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - daysBack);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(today) };
}

// ===== Tool dispatchers =====

export async function callTool(name: string, args: Record<string, unknown>, env: ToolEnv): Promise<ToolCallResult> {
  try {
    switch (name) {
      case 'gsc_query': return await gscQuery(args, env);
      case 'gsc_inspect_url': return await gscInspectUrl(args, env);
      case 'gsc_request_indexing': return await gscRequestIndexing(args, env);
      case 'ga4_run_report': return await ga4RunReport(args, env);
      case 'merchant_list': return await merchantList(args, env);
      case 'merchant_status': return await merchantStatus(args, env);
      case 'places_search_text': return await placesSearchText(args, env);
      case 'places_search_nearby': return await placesSearchNearby(args, env);
      case 'places_get_details': return await placesGetDetails(args, env);
      case 'places_autocomplete': return await placesAutocomplete(args, env);
      case 'geocode': return await geocode(args, env);
      case 'distance_matrix': return await distanceMatrix(args, env);
      case 'directions': return await directions(args, env);
      case 'pagespeed': return await pagespeed(args, env);
      case 'translate': return await translate(args, env);
      case 'vision_analyze': return await visionAnalyze(args, env);
      case 'google_api_call': return await googleApiCall(args, env);
      default: return err(`Unknown tool: ${name}`);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return err(`Tool ${name} failed: ${msg}`);
  }
}

// ----- Search Console -----

async function gscQuery(args: Record<string, unknown>, env: ToolEnv): Promise<ToolCallResult> {
  const token = await getUserOAuthToken(env, 'gsc');
  const range = (args.startDate && args.endDate)
    ? { startDate: String(args.startDate), endDate: String(args.endDate) }
    : defaultDateRange(28);
  const siteUrl = String(args.siteUrl ?? env.GSC_SITE_URL);
  const body = {
    startDate: range.startDate,
    endDate: range.endDate,
    dimensions: (args.dimensions as string[]) ?? ['query'],
    rowLimit: Number(args.rowLimit ?? 100),
  };
  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const data = await googleFetch(url, {
    method: 'POST',
    body: JSON.stringify(body),
    authHeader: `Bearer ${token}`,
  });
  return ok(JSON.stringify(data, null, 2));
}

async function gscInspectUrl(args: Record<string, unknown>, env: ToolEnv): Promise<ToolCallResult> {
  const token = await getUserOAuthToken(env, 'gsc');
  const siteUrl = String(args.siteUrl ?? env.GSC_SITE_URL);
  const body = {
    inspectionUrl: String(args.inspectionUrl),
    siteUrl,
  };
  const data = await googleFetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
    method: 'POST',
    body: JSON.stringify(body),
    authHeader: `Bearer ${token}`,
  });
  return ok(JSON.stringify(data, null, 2));
}

async function gscRequestIndexing(args: Record<string, unknown>, env: ToolEnv): Promise<ToolCallResult> {
  const token = await getUserOAuthToken(env, 'indexing');
  const body = {
    url: String(args.url),
    type: String(args.type ?? 'URL_UPDATED'),
  };
  const data = await googleFetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
    method: 'POST',
    body: JSON.stringify(body),
    authHeader: `Bearer ${token}`,
  });
  return ok(JSON.stringify(data, null, 2));
}

// ----- GA4 -----

async function ga4RunReport(args: Record<string, unknown>, env: ToolEnv): Promise<ToolCallResult> {
  const token = await getUserOAuthToken(env, 'analytics');
  const propertyId = String(args.propertyId ?? env.GA4_PROPERTY_ID);
  const body = {
    dateRanges: [{ startDate: String(args.startDate ?? '28daysago'), endDate: String(args.endDate ?? 'today') }],
    metrics: ((args.metrics as string[]) ?? ['sessions']).map(name => ({ name })),
    dimensions: ((args.dimensions as string[]) ?? []).map(name => ({ name })),
    limit: String(args.limit ?? 100),
  };
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
  const data = await googleFetch(url, {
    method: 'POST',
    body: JSON.stringify(body),
    authHeader: `Bearer ${token}`,
  });
  return ok(JSON.stringify(data, null, 2));
}

// ----- Merchant Center -----

async function merchantList(args: Record<string, unknown>, env: ToolEnv): Promise<ToolCallResult> {
  const token = await getMerchantSAToken(env);
  const params: Record<string, string> = { maxResults: String(args.maxResults ?? 100) };
  if (args.pageToken) params.pageToken = String(args.pageToken);
  const url = urlWithParams(`https://shoppingcontent.googleapis.com/content/v2.1/${env.MERCHANT_ID}/products`, params);
  const data = await googleFetch(url, { authHeader: `Bearer ${token}` });
  return ok(JSON.stringify(data, null, 2));
}

async function merchantStatus(args: Record<string, unknown>, env: ToolEnv): Promise<ToolCallResult> {
  const token = await getMerchantSAToken(env);
  const params: Record<string, string> = { maxResults: String(args.maxResults ?? 100) };
  if (args.pageToken) params.pageToken = String(args.pageToken);
  const url = urlWithParams(`https://shoppingcontent.googleapis.com/content/v2.1/${env.MERCHANT_ID}/productstatuses`, params);
  const data = await googleFetch(url, { authHeader: `Bearer ${token}` });
  return ok(JSON.stringify(data, null, 2));
}

// ----- Places (New) -----

const DEFAULT_PLACES_FIELD_MASK =
  'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.types,places.priceLevel,places.businessStatus';

async function placesSearchText(args: Record<string, unknown>, env: ToolEnv): Promise<ToolCallResult> {
  const body: Record<string, unknown> = {
    textQuery: String(args.textQuery),
    maxResultCount: Math.min(Number(args.maxResults ?? 10), 20),
  };
  if (args.locationBias) {
    const lb = args.locationBias as { lat: number; lng: number; radius: number };
    body.locationBias = {
      circle: { center: { latitude: lb.lat, longitude: lb.lng }, radius: lb.radius },
    };
  }
  const fields = String(args.fields ?? DEFAULT_PLACES_FIELD_MASK);
  const data = await googleFetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'X-Goog-Api-Key': env.GOOGLE_API_KEY, 'X-Goog-FieldMask': fields },
  });
  return ok(JSON.stringify(data, null, 2));
}

async function placesSearchNearby(args: Record<string, unknown>, env: ToolEnv): Promise<ToolCallResult> {
  const body: Record<string, unknown> = {
    locationRestriction: {
      circle: {
        center: { latitude: Number(args.lat), longitude: Number(args.lng) },
        radius: Number(args.radius),
      },
    },
    maxResultCount: Math.min(Number(args.maxResults ?? 10), 20),
  };
  if (args.includedTypes) body.includedTypes = args.includedTypes;
  const fields = String(args.fields ?? DEFAULT_PLACES_FIELD_MASK);
  const data = await googleFetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'X-Goog-Api-Key': env.GOOGLE_API_KEY, 'X-Goog-FieldMask': fields },
  });
  return ok(JSON.stringify(data, null, 2));
}

async function placesGetDetails(args: Record<string, unknown>, env: ToolEnv): Promise<ToolCallResult> {
  const placeId = String(args.placeId);
  const fields = String(args.fields ?? '*');
  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`;
  const data = await googleFetch(url, {
    headers: { 'X-Goog-Api-Key': env.GOOGLE_API_KEY, 'X-Goog-FieldMask': fields },
  });
  return ok(JSON.stringify(data, null, 2));
}

async function placesAutocomplete(args: Record<string, unknown>, env: ToolEnv): Promise<ToolCallResult> {
  const body: Record<string, unknown> = { input: String(args.input) };
  if (args.locationBias) {
    const lb = args.locationBias as { lat: number; lng: number; radius: number };
    body.locationBias = {
      circle: { center: { latitude: lb.lat, longitude: lb.lng }, radius: lb.radius },
    };
  }
  const data = await googleFetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'X-Goog-Api-Key': env.GOOGLE_API_KEY },
  });
  return ok(JSON.stringify(data, null, 2));
}

// ----- Maps -----

async function geocode(args: Record<string, unknown>, env: ToolEnv): Promise<ToolCallResult> {
  const mode = String(args.mode ?? 'forward');
  const params: Record<string, string> = { key: env.GOOGLE_API_KEY };
  if (mode === 'reverse') {
    params.latlng = `${args.lat},${args.lng}`;
  } else {
    params.address = String(args.address);
  }
  const url = urlWithParams('https://maps.googleapis.com/maps/api/geocode/json', params);
  const data = await googleFetch(url);
  return ok(JSON.stringify(data, null, 2));
}

async function distanceMatrix(args: Record<string, unknown>, env: ToolEnv): Promise<ToolCallResult> {
  const params: Record<string, string> = {
    origins: (args.origins as string[]).join('|'),
    destinations: (args.destinations as string[]).join('|'),
    mode: String(args.mode ?? 'driving'),
    units: String(args.units ?? 'imperial'),
    key: env.GOOGLE_API_KEY,
  };
  const url = urlWithParams('https://maps.googleapis.com/maps/api/distancematrix/json', params);
  const data = await googleFetch(url);
  return ok(JSON.stringify(data, null, 2));
}

async function directions(args: Record<string, unknown>, env: ToolEnv): Promise<ToolCallResult> {
  const params: Record<string, string> = {
    origin: String(args.origin),
    destination: String(args.destination),
    mode: String(args.mode ?? 'driving'),
    key: env.GOOGLE_API_KEY,
  };
  const url = urlWithParams('https://maps.googleapis.com/maps/api/directions/json', params);
  const data = await googleFetch(url);
  return ok(JSON.stringify(data, null, 2));
}

// ----- PageSpeed -----

async function pagespeed(args: Record<string, unknown>, env: ToolEnv): Promise<ToolCallResult> {
  const params: Record<string, string> = {
    url: String(args.url),
    strategy: String(args.strategy ?? 'mobile'),
    key: env.GOOGLE_API_KEY,
  };
  const cats = (args.categories as string[]) ?? ['performance'];
  const baseUrl = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  for (const [k, v] of Object.entries(params)) baseUrl.searchParams.set(k, v);
  for (const c of cats) baseUrl.searchParams.append('category', c);
  const data = await googleFetch(baseUrl.toString());
  return ok(JSON.stringify(data, null, 2));
}

// ----- Translation -----

async function translate(args: Record<string, unknown>, env: ToolEnv): Promise<ToolCallResult> {
  const params: Record<string, string> = {
    target: String(args.target),
    key: env.GOOGLE_API_KEY,
    format: 'text',
  };
  if (args.source) params.source = String(args.source);
  const url = new URL('https://translation.googleapis.com/language/translate/v2');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const text = args.text;
  if (Array.isArray(text)) {
    for (const t of text) url.searchParams.append('q', String(t));
  } else {
    url.searchParams.append('q', String(text));
  }
  const data = await googleFetch(url.toString(), { method: 'POST' });
  return ok(JSON.stringify(data, null, 2));
}

// ----- Vision -----

async function visionAnalyze(args: Record<string, unknown>, env: ToolEnv): Promise<ToolCallResult> {
  const features = ((args.features as string[]) ?? ['LABEL_DETECTION']).map(type => ({
    type,
    maxResults: Number(args.maxResults ?? 10),
  }));
  const image = args.imageBase64
    ? { content: String(args.imageBase64) }
    : { source: { imageUri: String(args.imageUrl) } };
  const body = { requests: [{ image, features }] };
  const url = `https://vision.googleapis.com/v1/images:annotate?key=${env.GOOGLE_API_KEY}`;
  const data = await googleFetch(url, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return ok(JSON.stringify(data, null, 2));
}

// ----- Generic escape hatch -----

async function googleApiCall(args: Record<string, unknown>, env: ToolEnv): Promise<ToolCallResult> {
  const host = String(args.host);
  const path = String(args.path);
  const method = String(args.method ?? 'GET').toUpperCase();
  const query = (args.query as Record<string, string>) ?? {};
  const body = args.body;

  // auth selection
  let authMode = String(args.authMode ?? 'auto');
  if (authMode === 'auto') {
    if (host.includes('maps.googleapis.com') || host.includes('places.googleapis.com') ||
        host.includes('translation.googleapis.com') || host.includes('vision.googleapis.com') ||
        host === 'www.googleapis.com' && path.includes('pagespeed')) {
      authMode = 'apikey';
    } else if (host.includes('searchconsole.googleapis.com') || host.includes('webmasters.googleapis.com') ||
               host.includes('analyticsdata.googleapis.com') || host.includes('analyticsadmin.googleapis.com') ||
               host.includes('indexing.googleapis.com') || host.includes('businessprofileperformance.googleapis.com') ||
               host.includes('mybusinessbusinessinformation.googleapis.com') || host.includes('mybusinessaccountmanagement.googleapis.com')) {
      authMode = 'oauth_user';
    } else if (host.includes('shoppingcontent.googleapis.com')) {
      authMode = 'sa_merchant';
    } else {
      authMode = 'sa_main';
    }
  }

  const url = new URL(`https://${host}${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (authMode === 'apikey') {
    url.searchParams.set('key', env.GOOGLE_API_KEY);
  } else if (authMode === 'oauth_user') {
    const t = await getUserOAuthToken(env, 'generic');
    headers['Authorization'] = `Bearer ${t}`;
  } else if (authMode === 'sa_merchant') {
    const t = await getMerchantSAToken(env);
    headers['Authorization'] = `Bearer ${t}`;
  } else if (authMode === 'sa_main') {
    const scopes = (args.scopes as string[]) ?? ['https://www.googleapis.com/auth/cloud-platform'];
    const t = await getServiceAccountToken(
      { kv: env.TOKENS, cacheKey: `sa_main:${scopes.join(',')}` },
      env.GCP_SERVICE_ACCOUNT_JSON,
      scopes,
    );
    headers['Authorization'] = `Bearer ${t}`;
  }

  const init: RequestInit = { method, headers };
  if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
    init.body = JSON.stringify(body);
  }

  const resp = await fetch(url.toString(), init);
  const text = await resp.text();
  return ok(JSON.stringify({ status: resp.status, ok: resp.ok, body: tryJson(text) }, null, 2));
}

function tryJson(t: string): unknown {
  try { return JSON.parse(t); } catch { return t; }
}

// ===== Auth helpers =====

async function getUserOAuthToken(env: ToolEnv, _purpose: string): Promise<string> {
  return getOAuthRefreshToken(
    { kv: env.TOKENS, cacheKey: 'oauth_user_token' },
    {
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN,
    },
  );
}

async function getMerchantSAToken(env: ToolEnv): Promise<string> {
  return getServiceAccountToken(
    { kv: env.TOKENS, cacheKey: 'merchant_sa_token' },
    env.MERCHANT_SERVICE_ACCOUNT_JSON,
    ['https://www.googleapis.com/auth/content'],
  );
}
