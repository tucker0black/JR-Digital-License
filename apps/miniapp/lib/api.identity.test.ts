import { afterEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body
  } as Response;
}

describe('Mini App Telegram identity selection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uses live Telegram initData and never calls development auth inside Telegram', async () => {
    vi.stubEnv('NEXT_PUBLIC_DEV_AUTH_ENABLED', 'true');
    vi.stubGlobal('window', {
      location: { hostname: 'localhost' },
      Telegram: { WebApp: { initData: 'signed-real-telegram-init-data' } }
    });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ user: {}, wallet: {} }));
    vi.stubGlobal('fetch', fetchMock);

    const { getMe } = await import('./api.js');
    await getMe();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/me',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-telegram-init-data': 'signed-real-telegram-init-data'
        })
      })
    );
    expect(fetchMock).not.toHaveBeenCalledWith('/api/dev/auth', expect.anything());
  });

  it('allows development auth only when no Telegram context exists', async () => {
    vi.stubEnv('NEXT_PUBLIC_DEV_AUTH_ENABLED', 'true');
    vi.stubGlobal('window', { location: { hostname: 'localhost' } });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ initData: 'signed-dev-init-data' }))
      .mockResolvedValueOnce(jsonResponse({ user: {}, wallet: {} }));
    vi.stubGlobal('fetch', fetchMock);

    const { getMe } = await import('./api.js');
    await getMe();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/dev/auth',
      expect.objectContaining({ method: 'POST' })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/me',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-telegram-init-data': 'signed-dev-init-data' })
      })
    );
  });
});
