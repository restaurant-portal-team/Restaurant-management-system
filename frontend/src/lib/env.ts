/**
 * Frontend runtime configuration.
 *
 * SECURITY: everything prefixed with VITE_ is bundled into public JavaScript.
 * Never put secrets, credentials or database URLs in frontend environment variables.
 */

const DEFAULT_API_BASE_URL = 'http://localhost:3000/api/v1';

export function resolveApiBaseUrl(raw: string | undefined): string {
  const value = raw?.trim() ? raw.trim() : DEFAULT_API_BASE_URL;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('VITE_API_BASE_URL must be an absolute http(s) URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('VITE_API_BASE_URL must use http or https.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('VITE_API_BASE_URL must not contain credentials.');
  }

  return parsed.toString().replace(/\/+$/, '');
}

export const env = {
  apiBaseUrl: resolveApiBaseUrl(import.meta.env.VITE_API_BASE_URL),
} as const;
