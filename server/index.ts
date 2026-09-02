// AXIOM SIEGE worker entrypoint.
//  - /ws  : upgrade request tunneled into a MatchDO (identified by room code)
//  - /api/*: tiny JSON endpoints (health)
//  - everything else: served from [assets] (the built client/ SPA)
import { MatchDO } from './matchdo.ts';

export { MatchDO };

export interface Env {
  MATCHES: DurableObjectNamespace;
  ASSETS: Fetcher;
  APP_NAME: string;
  APP_VERSION: string;
  TICK_RATE: string;
  MAX_PLAYERS: string;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

function sanitizeName(raw: string | null, fallback = 'HOSTILE'): string {
  if (!raw) return fallback;
  const s = raw.replace(/[<>&"]/g, '').trim().slice(0, 18);
  return s || fallback;
}

function sanitizeCode(raw: string | null): string | null {
  if (!raw) return null;
  const c = raw.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase().slice(0, 32);
  return c.length >= 3 ? c : null;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/health') {
      return json({ ok: true, app: env.APP_NAME, version: env.APP_VERSION }, 200);
    }
    if (path === '/api/match/join' && request.method === 'POST') {
      // returns a room code (existing or fresh) for a quick-play lobby
      const body = (await request.json().catch(() => ({}))) as { code?: string; name?: string };
      const code = sanitizeCode(body.code ?? null) ?? sanitizeCode(url.searchParams.get('code'));
      return json({ code: code ?? fallbackCode(), name: sanitizeName(body.name ?? null) }, 200);
    }

    if (path === '/ws') {
      const code = sanitizeCode(url.searchParams.get('code'));
      if (!code) return json({ error: 'room code required' }, 400);
      const id = url.searchParams.get('id') || crypto.randomUUID();
      url.searchParams.set('id', id);
      url.searchParams.set('name', sanitizeName(url.searchParams.get('name')));
      const size = clampInt(url.searchParams.get('size'), 1, 5, 5);
      url.searchParams.set('size', String(size));
      const room = env.MATCHES.get(env.MATCHES.idFromName('room:' + code));
      return room.fetch(new Request(url.toString(), request), {});
    }

    // non-ws GET falls through to assets automatically when configured; give a
    // friendly hint for anything the asset layer couldn't resolve.
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (path.startsWith('/api/')) return json({ error: 'not found' }, 404);
    return new Response('AXIOM SIEGE worker', { status: 200 });
  },
} satisfies ExportedHandler<Env>;

function json(o: unknown, status = 200): Response {
  return new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...CORS } });
}
function clampInt(v: string | null, lo: number, hi: number, dflt: number): number {
  const n = parseInt(v ?? '', 10);
  if (isNaN(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}
function fallbackCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 5; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}
