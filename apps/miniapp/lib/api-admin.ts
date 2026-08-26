import type {
  AdminPayment,
  AdminSmmProvider,
  AdminSmmService,
  Analytics,
  AuditLogEntry,
  CategoryDetail,
  CreateCategoryRequest,
  CreateFlashDealRequest,
  CreateNotificationTargetRequest,
  CreateProductRequest,
  CreateSmmProviderRequest,
  CreateSmmServiceRequest,
  DashboardStats,
  FavoriteDetail,
  NotificationTarget,
  OrderDetail,
  ProductDetail,
  StockSummary,
  SupportTicketStatus,
  Ticket,
  TicketDetail,
  UpdateCategoryRequest,
  UpdateFlashDealRequest,
  UpdateNotificationTargetRequest,
  UpdateProductRequest,
  UpdateSmmProviderRequest,
  UpdateSmmServiceRequest,
  User,
  UserDetail,
  Wallet,
  WalletDetail
} from '@jr/shared';
import { resolveBrowserApiBase } from './browser-api-base';

const isBrowser = typeof window !== 'undefined';

// Browser/Telegram clients call the Mini App's own origin (same-origin /api/*),
// which Next.js proxies to the backend server-side. The customer's device must
// never try to reach http://localhost:4000 directly. NEXT_PUBLIC_API_URL can
// still override this for custom deployments.
const API_BASE = isBrowser
  ? resolveBrowserApiBase(process.env.NEXT_PUBLIC_API_URL)
  : process.env.API_URL?.trim() || process.env.APP_API_URL?.trim() || 'http://127.0.0.1:4000';

export const ADMIN_TOKEN_COOKIE = 'jr_admin_token';

export interface AdminTokenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let memoryToken: string | null = null;

