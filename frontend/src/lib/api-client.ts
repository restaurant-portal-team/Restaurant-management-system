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
 * Minimal JSON GET helper. Paths are relative to VITE_API_BASE_URL (e.g. "/health").
 * Mutating helpers, auth and CSRF handling are added in later features (F03+).
 */
export async function apiGet<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!path.startsWith('/')) {
    throw new ApiError('Invalid API path.', null);
  }

  const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;

  let response: Response;
  try {
    response = await fetch(`${env.apiBaseUrl}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch {
    throw new ApiError('The server could not be reached.', null);
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON body: treated as an unexpected response below.
  }

  if (!response.ok) {
    throw new ApiError(extractMessage(body) ?? 'The request failed.', response.status);
  }
  if (body === null) {
    throw new ApiError('Unexpected response from the server.', response.status);
  }

  return body as T;
}

function extractMessage(body: unknown): string | null {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const { message } = body;
    if (typeof message === 'string') return message;
  }
  return null;
}
