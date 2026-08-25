import type {
  CustomerFlashDealsResponse,
  FavoriteCheckResponse,
  FavoritesResponse
} from '@jr/shared';
import type { CustomerFlashDeal } from '@jr/shared';
export type { CustomerFlashDeal } from '@jr/shared';
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
  isHandDelivery: boolean;
  createdAt: string;
  updatedAt: string;
  category?: Category;
  availableStock?: number;
  isOutOfStock?: boolean;
  services?: SmmServiceOption[];
}

export interface SmmServiceOption {
  id: string;
  name: string;
  minimumQuantity: number;
  maximumQuantity: number;
}

export interface TopUpPackage {
  id: string;
  game: string;
  name: string;
  diamondAmount: number;
  content: string | null;
  price: string;
  currency: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  requiresPlayerId?: boolean;
  gameImageUrl?: string | null;
  icon?: string | null;
  imageUrl?: string | null;
  customerNote?: string | null;
  noteColor?: 'WARNING' | 'INFO' | 'SUCCESS' | 'DANGER' | 'PURPLE';
}

export interface TopUpCustomField {
  key: string;
  label: string;
  required: boolean;
  placeholder?: string;
}

export interface TopUpGameConfig {
  requirePlayerId: boolean;
  requireServerId: boolean;
  playerIdValidation: 'NUMERIC' | 'TEXT';
  serverIdValidation: 'NUMERIC' | 'TEXT';
  verificationEnabled: boolean;
  customerNote: string | null;
  customFields: TopUpCustomField[];
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
  manualDelivery?: {
    title: string;
    content: string;
    deliveredAt: string;
  } | null;
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
    customerId: string;
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

export interface MeHomeResponse {
  user: {
    firstName: string;
    lastName: string | null;
    username: string | null;
    photoUrl: string | null;
    accountStatus: 'NEW' | 'EXISTING';
    totalItemsPurchased: number;
    totalOrders: number;
    totalDeposited: string;
  };
  wallet: {
    balance: string;
    currency: string;
  };
}

export async function getMeHome(): Promise<MeHomeResponse> {
  return fetchJson<MeHomeResponse>('/api/me/home');
}

export interface SupportAvailability {
  isOpen: boolean;
  openTime: string;
  closeTime: string;
  timezoneLabel: string;
  serverTime: string;
}

export async function getSupportAvailability(): Promise<SupportAvailability> {
  return fetchPublicJson<SupportAvailability>('/api/support/availability');
}

export async function getCategories(): Promise<CategoriesResponse> {
  return fetchPublicJson<CategoriesResponse>('/api/categories');
}

export interface CustomerBanner {
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  buttonText: string | null;
  buttonDestination: string | null;
  targetType: string;
  targetCategoryId: string | null;
  targetProductId: string | null;
  targetPage: string | null;
}

export async function getBanners(params?: {
  targetType?: string;
  categoryId?: string;
}): Promise<{ banners: CustomerBanner[] }> {
  const searchParams = new URLSearchParams();
  if (params?.targetType) searchParams.set('targetType', params.targetType);
  if (params?.categoryId) searchParams.set('categoryId', params.categoryId);
  const query = searchParams.toString();
  return fetchPublicJson(`/api/banners${query ? `?${query}` : ''}`);
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
  deliveryType?: string;
  inStock?: string;
  sort?: string;
}): Promise<ProductsResponse> {
  const searchParams = new URLSearchParams();
  if (params?.search) searchParams.set('search', params.search);
  if (params?.category) searchParams.set('category', params.category);
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
  if (params?.featured) searchParams.set('featured', 'true');
  if (params?.popular) searchParams.set('popular', 'true');
  if (params?.deliveryType) searchParams.set('deliveryType', params.deliveryType);
  if (params?.inStock) searchParams.set('inStock', params.inStock);
  if (params?.sort) searchParams.set('sort', params.sort);

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
  serviceId?: string;
  /** @deprecated Accepted by older API clients; new clients use serviceId. */
  providerServiceId?: string;
  idempotencyKey?: string;
  couponCode?: string;
}): Promise<{ order: Order }> {
  return fetchJson('/api/orders', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export interface TopUpGame {
  id: string;
  name: string;
  imageUrl: string | null;
}

export async function getTopUpGames(): Promise<{ games: TopUpGame[] }> {
  return fetchPublicJson<{ games: TopUpGame[] }>('/api/topup/games');
}

export async function getTopUpPackages(gameId?: string): Promise<{ packages: TopUpPackage[]; config: TopUpGameConfig | null }> {
  const query = gameId ? `?gameId=${encodeURIComponent(gameId)}` : '';
  return fetchPublicJson<{ packages: TopUpPackage[]; config: TopUpGameConfig | null }>(`/api/topup/packages${query}`);
}

export async function createTopUpOrder(data: {
  packageId: string;
  target?: string;
  serverId?: string;
  customFields?: Record<string, string>;
  idempotencyKey?: string;
}): Promise<{ order: Order }> {
  return fetchJson('/api/topup/orders', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

// ---------- Generic provider-driven account verification ----------

export interface TopUpVerificationField {
  key: string;
  label: string;
  type?: string;
}

/** Metadata returned by the backend for one package (provider-driven). */
export interface TopUpVerificationInfo {
  applicable: boolean;
  verificationAvailable: boolean;
  availabilityKnown: boolean;
  fields: TopUpVerificationField[];
  allowUnverifiedPurchase: boolean;
}

export interface VerifyPlayerResponse {
  /** true = verified; false = checked but invalid; null = not supported/unavailable. */
  valid: boolean | null;
  verified: boolean;
  playerName: string | null;
  verificationToken: string | null;
  expiresAt: string | null;
  verificationAvailable: boolean;
  allowUnverifiedPurchase: boolean;
  reason: 'PLAYER_NOT_FOUND' | 'VALIDATION_NOT_SUPPORTED' | 'VERIFICATION_UNAVAILABLE' | 'MISSING_FIELDS' | 'UNKNOWN_FIELD' | 'PACKAGE_NOT_FOUND' | null;
  error: string | null;
}

export async function getTopUpVerificationInfo(packageId: string): Promise<TopUpVerificationInfo> {
  return fetchJson<TopUpVerificationInfo>(`/api/topup/verification-info?packageId=${encodeURIComponent(packageId)}`, { method: 'GET' });
}

export async function verifyTopUpPlayer(data: {
  packageId: string;
  fields: Record<string, string>;
}): Promise<VerifyPlayerResponse> {
  return fetchJson<VerifyPlayerResponse>('/api/verify-player', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export interface VerifyAccountResponse {
  success: boolean;
  accountName?: string;
  verifiedAt?: string;
  target?: string;
  serverId?: string | null;
  error?: string;
}

export async function verifyTopUpAccount(data: {
  gameId: string;
  packageId?: string;
  target: string;
  serverId?: string;
}): Promise<VerifyAccountResponse> {
  return fetchJson('/api/topup/verify-account', {
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

export async function expirePayment(id: string): Promise<{
  success: boolean;
  status: string;
  paid?: boolean;
  cancelled?: boolean;
  alreadyTerminal?: boolean;
}> {
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

// ---------- Flash Deals ----------

export async function getFlashDeals(): Promise<CustomerFlashDealsResponse> {
  return fetchJson<CustomerFlashDealsResponse>('/api/flash-deals');
}

export async function getProductFlashDeal(slug: string): Promise<{ deal: CustomerFlashDeal | null }> {
  return fetchJson(`/api/products/${slug}/flash-deal`);
}

// ---------- Favorites ----------

export async function getFavorites(params?: {
  page?: number;
  pageSize?: number;
}): Promise<FavoritesResponse> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
  const query = searchParams.toString();
  return fetchJson<FavoritesResponse>(`/api/favorites${query ? `?${query}` : ''}`);
}

export async function addFavorite(productId: string): Promise<{ favorite: { id: string } }> {
  return fetchJson(`/api/favorites/${productId}`, {
    method: 'POST'
  });
}

export async function removeFavorite(productId: string): Promise<{ success: boolean }> {
  return fetchJson(`/api/favorites/${productId}`, {
    method: 'DELETE'
  });
}

export async function checkFavorite(productId: string): Promise<FavoriteCheckResponse> {
  return fetchJson(`/api/favorites/check/${productId}`);
}

// ---------- Coupons ----------

import type {
  ValidateCouponResponse,
  CustomerNotificationsResponse,
  UnreadCountResponse
} from '@jr/shared';

export async function validateCoupon(data: {
  code: string;
  productId: string;
  quantity?: number;
}): Promise<ValidateCouponResponse> {
  return fetchJson<ValidateCouponResponse>('/api/coupons/validate', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

// ---------- Customer Notifications ----------

export async function getUnreadNotificationCount(): Promise<UnreadCountResponse> {
  return fetchJson<UnreadCountResponse>('/api/notifications/unread-count');
}

export async function getCustomerNotifications(params?: {
  page?: number;
  pageSize?: number;
  unreadOnly?: boolean;
}): Promise<CustomerNotificationsResponse> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
  if (params?.unreadOnly) searchParams.set('unreadOnly', 'true');
  const query = searchParams.toString();
  return fetchJson<CustomerNotificationsResponse>(`/api/customer-notifications${query ? `?${query}` : ''}`);
}

export async function markNotificationRead(id: string): Promise<{ success: boolean }> {
  return fetchJson(`/api/customer-notifications/${id}/read`, {
    method: 'POST'
  });
}

export async function markAllNotificationsRead(): Promise<{ success: boolean }> {
  return fetchJson('/api/customer-notifications/read-all', {
    method: 'POST'
  });
}
