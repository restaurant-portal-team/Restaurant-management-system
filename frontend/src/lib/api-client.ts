import { env } from './env';

/** Error raised for any failed API call. Message is always safe to show to users. */
export class ApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface RequestOptions {
  signal?: AbortSignal | undefined;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Low-level JSON request. Always sends the HttpOnly session cookie (credentials: 'include');
 * the browser adds the Origin header that the API's CSRF check requires for POST/PATCH/PUT/DELETE.
 * Returns undefined for 204 No Content.
 */
async function request<T>(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body: unknown,
  options: RequestOptions,
): Promise<T> {
  if (!path.startsWith('/')) {
    throw new ApiError('Invalid API path.', null);
  }

  const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`${env.apiBaseUrl}${path}`, {
      method,
      headers,
      credentials: 'include',
      signal,
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError('The server could not be reached.', null);
  }

  if (response.status === 204) {
    if (!response.ok) throw new ApiError('The request failed.', response.status);
    return undefined as T;
  }

  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    // Non-JSON body: treated as an unexpected response below.
  }

  if (!response.ok) {
    throw new ApiError(extractMessage(parsed) ?? 'The request failed.', response.status);
  }
  if (parsed === null) {
    throw new ApiError('Unexpected response from the server.', response.status);
  }

  return parsed as T;
}

/** JSON GET. Paths are relative to VITE_API_BASE_URL (e.g. "/health"). */
export function apiGet<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return request<T>('GET', path, undefined, options);
}

/** JSON POST (body optional). */
export function apiPost<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  return request<T>('POST', path, body, options);
}

/** JSON PATCH (partial update). */
export function apiPatch<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
  return request<T>('PATCH', path, body, options);
}

function extractMessage(body: unknown): string | null {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const { message } = body;
    if (typeof message === 'string') return message;
  }
  return null;
}
