/**
 * Google APIs MCP Bridge — catch-all Pages Function.
 *
 * Gives claude.ai (or any MCP client that speaks OAuth 2.1 + PKCE) access to
 * Google APIs through a Cloudflare Pages Function.
 *
 * Architecture:
 *   - OAuth 2.1 + PKCE flow (compatible with claude.ai connector flow)
 *   - Email + admin-password gate at /authorize (single-user by design)
 *   - Bearer-token-protected /mcp endpoint
 *   - /mcp implements MCP Streamable-HTTP protocol natively
 *   - Tool dispatcher proxies to Google APIs with the right auth flow
 *
 * Repo: https://github.com/Nas198222/google-mcp-bridge
 */

import { TOOLS, callTool, ToolEnv } from './_lib/tools';

interface Env extends ToolEnv {
  TOKENS: KVNamespace;
  ADMIN_PASSWORD: string;
  ALLOWED_EMAIL: string;
  ISSUER: string;
  SITE_NAME?: string;
  LOGIN_TITLE?: string;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Max-Age': '86400',
};

const PROTOCOL_VERSION = '2025-06-18';

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...extra },
  });
}

function htmlResp(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS_HEADERS },
  });
}

function randId(len = 32): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256b64url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

interface LoginCtx {
  client_id: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  code_challenge_method: string;
  resource: string;
  error?: string;
  siteName: string;
  loginTitle: string;
  issuer: string;
}

function renderLoginPage(ctx: LoginCtx): string {
  return `<!doctype html>
<html><head>
<meta charset="utf-8" />
<title>${esc(ctx.siteName)} · ${esc(ctx.loginTitle)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  :root { --o:#4285F4; --d:#0E0E10; --c:#FFFFFF; --s:#E8EAED; --slate:#5F6368; --green:#34A853; }
  body{background:var(--d);color:var(--c);font-family:-apple-system,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}
  .card{background:var(--c);color:var(--d);border-radius:14px;padding:32px;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.4)}
  h1{color:var(--o);font-size:18px;letter-spacing:2px;margin:0 0 6px;text-transform:uppercase;font-family:sans-serif}
  .sub-title{font-size:11px;color:var(--green);font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:18px}
  p{color:var(--slate);font-size:14px;margin:0 0 20px;line-height:1.5}
  label{display:block;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--slate);margin-bottom:6px;margin-top:14px}
  input{width:100%;padding:11px 13px;font-size:15px;border:1.5px solid var(--s);border-radius:8px;outline:none;font-family:inherit;box-sizing:border-box}
  input:focus{border-color:var(--o)}
  button{width:100%;background:var(--o);color:#fff;border:none;border-radius:8px;padding:13px;font-size:14px;font-weight:700;letter-spacing:2px;cursor:pointer;margin-top:20px;text-transform:uppercase}
  button:hover{background:#3367d6}
  .err{color:#d94040;background:rgba(217,64,64,0.1);padding:10px 13px;border-radius:6px;font-size:13px;margin-top:12px}
  .sub{color:var(--slate);font-size:11px;margin-top:18px;text-align:center;line-height:1.5}
  .scope{display:inline-block;background:#F1F3F4;color:var(--slate);font-size:10px;padding:3px 8px;border-radius:10px;margin:2px;font-weight:600}
</style></head>
<body>
<form class="card" method="POST" action="/authorize">
  <h1>🌐 ${esc(ctx.siteName)}</h1>
  <div class="sub-title">${esc(ctx.loginTitle)}</div>
  <p>Connect <strong>claude.ai</strong> to Google APIs (Search Console, GA4, Merchant Center, Maps, Places, Vision, Translation, and more).</p>
  ${ctx.error ? `<div class="err">${esc(ctx.error)}</div>` : ''}
  <label>Email</label>
  <input name="email" type="email" required autofocus />
  <label>Admin Password</label>
  <input name="password" type="password" required />
  <input name="client_id" type="hidden" value="${esc(ctx.client_id)}" />
  <input name="redirect_uri" type="hidden" value="${esc(ctx.redirect_uri)}" />
  <input name="state" type="hidden" value="${esc(ctx.state)}" />
  <input name="code_challenge" type="hidden" value="${esc(ctx.code_challenge)}" />
  <input name="code_challenge_method" type="hidden" value="${esc(ctx.code_challenge_method)}" />
  <input name="resource" type="hidden" value="${esc(ctx.resource)}" />
  <button type="submit">Authorize</button>
  <div class="sub">
    <div style="margin-bottom:6px">Available scopes:</div>
    <span class="scope">Search Console</span>
    <span class="scope">GA4</span>
    <span class="scope">Merchant</span>
    <span class="scope">Maps</span>
    <span class="scope">Places</span>
    <span class="scope">Vision</span>
    <span class="scope">Translation</span>
    <span class="scope">PageSpeed</span>
    <div style="margin-top:14px;font-size:10px">Token valid for 24 hours · Bridge issued by ${esc(new URL(ctx.issuer).hostname)}</div>
  </div>
</form>
</body></html>`;
}