function parseCookies(): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (typeof document === 'undefined') return cookies;
  for (const part of document.cookie.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

export const browserTokenStorage: AdminTokenStorage = {
  getItem(key) {
    return parseCookies()[key] ?? memoryToken;
  },
  setItem(key, value) {
    memoryToken = value;
    if (typeof document !== 'undefined') {
      const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = `${key}=${encodeURIComponent(value)}; path=/; SameSite=Lax${secure}`;
    }
  },
  removeItem(key) {
    memoryToken = null;
    if (typeof document !== 'undefined') {
      document.cookie = `${key}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
    }
  }
};

export function getAdminToken(storage: AdminTokenStorage = browserTokenStorage): string | null {
  return storage.getItem(ADMIN_TOKEN_COOKIE);
}

export function setAdminToken(token: string, storage: AdminTokenStorage = browserTokenStorage): void {
  storage.setItem(ADMIN_TOKEN_COOKIE, token);
}

export function clearAdminToken(storage: AdminTokenStorage = browserTokenStorage): void {
  storage.removeItem(ADMIN_TOKEN_COOKIE);
}

export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

export function isAdminApiError(error: unknown): error is AdminApiError {
  return error instanceof AdminApiError;
}

async function adminFetch<T>(
  path: string,
  init?: RequestInit,
  tokenOverride?: string,
  storage: AdminTokenStorage = browserTokenStorage,
  timeoutMs?: number
): Promise<T> {
  const token = tokenOverride ?? storage.getItem(ADMIN_TOKEN_COOKIE);
  if (!token) {
    throw new AdminApiError('Not authenticated', 401);
  }

  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined)
  };
  if (init?.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  headers['Authorization'] = `Bearer ${token}`;

  // Guard rails so a hung backend can never freeze admin UI forever.
  const signal =
    timeoutMs && typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(timeoutMs)
      : init?.signal ?? undefined;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers, signal });
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new AdminApiError('The server did not respond in time. Please try again.', 504);
    }
    throw error;
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    const message = body.message || body.error || `HTTP ${response.status}`;
    throw new AdminApiError(message, response.status);
  }

  return response.json() as Promise<T>;
}

function buildQuery<T extends object>(params: T): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      searchParams.set(key, String(value));
    }
  }
  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

// ---------- Auth ----------

export async function adminLogin(token: string, storage?: AdminTokenStorage): Promise<DashboardStats> {
  const stats = await adminFetch<DashboardStats>('/api/admin/dashboard', {}, token, storage, 15_000);
  setAdminToken(token, storage);
  return stats;
}

export function adminLogout(): void {
  clearAdminToken();
}

// ---------- Auth check ----------

export function checkAdminAuth(): Promise<{ ok: boolean }> {
  return adminFetch<{ ok: boolean }>('/api/admin/auth/check', {}, undefined, undefined, 10_000);
}

// ---------- Dashboard ----------

export function getDashboardStats(): Promise<DashboardStats> {
  return adminFetch<DashboardStats>('/api/admin/dashboard');
}

export interface DashboardActivity {
  orders: {
    id: string;
    type: 'order';
    orderNumber: number;
    status: string;
    amount: string;
    currency: string;
    user: { firstName: string; lastName: string | null; username: string | null };
    createdAt: string;
  }[];
  payments: {
    id: string;
    type: 'payment';
    reference: string;
    status: string;
    amount: string;
    currency: string;
    provider: string;
    orderNumber: number | null;
    createdAt: string;
  }[];
  products: {
    id: string;
    type: 'product';
    name: string;
    status: string;
    price: string;
    currency: string;
    createdAt: string;
  }[];
}

export function getDashboardActivity(limit = 20): Promise<DashboardActivity> {
  return adminFetch<DashboardActivity>(`/api/admin/dashboard/activity${buildQuery({ limit })}`);
}

// ---------- Products ----------

export interface AdminProductsResponse {
  products: ProductDetail[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminProductFilters {
  search?: string;
  categoryId?: string;
  status?: string;
  isActive?: string;
  isFeatured?: string;
  isPopular?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export function getAdminProducts(filters: AdminProductFilters = {}): Promise<AdminProductsResponse> {
  return adminFetch<AdminProductsResponse>(`/api/admin/products${buildQuery(filters)}`);
}

export function getAdminProduct(id: string): Promise<{ product: ProductDetail }> {
  return adminFetch<{ product: ProductDetail }>(`/api/admin/products/${id}`);
}

export function createAdminProduct(data: CreateProductRequest): Promise<{ product: ProductDetail }> {
  return adminFetch<{ product: ProductDetail }>('/api/admin/products', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export function updateAdminProduct(id: string, data: UpdateProductRequest): Promise<{ product: ProductDetail }> {
  return adminFetch<{ product: ProductDetail }>(`/api/admin/products/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}

export function deleteAdminProduct(id: string): Promise<{ success: boolean }> {
  return adminFetch<{ success: boolean }>(`/api/admin/products/${id}`, { method: 'DELETE' });
}

export function activateAdminProduct(id: string): Promise<{ product: ProductDetail }> {
  return adminFetch<{ product: ProductDetail }>(`/api/admin/products/${id}/activate`, { method: 'POST' });
}

export function deactivateAdminProduct(id: string): Promise<{ product: ProductDetail }> {
  return adminFetch<{ product: ProductDetail }>(`/api/admin/products/${id}/deactivate`, { method: 'POST' });
}

export function addAdminProductStock(id: string, deliveryType: string, values: string[]): Promise<{ success: boolean; count: number }> {
  return adminFetch<{ success: boolean; count: number }>(`/api/admin/products/${id}/stock`, {
    method: 'POST',
    body: JSON.stringify({ deliveryType, values })
  });
}

// ---------- Categories ----------

export interface AdminCategoriesResponse {
  categories: CategoryDetail[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminCategoryFilters {
  search?: string;
  isActive?: string;
  isArchived?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export function getAdminCategories(filters: AdminCategoryFilters = {}): Promise<AdminCategoriesResponse> {
  return adminFetch<AdminCategoriesResponse>(`/api/admin/categories${buildQuery(filters)}`);
}

export function getAdminCategory(id: string): Promise<{ category: CategoryDetail }> {
  return adminFetch<{ category: CategoryDetail }>(`/api/admin/categories/${id}`);
}

export function createAdminCategory(data: CreateCategoryRequest): Promise<{ category: CategoryDetail }> {
  return adminFetch<{ category: CategoryDetail }>('/api/admin/categories', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export function updateAdminCategory(id: string, data: UpdateCategoryRequest): Promise<{ category: CategoryDetail }> {
  return adminFetch<{ category: CategoryDetail }>(`/api/admin/categories/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}

export function deleteAdminCategory(id: string): Promise<{ success: boolean }> {
  return adminFetch<{ success: boolean }>(`/api/admin/categories/${id}`, { method: 'DELETE' });
}

export function activateAdminCategory(id: string): Promise<{ category: CategoryDetail }> {
  return adminFetch<{ category: CategoryDetail }>(`/api/admin/categories/${id}/activate`, { method: 'POST' });
}

export function deactivateAdminCategory(id: string): Promise<{ category: CategoryDetail }> {
  return adminFetch<{ category: CategoryDetail }>(`/api/admin/categories/${id}/deactivate`, { method: 'POST' });
}

export function archiveAdminCategory(id: string): Promise<{ category: CategoryDetail }> {
  return adminFetch<{ category: CategoryDetail }>(`/api/admin/categories/${id}/archive`, { method: 'POST' });
}

export function reorderAdminCategories(orders: { id: string; sortOrder: number }[]): Promise<{ success: boolean }> {
  return adminFetch<{ success: boolean }>('/api/admin/categories/reorder', {
    method: 'POST',
    body: JSON.stringify(orders)
  });
}

// ---------- Owned media uploads (permanent image storage) ----------

export interface AdminMediaAsset {
  id: string;
  filename: string;
  /** Stable, origin-agnostic URL — safe to store on any record. */
  url: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Upload an image to PERMANENT application-owned storage. The returned URL
 * is stored verbatim in the record's imageUrl; the asset never expires and is
 * never removed automatically.
 */
export function uploadAdminMedia(dataBase64: string): Promise<{ asset: AdminMediaAsset }> {
  return adminFetch<{ asset: AdminMediaAsset }>('/api/admin/media', {
    method: 'POST',
    body: JSON.stringify({ dataBase64 })
  });
}

// ---------- Banners ----------

export interface AdminBanner {
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
  isActive: boolean;
  sortOrder: number;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
  targetCategory: { id: string; name: string; slug: string } | null;
  targetProduct: { id: string; name: string; slug: string } | null;
}

export interface AdminBannersResponse {
  banners: AdminBanner[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminBannerFilters {
  search?: string;
  isActive?: string;
  targetType?: string;
  page?: number;
  pageSize?: number;
}

export function getAdminBanners(filters: AdminBannerFilters = {}): Promise<AdminBannersResponse> {
  return adminFetch<AdminBannersResponse>(`/api/admin/banners${buildQuery(filters)}`);
}

export function getAdminBanner(id: string): Promise<{ banner: AdminBanner }> {
  return adminFetch<{ banner: AdminBanner }>(`/api/admin/banners/${id}`);
}

export function createAdminBanner(data: {
  title: string;
  subtitle?: string;
  imageUrl?: string;
  buttonText?: string;
  buttonDestination?: string;
  targetType?: string;
  targetCategoryId?: string;
  targetProductId?: string;
  targetPage?: string;
  isActive?: boolean;
  sortOrder?: number;
  startsAt?: string;
  endsAt?: string;
}): Promise<{ banner: AdminBanner }> {
  return adminFetch<{ banner: AdminBanner }>('/api/admin/banners', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export function updateAdminBanner(id: string, data: Record<string, unknown>): Promise<{ banner: AdminBanner }> {
  return adminFetch<{ banner: AdminBanner }>(`/api/admin/banners/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}

export function deleteAdminBanner(id: string): Promise<{ success: boolean }> {
  return adminFetch<{ success: boolean }>(`/api/admin/banners/${id}`, { method: 'DELETE' });
}

export function activateAdminBanner(id: string): Promise<{ banner: AdminBanner }> {
  return adminFetch<{ banner: AdminBanner }>(`/api/admin/banners/${id}/activate`, { method: 'POST' });
}

export function deactivateAdminBanner(id: string): Promise<{ banner: AdminBanner }> {
  return adminFetch<{ banner: AdminBanner }>(`/api/admin/banners/${id}/deactivate`, { method: 'POST' });
}

export function reorderAdminBanners(orders: { id: string; sortOrder: number }[]): Promise<{ success: boolean }> {
  return adminFetch<{ success: boolean }>('/api/admin/banners/reorder', {
    method: 'POST',
    body: JSON.stringify(orders)
  });
}

// ---------- Flash Deals ----------

export interface AdminFlashDeal {
  id: string;
  productId: string;
  discountType: string;
  discountValue: string;
  salePrice: string;
  isActive: boolean;
  sortOrder: number;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
  product: {
    id: string;
    name: string;
    slug: string;
    price: string;
    currency: string;
    imageUrl: string | null;
    deliveryType: string;
    status: string;
    category: { id: string; name: string; slug: string } | null;
  };
}

export interface AdminFlashDealsResponse {
  deals: AdminFlashDeal[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminFlashDealFilters {
  search?: string;
  isActive?: string;
  page?: number;
  pageSize?: number;
}

export function getAdminFlashDeals(filters: AdminFlashDealFilters = {}): Promise<AdminFlashDealsResponse> {
  return adminFetch<AdminFlashDealsResponse>(`/api/admin/flash-deals${buildQuery(filters)}`);
}

export function getAdminFlashDeal(id: string): Promise<{ deal: AdminFlashDeal }> {
  return adminFetch<{ deal: AdminFlashDeal }>(`/api/admin/flash-deals/${id}`);
}

export function createAdminFlashDeal(data: CreateFlashDealRequest): Promise<{ deal: AdminFlashDeal }> {
  return adminFetch<{ deal: AdminFlashDeal }>('/api/admin/flash-deals', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export function updateAdminFlashDeal(id: string, data: UpdateFlashDealRequest): Promise<{ deal: AdminFlashDeal }> {
  return adminFetch<{ deal: AdminFlashDeal }>(`/api/admin/flash-deals/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}

export function deleteAdminFlashDeal(id: string): Promise<{ success: boolean }> {
  return adminFetch<{ success: boolean }>(`/api/admin/flash-deals/${id}`, { method: 'DELETE' });
}

export function activateAdminFlashDeal(id: string): Promise<{ deal: AdminFlashDeal }> {
  return adminFetch<{ deal: AdminFlashDeal }>(`/api/admin/flash-deals/${id}/activate`, { method: 'POST' });
}

export function deactivateAdminFlashDeal(id: string): Promise<{ deal: AdminFlashDeal }> {
  return adminFetch<{ deal: AdminFlashDeal }>(`/api/admin/flash-deals/${id}/deactivate`, { method: 'POST' });
}

// ---------- Favorites ----------

export function getAdminFavorites(params: { userId?: string; page?: number; pageSize?: number } = {}): Promise<{ favorites: FavoriteDetail[]; total: number; page: number; pageSize: number }> {
  return adminFetch(`/api/favorites${buildQuery(params)}`);
}

// ---------- Top-Up Packages ----------

export interface AdminTopUpProvider {
  id: string;
  name: string;
  apiUrl: string;
  status: 'ACTIVE' | 'DISABLED';
  packageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminTopUpPackage {
  id: string;
  gameId: string;
  game: string;
  name: string;
  diamondAmount: number;
  content: string | null;
  price: string;
  currency: string;
  providerId: string | null;
  providerServiceId: string | null;
  providerOfferId?: string | null;
  providerCost: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  provider: { id: string; name: string; status: string } | null;
  icon?: string | null;
  imageUrl?: string | null;
  customerNote?: string | null;
  noteColor?: 'WARNING' | 'INFO' | 'SUCCESS' | 'DANGER' | 'PURPLE';
}

export interface AdminTopUpPackagesResponse {
  packages: AdminTopUpPackage[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminTopUpPackageFilters {
  search?: string;
  game?: string;
  isActive?: string;
  page?: number;
  pageSize?: number;
}

export function getAdminTopUpPackages(filters: AdminTopUpPackageFilters = {}): Promise<AdminTopUpPackagesResponse> {
  return adminFetch<AdminTopUpPackagesResponse>(`/api/admin/topup/packages${buildQuery(filters)}`);
}

export function getAdminTopUpGames(): Promise<{ games: AdminTopUpGame[] }> {
  return adminFetch<{ games: AdminTopUpGame[] }>('/api/admin/topup/games');
}

export interface AdminTopUpGame {
  id: string;
  name: string;
  imageUrl: string | null;
  providerId: string | null;
  providerServiceId: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  provider: { id: string; name: string; status: string } | null;
  packageCount: number;
}

export function createAdminTopUpGame(data: {
  name: string;
  imageUrl?: string | null;
  providerId?: string | null;
  providerServiceId?: string;
  isActive?: boolean;
  sortOrder?: number;
}): Promise<{ game: AdminTopUpGame }> {
  return adminFetch<{ game: AdminTopUpGame }>('/api/admin/topup/games', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export function updateAdminTopUpGame(
  id: string,
  data: {
    name?: string;
    imageUrl?: string | null;
    providerId?: string | null;
    providerServiceId?: string;
    isActive?: boolean;
    sortOrder?: number;
  }
): Promise<{ game: AdminTopUpGame }> {
  return adminFetch<{ game: AdminTopUpGame }>(`/api/admin/topup/games/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}

export function setAdminTopUpGameStatus(id: string, isActive: boolean): Promise<{ game: AdminTopUpGame }> {
  return adminFetch<{ game: AdminTopUpGame }>(`/api/admin/topup/games/${id}/status`, {
    method: 'POST',
    body: JSON.stringify({ isActive })
  });
}

export function deleteAdminTopUpGame(id: string): Promise<{ success: boolean }> {
  return adminFetch<{ success: boolean }>(`/api/admin/topup/games/${id}`, { method: 'DELETE' });
}

export function createAdminTopUpPackage(data: {
  gameId: string;
  name: string;
  diamondAmount?: number;
  content?: string | null;
  price: string;
  currency?: string;
  providerCost?: string | number | null;
  providerOfferId?: string | null;
  isActive?: boolean;
  sortOrder?: number;
  icon?: string | null;
  imageUrl?: string | null;
  customerNote?: string | null;
  noteColor?: 'WARNING' | 'INFO' | 'SUCCESS' | 'DANGER' | 'PURPLE';
}): Promise<{ pkg: AdminTopUpPackage }> {
  return adminFetch<{ pkg: AdminTopUpPackage }>('/api/admin/topup/packages', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export function updateAdminTopUpPackage(
  id: string,
  data: {
    gameId?: string;
    name?: string;
    diamondAmount?: number;
    content?: string | null;
    price?: string;
    currency?: string;
    providerCost?: string | number | null;
    providerOfferId?: string | null;
    isActive?: boolean;
    sortOrder?: number;
    icon?: string | null;
    imageUrl?: string | null;
    customerNote?: string | null;
    noteColor?: 'WARNING' | 'INFO' | 'SUCCESS' | 'DANGER' | 'PURPLE';
  }
): Promise<{ pkg: AdminTopUpPackage }> {
  return adminFetch<{ pkg: AdminTopUpPackage }>(`/api/admin/topup/packages/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}

export function setAdminTopUpPackageStatus(id: string, isActive: boolean): Promise<{ pkg: AdminTopUpPackage }> {
  return adminFetch<{ pkg: AdminTopUpPackage }>(`/api/admin/topup/packages/${id}/status`, {
    method: 'POST',
    body: JSON.stringify({ isActive })
  });
}

/**
 * Link an existing package to an EXTERNAL provider offer and snapshot the
 * provider cost. Selling price, name and status are never touched by this
 * call — those stay explicit admin actions.
 */
export function linkAdminTopUpPackageOffer(id: string, data: {
  providerOfferId?: string | null;
  providerCost?: string | number | null;
}): Promise<{ pkg: AdminTopUpPackage }> {
  return adminFetch<{ pkg: AdminTopUpPackage }>(`/api/admin/topup/packages/${id}/link-offer`, {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export function deleteAdminTopUpPackage(id: string): Promise<{ success: boolean }> {
  return adminFetch<{ success: boolean }>(`/api/admin/topup/packages/${id}`, { method: 'DELETE' });
}

// ---------- Top-Up Providers ----------

export function getAdminTopUpProviders(): Promise<{ providers: AdminTopUpProvider[] }> {
  return adminFetch<{ providers: AdminTopUpProvider[] }>('/api/admin/topup/providers');
}

export function createAdminTopUpProvider(data: {
  name: string;
  apiUrl: string;
  apiKey: string;
}): Promise<{ provider: AdminTopUpProvider }> {
  return adminFetch<{ provider: AdminTopUpProvider }>('/api/admin/topup/providers', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export function updateAdminTopUpProvider(
  id: string,
  data: {
    name?: string;
    apiUrl?: string;
    apiKey?: string;
    status?: 'ACTIVE' | 'DISABLED';
  }
): Promise<{ provider: AdminTopUpProvider }> {
  return adminFetch<{ provider: AdminTopUpProvider }>(`/api/admin/topup/providers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}

export function setAdminTopUpProviderStatus(id: string, status: 'ACTIVE' | 'DISABLED'): Promise<{ provider: AdminTopUpProvider }> {
  return adminFetch<{ provider: AdminTopUpProvider }>(`/api/admin/topup/providers/${id}/status`, {
    method: 'POST',
    body: JSON.stringify({ status })
  });
}

export function testAdminTopUpProvider(id: string): Promise<{ success: boolean; error?: string; balance?: number; currency?: string }> {
  return adminFetch<{ success: boolean; error?: string }>(`/api/admin/topup/providers/${id}/test`, {
    method: 'POST'
  });
}

export function deleteAdminTopUpProvider(id: string): Promise<{ success: boolean }> {
  return adminFetch<{ success: boolean }>(`/api/admin/topup/providers/${id}`, { method: 'DELETE' });
}

// ---------- Top-Up Provider Services ----------

export interface AdminTopUpProviderService {
  id: string;
  providerId: string;
  providerServiceId: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED';
  createdAt: string;
  updatedAt: string;
  provider: { id: string; name: string; status: string } | null;
  gameCount: number;
  packageCount: number;
}

export interface AdminTopUpProviderServicesResponse {
  services: AdminTopUpProviderService[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminTopUpProviderServiceFilters {
  providerId?: string;
  search?: string;
  isActive?: string;
  page?: number;
  pageSize?: number;
}

export function getAdminTopUpProviderServices(filters: AdminTopUpProviderServiceFilters = {}): Promise<AdminTopUpProviderServicesResponse> {
  return adminFetch<AdminTopUpProviderServicesResponse>(`/api/admin/topup/provider-services${buildQuery(filters)}`);
}

export function createAdminTopUpProviderService(data: {
  providerId: string;
  providerServiceId: string;
  name: string;
  status?: 'ACTIVE' | 'DISABLED';
}): Promise<{ service: AdminTopUpProviderService }> {
  return adminFetch<{ service: AdminTopUpProviderService }>('/api/admin/topup/provider-services', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export function updateAdminTopUpProviderService(
  id: string,
  data: {
    providerServiceId?: string;
    name?: string;
    status?: 'ACTIVE' | 'DISABLED';
  }
): Promise<{ service: AdminTopUpProviderService }> {
  return adminFetch<{ service: AdminTopUpProviderService }>(`/api/admin/topup/provider-services/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}

export function setAdminTopUpProviderServiceStatus(id: string, status: 'ACTIVE' | 'DISABLED'): Promise<{ service: AdminTopUpProviderService }> {
  return adminFetch<{ service: AdminTopUpProviderService }>(`/api/admin/topup/provider-services/${id}/status`, {
    method: 'POST',
    body: JSON.stringify({ status })
  });
}

export function deleteAdminTopUpProviderService(id: string): Promise<{ success: boolean }> {
  return adminFetch<{ success: boolean }>(`/api/admin/topup/provider-services/${id}`, { method: 'DELETE' });
}

// ---------- Top-Up Remote Catalog Fetch ----------

export interface RemoteProviderCategory {
  category_id: string;
  name: string;
  note: string | null;
  region: string | null;
}

export interface RemoteProviderOfferField {
  key: string;
  label: string;
  type?: string;
}

export interface RemoteProviderOffer {
  offer_id: string;
  offer_name: string;
  price_usd: number;
}

export interface RemoteProviderOffersResult {
  offers: RemoteProviderOffer[];
  fields: RemoteProviderOfferField[];
  note: string | null;
  categoryName: string | null;
  externalCategoryId: string;
}

export interface RemoteCatalogWarning {
  id: string;
  name: string;
  providerServiceId: string;
}

export interface RemoteProviderCategoriesResult {
  categories: RemoteProviderCategory[];
  total: number;
  warnings: RemoteCatalogWarning[];
}

export function fetchRemoteProviderCategories(providerId: string): Promise<RemoteProviderCategoriesResult> {
  return adminFetch<RemoteProviderCategoriesResult>(`/api/admin/topup/providers/${providerId}/categories`);
}

export function fetchRemoteProviderOffers(providerId: string, categoryId: string): Promise<RemoteProviderOffersResult> {
  return adminFetch<RemoteProviderOffersResult>(`/api/admin/topup/providers/${providerId}/categories/${encodeURIComponent(categoryId)}/offers`);
}

// ---------- Top-Up Game Input Configuration ----------

export interface AdminTopUpCustomField {
  key: string;
  label: string;
  required: boolean;
  placeholder?: string;
}

export interface AdminTopUpGameConfig {
  id: string;
  game: string;
  requirePlayerId: boolean;
  requireServerId: boolean;
  playerIdValidation: 'NUMERIC' | 'TEXT';
  serverIdValidation: 'NUMERIC' | 'TEXT';
  verificationEnabled: boolean;
  allowUnverifiedPurchase?: boolean;
  verificationProviderId: string | null;
  verificationServiceId: string | null;
  customerNote: string | null;
  customFields: AdminTopUpCustomField[];
  createdAt: string;
  updatedAt: string;
}

export function getAdminTopUpGameConfigs(): Promise<{ configs: AdminTopUpGameConfig[] }> {
  return adminFetch<{ configs: AdminTopUpGameConfig[] }>('/api/admin/topup/game-configs');
}

/** Live provider metadata: categories that currently support ID validation. */
export interface AdminValidationSupportCategory {
  categoryId: string;
  name: string;
  fields: Array<{ key: string; label: string; type?: string }>;
}

export function getAdminTopUpValidationSupport(providerId?: string): Promise<{
  providerId: string | null;
  categories: AdminValidationSupportCategory[];
  total: number;
}> {
  const query = providerId ? `?providerId=${encodeURIComponent(providerId)}` : '';
  return adminFetch(`/api/admin/topup/validation-support${query}`);
}

export function upsertAdminTopUpGameConfig(data: {
  gameId: string;
  requirePlayerId?: boolean;
  requireServerId?: boolean;
  playerIdValidation?: 'NUMERIC' | 'TEXT';
  serverIdValidation?: 'NUMERIC' | 'TEXT';
  verificationEnabled?: boolean;
  allowUnverifiedPurchase?: boolean;
  verificationProviderId?: string | null;
  verificationServiceId?: string | null;
  customerNote?: string | null;
  customFields?: AdminTopUpCustomField[] | null;
}): Promise<{ config: AdminTopUpGameConfig }> {
  return adminFetch<{ config: AdminTopUpGameConfig }>('/api/admin/topup/game-configs', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export function deleteAdminTopUpGameConfig(gameId: string): Promise<{ success: boolean }> {
  return adminFetch<{ success: boolean }>(`/api/admin/topup/game-configs/${encodeURIComponent(gameId)}`, {
    method: 'DELETE'
  });
}

// ---------- Orders ----------

export interface AdminOrdersResponse {
  orders: OrderDetail[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminOrderFilters {
  search?: string;
  userId?: string;
  status?: string;
  paymentStatus?: string;
  deliveryType?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export function getAdminOrders(filters: AdminOrderFilters = {}): Promise<AdminOrdersResponse> {
  return adminFetch<AdminOrdersResponse>(`/api/admin/orders${buildQuery(filters)}`);
}

export function getAdminOrder(id: string): Promise<OrderDetail> {
  return adminFetch<OrderDetail>(`/api/admin/orders/${id}`);
}

export interface AdminPaymentRecheckResult {
  success: boolean;
  status: string;
  providerTransactionHash: string | null;
  providerReference: string | null;
  paidAt: string | null;
  error: string | null;
  fulfillment: {
    success: boolean;
    errors: unknown[];
  } | null;
}

export function recheckAdminPayment(id: string): Promise<AdminPaymentRecheckResult> {
  return adminFetch<AdminPaymentRecheckResult>(`/api/admin/payments/${id}/recheck`, {
    method: 'POST'
  });
}

export interface AdminOrderStats {
  total: number;
  pending: number;
  paid: number;
  completed: number;
  cancelled: number;
  expired: number;
  totalRevenue: string;
}

export function getAdminOrderStats(): Promise<AdminOrderStats> {
  return adminFetch<AdminOrderStats>('/api/admin/orders/stats');
}

export function getAdminPendingHandDeliveryCount(): Promise<{ count: number }> {
  return adminFetch<{ count: number }>('/api/admin/orders/hand-delivery-count');
}

export function cancelAdminOrder(id: string, reason?: string): Promise<{ success: boolean }> {
  return adminFetch<{ success: boolean }>(`/api/admin/orders/${id}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason })
  });
}

export interface AdminRefundResult {
  success: boolean;
  idempotent?: boolean;
  provider: string;
  amountRefunded: string;
  currency: string;
  externalRefundRequired: boolean;
}

export function refundAdminOrder(id: string, amount?: string, reason?: string): Promise<{
  success: boolean;
  refund: AdminRefundResult;
}> {
  return adminFetch<{ success: boolean; refund: AdminRefundResult }>(`/api/admin/orders/${id}/refund`, {
    method: 'POST',
    body: JSON.stringify({ amount, reason })
  });
}

export function retryAdminPayment(id: string): Promise<{ success: boolean }> {
  return adminFetch<{ success: boolean }>(`/api/admin/payments/${id}/retry`, { method: 'POST' });
}

export interface AdminManualDelivery {
  id: string;
  orderItemId: string;
  orderId: string;
  productId: string;
  title: string;
  content: string;
  deliveredBy: string | null;
  createdAt: string;
  updatedAt: string;
  orderItem: { id: string; productNameSnapshot: string };
  product: { id: string; name: string; slug: string };
}

export function deliverAdminOrder(
  orderId: string,
  orderItemId: string,
  title: string,
  content: string
): Promise<{ delivery: AdminManualDelivery }> {
  return adminFetch<{ delivery: AdminManualDelivery }>(`/api/admin/orders/${orderId}/manual-deliver`, {
    method: 'POST',
    body: JSON.stringify({ orderItemId, title, content })
  });
}

export function getAdminOrderDeliveries(orderId: string): Promise<{ deliveries: AdminManualDelivery[] }> {
  return adminFetch<{ deliveries: AdminManualDelivery[] }>(`/api/admin/orders/${orderId}/deliveries`);
}

// ---------- Payments ----------

export interface ExpirePaymentsResult {
  success: boolean;
  expiredCount: number;
}

export function expireOldAdminPayments(maxAgeMinutes = 15): Promise<ExpirePaymentsResult> {
  return adminFetch<ExpirePaymentsResult>('/api/admin/payments/expire', {
    method: 'POST',
    body: JSON.stringify({ maxAgeMinutes })
  });
}

// ---------- Stock ----------

export interface AdminStockItem {
  id: string;
  productId: string;
  variantId: string | null;
  deliveryType: string;
  status: string;
  orderId: string | null;
  reservedAt: string | null;
  soldAt: string | null;
  createdAt: string;
  updatedAt: string;
  product: { id: string; name: string; slug: string } | null;
  variant: { id: string; name: string } | null;
  order: { id: string; orderNumber: number; userId: string } | null;
}

export interface AdminStockResponse {
  stock: AdminStockItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminStockFilters {
  productId?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export function getAdminStock(filters: AdminStockFilters = {}, storage?: AdminTokenStorage): Promise<AdminStockResponse> {
  return adminFetch<AdminStockResponse>(`/api/admin/stock${buildQuery(filters)}`, undefined, undefined, storage);
}

export function createAdminStock(
  productId: string,
  deliveryType: string,
  values: string[]
): Promise<{ stock: unknown[]; count: number }> {
  return adminFetch<{ stock: unknown[]; count: number }>('/api/admin/stock', {
    method: 'POST',
    body: JSON.stringify({ productId, deliveryType, values })
  });
}

export function disableAdminStock(id: string): Promise<{ success: boolean; disabledCount: number }> {
  return adminFetch<{ success: boolean; disabledCount: number }>(`/api/admin/stock/${id}/disable`, {
    method: 'POST'
  });
}

export function expireOldAdminStock(maxAgeMinutes = 15): Promise<{ success: boolean }> {
  return adminFetch<{ success: boolean }>('/api/admin/stock/expire', {
    method: 'POST',
    body: JSON.stringify({ maxAgeMinutes })
  });
}

export function getAdminStockSummary(): Promise<StockSummary> {
  return adminFetch<StockSummary>('/api/admin/stock/summary');
}

// ---------- Audit ----------

export interface AdminAuditResponse {
  logs: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminAuditFilters {
  adminId?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export function getAdminAuditLogs(filters: AdminAuditFilters = {}): Promise<AdminAuditResponse> {
  return adminFetch<AdminAuditResponse>(`/api/admin/audit${buildQuery(filters)}`);
}

export function getAdminAuditEntityHistory(entityType: string, entityId: string): Promise<{ history: AuditLogEntry[] }> {
  return adminFetch<{ history: AuditLogEntry[] }>(
    `/api/admin/audit/entity/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`
  );
}

export interface AdminAuditSummary {
  byAction: Record<string, number>;
  byEntity: Record<string, number>;
  byAdmin: Record<string, number>;
}

export function getAdminAuditSummary(dateFrom?: string, dateTo?: string): Promise<AdminAuditSummary> {
  return adminFetch<AdminAuditSummary>(`/api/admin/audit/summary${buildQuery({ dateFrom, dateTo })}`);
}

// ---------- SMM ----------

export interface SmmService {
  id: string;
  providerId: string;
  productId: string | null;
  providerServiceId: string;
  name: string;
  providerCost: string | null;
  minimumQuantity: number;
  maximumQuantity: number;
  status: string;
  metadata: unknown | null;
  createdAt: string;
  updatedAt: string;
}

export function getSmmServices(): Promise<{ services: SmmService[] }> {
  return adminFetch<{ services: SmmService[] }>('/api/smm/services');
}

export interface SmmOrderItem {
  id: string;
  orderId: string;
  smmServiceId: string;
  providerId: string;
  providerOrderId: string | null;
  target: string;
  quantity: number;
  status: string;
  lastProviderStatus: string | null;
  createdAt: string;
  updatedAt: string;
  amount: string;
  providerCost: string | null;
  service: SmmService;
  provider: { id: string; name: string; status: string };
  order: { id: string; orderNumber: number; user: { firstName: string; lastName: string | null; username: string | null } };
}

export function getSmmOrders(filters: { page?: number; pageSize?: number; status?: string } = {}): Promise<{
  orders: SmmOrderItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  return adminFetch(`/api/smm/orders${buildQuery(filters)}`);
}

// ---------- Users ----------

export interface AdminUsersResponse {
  users: User[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminUserFilters {
  search?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export function getAdminUsers(filters: AdminUserFilters = {}): Promise<AdminUsersResponse> {
  return adminFetch<AdminUsersResponse>(`/api/admin/users${buildQuery(filters)}`);
}

export function getAdminUser(id: string): Promise<UserDetail> {
  return adminFetch<UserDetail>(`/api/admin/users/${id}`);
}

export function setAdminUserStatus(id: string, status: string, reason?: string): Promise<{ user: User }> {
  return adminFetch<{ user: User }>(`/api/admin/users/${id}/status`, {
    method: 'POST',
    body: JSON.stringify({ status, reason })
  });
}

// ---------- Wallet ----------

export interface AdminWalletsResponse {
  wallets: Wallet[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminWalletFilters {
  search?: string;
  page?: number;
  pageSize?: number;
}

export function getAdminWallets(filters: AdminWalletFilters = {}): Promise<AdminWalletsResponse> {
  return adminFetch<AdminWalletsResponse>(`/api/admin/wallets${buildQuery(filters)}`);
}

export function getAdminWalletDetail(userId: string): Promise<WalletDetail> {
  return adminFetch<WalletDetail>(`/api/admin/wallets/user/${userId}`);
}

export function adjustAdminWalletBalance(
  userId: string,
  type: 'ADJUSTMENT' | 'BONUS',
  amount: string | number,
  reason: string
): Promise<{ id: string; userId: string; currency: string; balance: string; transaction: unknown }> {
  return adminFetch('/api/admin/wallets/adjustments', {
    method: 'POST',
    body: JSON.stringify({ userId, type, amount, reason })
  });
}

// ---------- Tickets ----------

export interface AdminTicketsResponse {
  tickets: Ticket[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminTicketFilters {
  search?: string;
  status?: SupportTicketStatus;
  userId?: string;
  page?: number;
  pageSize?: number;
}

export function getAdminTickets(filters: AdminTicketFilters = {}): Promise<AdminTicketsResponse> {
  return adminFetch<AdminTicketsResponse>(`/api/admin/tickets${buildQuery(filters)}`);
}

export function getAdminTicketUnreadCount(): Promise<{ unreadCount: number }> {
  return adminFetch<{ unreadCount: number }>('/api/admin/tickets/unread-count');
}

export function getAdminTicket(id: string): Promise<TicketDetail> {
  return adminFetch<TicketDetail>(`/api/admin/tickets/${id}`);
}

export function replyAdminTicket(id: string, body: string): Promise<{ message: unknown }> {
  return adminFetch<{ message: unknown }>(`/api/admin/tickets/${id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body })
  });
}

export function setAdminTicketStatus(id: string, status: SupportTicketStatus): Promise<{ ticket: { id: string; status: string; updatedAt: string } }> {
  return adminFetch(`/api/admin/tickets/${id}/status`, {
    method: 'POST',
    body: JSON.stringify({ status })
  });
}

// ---------- Settings ----------

export interface ApplicationSetting {
  key: string;
  value: unknown;
  description: string | null;
  updatedAt: string;
}

export function getAdminSettings(): Promise<{ settings: ApplicationSetting[] }> {
  return adminFetch<{ settings: ApplicationSetting[] }>('/api/admin/settings');
}

export function updateAdminSetting(key: string, value: unknown): Promise<{ setting: ApplicationSetting }> {
  return adminFetch<{ setting: ApplicationSetting }>(`/api/admin/settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value })
  });
}

// ---------- Notification targets ----------

export function getAdminNotificationTargets(): Promise<{ targets: NotificationTarget[] }> {
  return adminFetch<{ targets: NotificationTarget[] }>('/api/admin/notification-targets');
}

export function createAdminNotificationTarget(data: CreateNotificationTargetRequest): Promise<{ target: NotificationTarget }> {
  return adminFetch<{ target: NotificationTarget }>('/api/admin/notification-targets', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export function updateAdminNotificationTarget(id: string, data: UpdateNotificationTargetRequest): Promise<{ target: NotificationTarget }> {
  return adminFetch<{ target: NotificationTarget }>(`/api/admin/notification-targets/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}

export function deleteAdminNotificationTarget(id: string): Promise<{ success: boolean }> {
  return adminFetch<{ success: boolean }>(`/api/admin/notification-targets/${id}`, { method: 'DELETE' });
}

export interface AdminNotificationTargetTestResult {
  success: boolean;
  error: string | null;
}

export function testAdminNotificationTarget(id: string): Promise<AdminNotificationTargetTestResult> {
  return adminFetch<AdminNotificationTargetTestResult>(`/api/admin/notification-targets/${id}/test`, {
    method: 'POST'
  });
}

// ---------- Security events ----------

export interface SecurityEventEntry {
  id: string;
  eventType: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  ipAddress: string | null;
  userId: string | null;
  user: {
    id: string;
    telegramId: string;
    firstName: string;
    lastName: string;
    username: string | null;
  } | null;
  metadata: unknown | null;
  createdAt: string;
}

export interface AdminSecurityEventsResponse {
  events: SecurityEventEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminSecurityEventFilters {
  eventType?: string;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
  search?: string;
  page?: number;
  pageSize?: number;
}

export function getAdminSecurityEvents(filters: AdminSecurityEventFilters = {}): Promise<AdminSecurityEventsResponse> {
  return adminFetch<AdminSecurityEventsResponse>(`/api/admin/security-events${buildQuery(filters)}`);
}

// ---------- Payments (admin list) ----------

export interface AdminPaymentsResponse {
  payments: AdminPayment[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminPaymentFilters {
  provider?: string;
  status?: string;
  search?: string;
  userId?: string;
  page?: number;
  pageSize?: number;
}

export function getAdminPayments(filters: AdminPaymentFilters = {}): Promise<AdminPaymentsResponse> {
  return adminFetch<AdminPaymentsResponse>(`/api/admin/payments${buildQuery(filters)}`);
}

// ---------- Analytics ----------

export function getAdminAnalytics(): Promise<Analytics> {
  return adminFetch<Analytics>('/api/admin/analytics');
}

// ---------- Product duplication & bulk actions ----------

export function duplicateAdminProduct(id: string): Promise<{ product: ProductDetail }> {
  return adminFetch<{ product: ProductDetail }>(`/api/admin/products/${id}/duplicate`, { method: 'POST' });
}

export function bulkUpdateAdminProducts(
  ids: string[],
  action: 'ACTIVATE' | 'DEACTIVATE' | 'ARCHIVE' | 'CHANGE_CATEGORY',
  categoryId?: string
): Promise<{ success: boolean; updatedCount: number }> {
  return adminFetch<{ success: boolean; updatedCount: number }>('/api/admin/products/bulk', {
    method: 'POST',
    body: JSON.stringify({ ids, action, categoryId })
  });
}

// ---------- SMM providers & services (admin management) ----------

export function getAdminSmmProviders(): Promise<{ providers: AdminSmmProvider[] }> {
  return adminFetch<{ providers: AdminSmmProvider[] }>('/api/admin/smm/providers');
}

export function createAdminSmmProvider(data: CreateSmmProviderRequest): Promise<{ provider: AdminSmmProvider }> {
  return adminFetch<{ provider: AdminSmmProvider }>('/api/admin/smm/providers', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export function updateAdminSmmProvider(id: string, data: UpdateSmmProviderRequest): Promise<{ provider: AdminSmmProvider }> {
  return adminFetch<{ provider: AdminSmmProvider }>(`/api/admin/smm/providers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}

export function setAdminSmmProviderStatus(id: string, status: 'ACTIVE' | 'DISABLED'): Promise<{ provider: AdminSmmProvider }> {
  return adminFetch<{ provider: AdminSmmProvider }>(`/api/admin/smm/providers/${id}/status`, {
    method: 'POST',
    body: JSON.stringify({ status })
  });
}

export function getAdminSmmServices(): Promise<{ services: AdminSmmService[] }> {
  return adminFetch<{ services: AdminSmmService[] }>('/api/admin/smm/services');
}

export function createAdminSmmService(data: CreateSmmServiceRequest): Promise<{ service: AdminSmmService }> {
  return adminFetch<{ service: AdminSmmService }>('/api/admin/smm/services', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export function updateAdminSmmService(id: string, data: UpdateSmmServiceRequest): Promise<{ service: AdminSmmService }> {
  return adminFetch<{ service: AdminSmmService }>(`/api/admin/smm/services/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}

export function setAdminSmmServiceStatus(id: string, status: 'ACTIVE' | 'DISABLED'): Promise<{ service: AdminSmmService }> {
  return adminFetch<{ service: AdminSmmService }>(`/api/admin/smm/services/${id}/status`, {
    method: 'POST',
    body: JSON.stringify({ status })
  });
}

// ---------- Coupons (admin management) ----------

import type {
  CouponDetail,
  CouponsResponse,
  CreateCouponRequest,
  UpdateCouponRequest
} from '@jr/shared';

export interface AdminCouponFilters {
  search?: string;
  isActive?: string;
  page?: number;
  pageSize?: number;
}

export function getAdminCoupons(filters: AdminCouponFilters = {}): Promise<CouponsResponse> {
  return adminFetch<CouponsResponse>(`/api/admin/coupons${buildQuery(filters)}`);
}

export function createAdminCoupon(data: CreateCouponRequest): Promise<{ coupon: CouponDetail }> {
  return adminFetch<{ coupon: CouponDetail }>('/api/admin/coupons', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export function updateAdminCoupon(id: string, data: UpdateCouponRequest): Promise<{ coupon: CouponDetail }> {
  return adminFetch<{ coupon: CouponDetail }>(`/api/admin/coupons/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}

export function deleteAdminCoupon(id: string): Promise<{ success: boolean }> {
  return adminFetch<{ success: boolean }>(`/api/admin/coupons/${id}`, {
    method: 'DELETE'
  });
}
