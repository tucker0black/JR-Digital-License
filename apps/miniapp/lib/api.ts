import { resolveBrowserApiBase } from './browser-api-base';

const isBrowser = typeof window !== 'undefined';

// Browser/Telegram clients call the Mini App's own origin (same-origin /api/*),
// which Next.js proxies to the backend server-side. The customer's device must
// never try to reach http://localhost:4000 directly. NEXT_PUBLIC_API_URL can
// still override this for custom deployments.
const API_BASE = isBrowser
  ? resolveBrowserApiBase(process.env.NEXT_PUBLIC_API_URL)
  : process.env.API_URL?.trim() || process.env.APP_API_URL?.trim() || 'http://127.0.0.1:4000';

interface TelegramWebApp {
  initData?: string;
}

interface WindowWithTelegram extends Window {
  Telegram?: {
    WebApp?: TelegramWebApp;
  };
}

export const TELEGRAM_INIT_DATA_COOKIE = 'jr_telegram_init_data';

const DEV_AUTH_ENABLED =
  typeof window !== 'undefined' &&
  process.env.NEXT_PUBLIC_DEV_AUTH_ENABLED === 'true' &&
  ['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname);

let devInitDataPromise: Promise<string | null> | null = null;
const PUBLIC_CACHE_TTL_MS = 15_000;
const publicCache = new Map<string, { expiresAt: number; value: unknown }>();
const publicRequests = new Map<string, Promise<unknown>>();

function readCookie(name: string): string | null {
  try {
    const match = document.cookie.match(
      new RegExp(`(?:^|;\\s*)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=([^;]*)`)
    );
    const value = match?.[1];
    return value !== undefined ? decodeURIComponent(value) : null;
  } catch {
    return null;
  }
}

export function clearLegacyTelegramInitDataCookie(): void {
  if (typeof document === 'undefined' || readCookie(TELEGRAM_INIT_DATA_COOKIE) === null) return;
  try {
    document.cookie = `${TELEGRAM_INIT_DATA_COOKIE}=; path=/; max-age=0; samesite=lax`;
  } catch {
    // ignore cookie errors
  }
}

async function getDevInitData(): Promise<string | null> {
  if (!devInitDataPromise) {
    devInitDataPromise = (async () => {
      try {
        const response = await fetch(`${API_BASE}/api/dev/auth`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}'
        });
        if (!response.ok) return null;
        const data = (await response.json()) as { initData?: string };
        return data.initData ?? null;
      } catch {
        return null;
      }
    })();
  }
  return devInitDataPromise;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public body?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  let initData: string | null = null;

  if (typeof window !== 'undefined') {
    const telegram = (window as WindowWithTelegram).Telegram;
    const telegramWebApp = telegram?.WebApp;

    // Real Telegram initData always takes priority.
    if (telegramWebApp?.initData) {
      initData = telegramWebApp.initData;
    }

    // Dev authentication is ONLY used in a plain browser outside Telegram.
    // Inside Telegram the verified initData (or its absence) must never be
    // replaced with the shared Dev User identity. A persisted Telegram
    // credential is intentionally never used as a browser fallback.
    if (!initData && !telegram && DEV_AUTH_ENABLED) {
      initData = await getDevInitData();
    }
  }

  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) };
  if (init?.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (initData) {
    headers['x-telegram-init-data'] = initData;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    headers,
    ...init
  }).catch((networkError: unknown) => {
    if (process.env.NODE_ENV !== 'production') {
      console.error(
        `[api] ${init?.method ?? 'GET'} ${path} — network error: ${(networkError as Error).message}`
      );
    }
    throw networkError;
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    const message = error.error || `HTTP ${response.status}`;
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[api] ${init?.method ?? 'GET'} ${path} -> ${response.status}: ${message}`);
    }
    if (/Missing Telegram init data/i.test(message)) {
      throw new ApiError('Please open JR Digital license inside the Telegram app to continue.', response.status, error);
    }
    throw new ApiError(message, response.status, error);
  }

  return response.json();
}

function fetchPublicJson<T>(path: string): Promise<T> {
  const cached = publicCache.get(path);
  if (cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.value as T);
  }

  const pending = publicRequests.get(path);
  if (pending) return pending as Promise<T>;

  const request = fetchJson<T>(path)
    .then((value) => {
      publicCache.set(path, { expiresAt: Date.now() + PUBLIC_CACHE_TTL_MS, value });
      return value;
    })
    .finally(() => {
      publicRequests.delete(path);
    });

  publicRequests.set(path, request);
  return request;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  imageUrl: string | null;
  isActive: boolean;
  isArchived: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  categoryId: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  type: string;
  deliveryType: string;
  price: string;
  currency: string;
  minimumQuantity: number;
  maximumQuantity: number | null;
  hideWhenOutOfStock: boolean;
  status: string;
  isActive: boolean;
  isFeatured: boolean;
  isPopular: boolean;
  sortOrder: number;
  instructions: string | null;
  keywords: string[];
  createdAt: string;
  updatedAt: string;
  category?: Category;
  availableStock?: number;
  isOutOfStock?: boolean;
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string | null;
  variantId: string | null;
  productNameSnapshot: string;
  unitPriceSnapshot: string;
  quantitySnapshot: number;
  totalSnapshot: string;
  currencySnapshot: string;
  deliveryTypeSnapshot: string;
  providerServiceIdSnapshot: string | null;
  target: string | null;
  createdAt: string;
  fulfillment?: {
    id: string;
    status: string;
    deliveryRef: string | null;
    deliveredAt: string | null;
    failureReason: string | null;
  } | null;
  deliveryValue?: string | null;
  deliveryValues?: string[];
}

export interface Order {
  id: string;
  orderNumber: number;
  userId: string;
  status: string;
  currency: string;
  subtotal: string;
  discount: string;
  total: string;
  idempotencyKey: string | null;
  expiresAt: string | null;
  paidAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: OrderItem[];
}

export interface Payment {
  id: string;
  reference: string;
  provider: string;
  status: string;
  amount: string;
  currency: string;
  expiresAt: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface CreatePaymentResponse {
  payment: {
    id: string;
    reference: string;
    providerPaymentId?: string;
    expiresAt?: string;
    paymentUrl?: string;
    qrCodeData?: string;
    qrCodeImage?: string;
    merchantName?: string;
    amount?: string;
    currency?: string;
  };
  resumed?: boolean;
}

export interface PaymentStatusResponse {
  payment: Payment;
  isExpired: boolean;
  verificationError?: string;
}

export interface ProductsResponse {
  products: Product[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CategoriesResponse {
  categories: Category[];
}

export interface OrdersResponse {
  orders: Order[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MeResponse {
  user: {
    id: string;
    telegramId: string;
    username: string | null;
    firstName: string;
    lastName: string | null;
    displayName: string;
    photoUrl: string | null;
    languageCode: string | null;
    status: string;
    accountStatus: 'NEW' | 'EXISTING';
    createdAt: string;
    lastSeenAt: string | null;
    totalItemsPurchased: number;
    totalOrders: number;
    totalDeposited: string;
  };
  wallet: {
    balance: string;
    currency: string;
  };
}

export async function getMe(): Promise<MeResponse> {
  return fetchJson<MeResponse>('/api/me');
}

export async function getCategories(): Promise<CategoriesResponse> {
  return fetchPublicJson<CategoriesResponse>('/api/categories');
}

export async function getCategory(slug: string): Promise<{ category: Category & { products: Product[] } }> {
  return fetchPublicJson(`/api/categories/${slug}`);
}

export async function getProducts(params?: {
  search?: string;
  category?: string;
  page?: number;
  pageSize?: number;
  featured?: boolean;
  popular?: boolean;
}): Promise<ProductsResponse> {
  const searchParams = new URLSearchParams();
  if (params?.search) searchParams.set('search', params.search);
  if (params?.category) searchParams.set('category', params.category);
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
  if (params?.featured) searchParams.set('featured', 'true');
  if (params?.popular) searchParams.set('popular', 'true');

  const query = searchParams.toString();
  return fetchPublicJson<ProductsResponse>(`/api/products${query ? `?${query}` : ''}`);
}

export async function getProduct(slug: string): Promise<{ product: Product }> {
  return fetchJson(`/api/products/${slug}`);
}

export async function createOrder(data: {
  productId: string;
  quantity: number;
  target?: string;
  idempotencyKey?: string;
}): Promise<{ order: Order }> {
  return fetchJson('/api/orders', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function getOrders(params?: {
  page?: number;
  pageSize?: number;
}): Promise<OrdersResponse> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
  
  const query = searchParams.toString();
  return fetchJson<OrdersResponse>(`/api/orders${query ? `?${query}` : ''}`);
}

export async function getOrder(id: string): Promise<{ order: Order }> {
  return fetchJson(`/api/orders/${id}`);
}

export async function createPayment(data: {
  orderId: string;
  provider: string;
  idempotencyKey?: string;
}): Promise<CreatePaymentResponse> {
  return fetchJson('/api/payments', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function getPaymentStatus(id: string): Promise<PaymentStatusResponse> {
  return fetchJson(`/api/payments/${id}`);
}

export async function expirePayment(id: string): Promise<{ success: boolean }> {
  return fetchJson(`/api/payments/${id}/expire`, {
    method: 'POST'
  });
}

export interface WalletTransaction {
  id: string;
  type: string;
  status: string;
  amount: string;
  currency: string;
  balanceBefore: string;
  balanceAfter: string;
  reference: string;
  reason: string | null;
  createdAt: string;
}

export interface WalletResponse {
  wallet: {
    balance: string;
    currency: string;
  };
  transactions: WalletTransaction[];
}

export async function getWallet(): Promise<WalletResponse> {
  return fetchJson<WalletResponse>('/api/wallet');
}

export async function createDeposit(data: {
  amount: string | number;
  currency?: string;
  idempotencyKey?: string;
}): Promise<CreatePaymentResponse> {
  return fetchJson('/api/wallet/deposits', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function payOrderWithWallet(orderId: string, idempotencyKey?: string): Promise<{
  order: { id: string; orderNumber: number; status: string };
  payment: { id: string; reference: string; provider: string; status: string };
}> {
  return fetchJson(`/api/orders/${orderId}/pay-with-wallet`, {
    method: 'POST',
    body: JSON.stringify({ idempotencyKey })
  });
}

export interface SupportTicket {
  id: string;
  number: number;
  subject: string;
  status: string;
  orderId: string | null;
  order: { id: string; orderNumber: number } | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SupportTicketDetail extends SupportTicket {
  messages: Array<{
    id: string;
    body: string;
    createdAt: string;
    sender: 'USER' | 'ADMIN' | 'SYSTEM';
    fromAdmin: boolean;
    adminName: string | null;
  }>;
}

export async function getTickets(): Promise<{ tickets: SupportTicket[]; total: number; page: number; pageSize: number }> {
  return fetchJson('/api/tickets');
}

export async function getSupportUnreadCount(): Promise<{ unreadCount: number }> {
  return fetchJson('/api/tickets/unread-count');
}

export async function createTicket(data: {
  subject: string;
  body: string;
  orderId?: string;
}): Promise<{ ticket: SupportTicket }> {
  return fetchJson('/api/tickets', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function getTicket(id: string): Promise<{ ticket: SupportTicketDetail }> {
  return fetchJson(`/api/tickets/${id}`);
}

export async function replyToTicket(id: string, body: string): Promise<{ message: { id: string; status: string } }> {
  return fetchJson(`/api/tickets/${id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body })
  });
}
