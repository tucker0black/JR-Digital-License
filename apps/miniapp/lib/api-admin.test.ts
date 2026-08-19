import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_TOKEN_COOKIE,
  AdminApiError,
  adminLogin,
  clearAdminToken,
  getAdminStock,
  getAdminToken,
  isAdminApiError,
  setAdminToken
} from './api-admin';
import { getProducts } from './api';

function makeStorage(): {
  items: Map<string, string>;
  storage: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; removeItem: (k: string) => void };
} {
  const items = new Map<string, string>();
  return {
    items,
    storage: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
      removeItem: (key: string) => void items.delete(key)
    }
  };
}

describe('api-admin token storage', () => {
  it('returns null when no token is stored', () => {
    expect(getAdminToken(makeStorage().storage)).toBeNull();
  });

  it('stores and retrieves the admin token', () => {
    const { storage } = makeStorage();
    setAdminToken('secret-token-123', storage);
    expect(getAdminToken(storage)).toBe('secret-token-123');
    expect(storage.getItem(ADMIN_TOKEN_COOKIE)).toBe('secret-token-123');
  });

  it('clears the admin token', () => {
    const { storage } = makeStorage();
    setAdminToken('secret-token-123', storage);
    clearAdminToken(storage);
    expect(getAdminToken(storage)).toBeNull();
  });
});

describe('api-admin authentication flow', () => {
  const mockFetch = vi.fn();

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    clearAdminToken();
  });

  it('fails without a stored token and does not call the API', async () => {
    vi.stubGlobal('fetch', mockFetch);
    const { storage } = makeStorage();

    await expect(getAdminStock({}, storage)).rejects.toMatchObject({
      status: 401,
      message: 'Not authenticated'
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('stores the token only after a successful login probe', async () => {
    vi.stubGlobal('fetch', mockFetch);
    const stats = { orders: { total: 0 } };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => stats
    });

    const { storage } = makeStorage();
    const result = await adminLogin('valid-admin-token', storage);

    expect(result).toEqual(stats);
    expect(getAdminToken(storage)).toBe('valid-admin-token');
  });

  it('throws AdminApiError with the server error message on rejection', async () => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Invalid admin token' })
    });

    try {
      await adminLogin('wrong-token', makeStorage().storage);
      expect.unreachable('expected an error');
    } catch (error) {
      expect(error).toBeInstanceOf(AdminApiError);
      expect(isAdminApiError(error)).toBe(true);
      expect((error as AdminApiError).status).toBe(403);
      expect((error as AdminApiError).message).toBe('Invalid admin token');
    }
  });

  it('shows the useful backend message instead of a generic FastifyError name', async () => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        statusCode: 400,
        error: 'FastifyError',
        message: 'Body cannot be empty when content-type is set to application/json'
      })
    });

    try {
      await adminLogin('wrong-token', makeStorage().storage);
      expect.unreachable('expected an error');
    } catch (error) {
      expect(error).toBeInstanceOf(AdminApiError);
      expect((error as AdminApiError).message).toBe(
        'Body cannot be empty when content-type is set to application/json'
      );
    }
  });

  it('never stores the token when the login probe fails', async () => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Invalid admin token' })
    });

    const { storage } = makeStorage();
    await expect(adminLogin('wrong-token', storage)).rejects.toBeInstanceOf(AdminApiError);
    expect(getAdminToken(storage)).toBeNull();
  });
});

describe('api-admin request security', () => {
  const mockFetch = vi.fn();

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    clearAdminToken();
  });

  it('sends the admin token only in the Authorization header of admin API calls', async () => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ stock: [], total: 0, page: 1, pageSize: 50 }) });
    const { storage } = makeStorage();
    setAdminToken('admin-token-abc', storage);

    await getAdminStock({}, storage);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toContain('/api/admin/stock');
    expect(init.headers.Authorization).toBe('Bearer admin-token-abc');
  });

  it('does not attach the admin token to non-admin customer calls', async () => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ products: [], total: 0, page: 1, pageSize: 20 }) });
    const { storage } = makeStorage();
    setAdminToken('admin-token-abc', storage);

    await getProducts();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(JSON.stringify(init)).not.toContain('admin-token-abc');
  });

  it('never includes the token in query strings or request bodies', async () => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ stock: [], total: 0, page: 1, pageSize: 50 }) });
    const { storage } = makeStorage();
    setAdminToken('super-secret-admin-token', storage);

    await getAdminStock({}, storage);

    const [url, init] = mockFetch.mock.calls[0] as [string, { body?: string }];
    expect(url).not.toContain('super-secret-admin-token');
    expect(init.body ?? '').not.toContain('super-secret-admin-token');
  });
});