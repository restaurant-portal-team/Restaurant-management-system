import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderRoute } from '../test/render-route';

function mockFetchJson(status: number, body: unknown) {
  const fetchMock = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('HomePage', () => {
  it('renders the heading and reports an operational backend', async () => {
    const fetchMock = mockFetchJson(200, {
      status: 'ok',
      database: 'up',
      timestamp: new Date().toISOString(),
    });

    renderRoute('/');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Restaurant Management Portal' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Operational')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/health',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('shows an unavailable state when the API returns 503', async () => {
    mockFetchJson(503, { statusCode: 503, message: 'Service unavailable' });

    renderRoute('/');

    expect(await screen.findByText('Unavailable')).toBeInTheDocument();
    expect(screen.getByText('Unreachable')).toBeInTheDocument();
  });

  it('shows an unavailable state when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));

    renderRoute('/');

    expect(await screen.findByText('Unavailable')).toBeInTheDocument();
  });
});
