import { vi } from 'vitest';

type Handler = (init: RequestInit | undefined) => { status: number; body?: unknown };

const json = (status: number, body: unknown): Response =>
  status === 204
    ? new Response(null, { status })
    : new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * Stubs fetch with per-endpoint handlers keyed by "METHOD /path" (path relative to /api/v1).
 * Unknown endpoints return 404. Returns the mock so tests can inspect calls.
 */
export function mockApi(handlers: Record<string, Handler>) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const key = `${init?.method ?? 'GET'} ${url.pathname.replace(/^\/api\/v1/, '')}`;
    const handler = handlers[key];
    const result = handler ? handler(init) : { status: 404, body: { statusCode: 404, message: 'Not Found' } };
    return Promise.resolve(json(result.status, result.body ?? null));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export const OWNER = { id: 'u-owner', fullName: 'Ayesha Khan', email: 'owner@example.com', role: 'OWNER' } as const;
export const COOK = { id: 'u-cook', fullName: 'Bilal Ahmed', email: 'cook@example.com', role: 'KITCHEN_STAFF' } as const;

export const signedOut = { 'GET /auth/me': () => ({ status: 401, body: { statusCode: 401, message: 'Authentication required.' } }) };
export const signedInAs = (user: object) => ({ 'GET /auth/me': () => ({ status: 200, body: user }) });
export const healthy = {
  'GET /health': () => ({ status: 200, body: { status: 'ok', database: 'up', timestamp: new Date().toISOString() } }),
};