// ===== MCP protocol handler =====

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

async function handleMcpRequest(req: JsonRpcRequest, env: Env): Promise<unknown> {
  const id = req.id ?? null;

  if (req.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'google-mcp-bridge', version: '1.0.0' },
      },
    };
  }

  if (req.method === 'notifications/initialized') {
    return null; // notification, no response
  }

  if (req.method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: { tools: TOOLS },
    };
  }

  if (req.method === 'tools/call') {
    const params = req.params ?? {};
    const name = String(params.name ?? '');
    const args = (params.arguments as Record<string, unknown>) ?? {};
    const result = await callTool(name, args, env);
    return {
      jsonrpc: '2.0',
      id,
      result,
    };
  }

  if (req.method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} };
  }

  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${req.method}` },
  };
}

// ===== Main router =====

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Discovery endpoints (claude.ai uses these to find the auth server)
  if (path === '/.well-known/oauth-protected-resource' || path === '/.well-known/oauth-protected-resource/mcp') {
    return json({
      resource: env.ISSUER + '/mcp',
      authorization_servers: [env.ISSUER],
      bearer_methods_supported: ['header'],
      resource_documentation: env.ISSUER,
    });
  }

  if (path === '/.well-known/oauth-authorization-server') {
    return json({
      issuer: env.ISSUER,
      authorization_endpoint: env.ISSUER + '/authorize',
      token_endpoint: env.ISSUER + '/token',
      registration_endpoint: env.ISSUER + '/register',
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
      scopes_supported: ['mcp'],
    });
  }

  // Dynamic Client Registration
  if (path === '/register' && method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const client_id = randId(16);
    const client_record = {
      client_id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: body.redirect_uris ?? [],
      grant_types: body.grant_types ?? ['authorization_code', 'refresh_token'],
      response_types: body.response_types ?? ['code'],
      token_endpoint_auth_method: 'none',
      client_name: body.client_name ?? 'unknown',
    };
    await env.TOKENS.put(`client:${client_id}`, JSON.stringify(client_record), { expirationTtl: 60 * 60 * 24 * 365 });
    return json(client_record, 201);
  }

  // Authorize GET — render login form
  if (path === '/authorize' && method === 'GET') {
    const p = url.searchParams;
    const client_id = p.get('client_id') ?? '';
    const redirect_uri = p.get('redirect_uri') ?? '';
    const response_type = p.get('response_type') ?? '';
    const state = p.get('state') ?? '';
    const code_challenge = p.get('code_challenge') ?? '';
    const code_challenge_method = p.get('code_challenge_method') ?? 'S256';
    const resource = p.get('resource') ?? '';

    if (response_type !== 'code') return json({ error: 'unsupported_response_type' }, 400);
    if (!client_id || !redirect_uri || !code_challenge) return json({ error: 'invalid_request' }, 400);

    const clientJson = await env.TOKENS.get(`client:${client_id}`);
    if (!clientJson) return json({ error: 'invalid_client' }, 400);

    return htmlResp(renderLoginPage({
      client_id, redirect_uri, state, code_challenge, code_challenge_method, resource,
      siteName: env.SITE_NAME ?? 'Google MCP',
      loginTitle: env.LOGIN_TITLE ?? 'Bridge',
      issuer: env.ISSUER,
    }));
  }

  // Authorize POST — verify credentials and issue code
  if (path === '/authorize' && method === 'POST') {
    const form = await request.formData();
    const email = String(form.get('email') ?? '').trim().toLowerCase();
    const password = String(form.get('password') ?? '');
    const client_id = String(form.get('client_id') ?? '');
    const redirect_uri = String(form.get('redirect_uri') ?? '');
    const state = String(form.get('state') ?? '');
    const code_challenge = String(form.get('code_challenge') ?? '');
    const code_challenge_method = String(form.get('code_challenge_method') ?? 'S256');
    const resource = String(form.get('resource') ?? '');

    if (email !== env.ALLOWED_EMAIL.toLowerCase() || password !== env.ADMIN_PASSWORD) {
      return htmlResp(
        renderLoginPage({
          client_id, redirect_uri, state, code_challenge, code_challenge_method, resource,
          error: 'Wrong email or password.',
          siteName: env.SITE_NAME ?? 'Google MCP',
          loginTitle: env.LOGIN_TITLE ?? 'Bridge',
          issuer: env.ISSUER,
        }),
        401,
      );
    }

    const code = randId(24);
    await env.TOKENS.put(
      `code:${code}`,
      JSON.stringify({ client_id, redirect_uri, code_challenge, code_challenge_method, resource, email, created: Date.now() }),
      { expirationTtl: 600 },
    );

    const redirect = new URL(redirect_uri);
    redirect.searchParams.set('code', code);
    if (state) redirect.searchParams.set('state', state);
    return Response.redirect(redirect.toString(), 302);
  }

  // Token endpoint
  if (path === '/token' && method === 'POST') {
    const form = await request.formData();
    const grant_type = String(form.get('grant_type') ?? '');

    if (grant_type === 'authorization_code') {
      const code = String(form.get('code') ?? '');
      const code_verifier = String(form.get('code_verifier') ?? '');
      const redirect_uri = String(form.get('redirect_uri') ?? '');
      const client_id = String(form.get('client_id') ?? '');

      const raw = await env.TOKENS.get(`code:${code}`);
      if (!raw) return json({ error: 'invalid_grant' }, 400);
      const stored = JSON.parse(raw);

      if (stored.client_id !== client_id || stored.redirect_uri !== redirect_uri) {
        return json({ error: 'invalid_grant' }, 400);
      }

      const expected = await sha256b64url(code_verifier);
      if (expected !== stored.code_challenge) {
        return json({ error: 'invalid_grant', detail: 'PKCE mismatch' }, 400);
      }

      await env.TOKENS.delete(`code:${code}`);

      const access_token = randId(32);
      const refresh_token = randId(32);
      await env.TOKENS.put(
        `token:${access_token}`,
        JSON.stringify({ client_id, email: stored.email, created: Date.now() }),
        { expirationTtl: 60 * 60 * 24 },
      );
      await env.TOKENS.put(
        `refresh:${refresh_token}`,
        JSON.stringify({ client_id, email: stored.email }),
        { expirationTtl: 60 * 60 * 24 * 30 },
      );

      return json({ access_token, token_type: 'Bearer', expires_in: 86400, refresh_token, scope: 'mcp' });
    }

    if (grant_type === 'refresh_token') {
      const refresh_token = String(form.get('refresh_token') ?? '');
      const raw = await env.TOKENS.get(`refresh:${refresh_token}`);
      if (!raw) return json({ error: 'invalid_grant' }, 400);
      const stored = JSON.parse(raw);
      const access_token = randId(32);
      await env.TOKENS.put(
        `token:${access_token}`,
        JSON.stringify({ client_id: stored.client_id, email: stored.email, created: Date.now() }),
        { expirationTtl: 60 * 60 * 24 },
      );
      return json({ access_token, token_type: 'Bearer', expires_in: 86400, scope: 'mcp' });
    }

    return json({ error: 'unsupported_grant_type' }, 400);
  }

  // MCP endpoint (Streamable HTTP)
  if (path === '/mcp' || path.startsWith('/mcp/')) {
    const authHeader = request.headers.get('Authorization') ?? '';
    const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
    if (!bearer) {
      return new Response(JSON.stringify({ error: 'missing_token' }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': `Bearer resource_metadata="${env.ISSUER}/.well-known/oauth-protected-resource"`,
          ...CORS_HEADERS,
        },
      });
    }

    const tokenRaw = await env.TOKENS.get(`token:${bearer}`);
    if (!tokenRaw) {
      return new Response(JSON.stringify({ error: 'invalid_token' }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': `Bearer error="invalid_token", resource_metadata="${env.ISSUER}/.well-known/oauth-protected-resource"`,
          ...CORS_HEADERS,
        },
      });
    }

    if (method === 'GET') {
      // Some MCP clients open a GET stream; we don't push notifications, so just 405
      return new Response(null, { status: 405, headers: CORS_HEADERS });
    }

    if (method !== 'POST') {
      return new Response(null, { status: 405, headers: CORS_HEADERS });
    }

    const body = (await request.json().catch(() => null)) as JsonRpcRequest | JsonRpcRequest[] | null;
    if (!body) return json({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } }, 400);

    if (Array.isArray(body)) {
      const results = await Promise.all(body.map(r => handleMcpRequest(r, env)));
      return json(results.filter(r => r !== null));
    }

    const result = await handleMcpRequest(body, env);
    if (result === null) {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    return json(result);
  }

  // Health check
  if (path === '/health' || path === '/api/health') {
    return json({
      name: 'Google APIs MCP Bridge',
      status: 'ok',
      issuer: env.ISSUER,
      mcp_endpoint: env.ISSUER + '/mcp',
      tools: TOOLS.length,
      tool_names: TOOLS.map(t => t.name),
    });
  }

  // Fall through — let Pages serve static content for unmatched paths
  return new Response(null, { status: 404 });
};
