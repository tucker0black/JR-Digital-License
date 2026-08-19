import type {
  AdminPayment,
  AdminSmmProvider,
  AdminSmmService,
  Analytics,
  AuditLogEntry,
  CategoryDetail,
  CreateCategoryRequest,
  CreateNotificationTargetRequest,
  CreateProductRequest,
  CreateSmmProviderRequest,
  CreateSmmServiceRequest,
  DashboardStats,
  NotificationTarget,
  OrderDetail,
  ProductDetail,
  StockSummary,
  SupportTicketStatus,
  Ticket,
  TicketDetail,
  UpdateCategoryRequest,
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
  storage: AdminTokenStorage = browserTokenStorage
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

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });

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
  const stats = await adminFetch<DashboardStats>('/api/admin/dashboard', {}, token, storage);
  setAdminToken(token, storage);
  return stats;
}

export function adminLogout(): void {
  clearAdminToken();
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

export function getAdminOrder(id: string): Promise<{ order: OrderDetail }> {
  return adminFetch<{ order: OrderDetail }>(`/api/admin/orders/${id}`);
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

export function cancelAdminOrder(id: string, reason?: string): Promise<{ success: boolean }> {
  return adminFetch<{ success: boolean }>(`/api/admin/orders/${id}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason })
  });
}

export function refundAdminOrder(id: string, reason?: string): Promise<{ success: boolean }> {
  return adminFetch<{ success: boolean }>(`/api/admin/orders/${id}/refund`, {
    method: 'POST',
    body: JSON.stringify({ reason })
  });
}

export function retryAdminPayment(id: string): Promise<{ success: boolean }> {
  return adminFetch<{ success: boolean }>(`/api/admin/payments/${id}/retry`, { method: 'POST' });
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
