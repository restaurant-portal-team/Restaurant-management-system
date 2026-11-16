import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../lib/api-client';

/** Contract of GET /api/v1/health (see docs/api-endpoints.txt). */
export interface HealthResponse {
  status: 'ok' | 'error';
  database: 'up' | 'down';
  timestamp: string;
}

export const healthQueryKey = ['system', 'health'] as const;

export function useHealth() {
  return useQuery({
    queryKey: healthQueryKey,
    queryFn: ({ signal }) => apiGet<HealthResponse>('/health', { signal }),
    refetchInterval: 30_000,
  });
}
