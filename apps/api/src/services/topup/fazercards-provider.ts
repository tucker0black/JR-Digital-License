import { BaseTopUpProvider } from './provider.js';
import type {
  CreateTopUpOrderParams,
  CreateTopUpOrderResult,
  GetTopUpOrderStatusParams,
  GetTopUpOrderStatusResult,
  ProviderValidateAccountParams,
  ProviderValidateAccountResult,
  TestConnectionResult,
  ValidationSupportCategory,
  ValidationSupportResult,
  VerifyAccountParams,
  VerifyAccountResult,
} from './provider.js';

/**
 * FazerCards Top-Up provider adapter.
 *
 * Endpoint contract verified against the live API (base URL
 * https://api.fzr.cards/api/v2, X-API-Key header):
 *
 * - GET  /balance                          -> { ok, balance, currency }
 * - GET  /topups?cursor=<next_cursor>      -> { ok, kind, items: [{ category_id, name, note }],
 *                                                meta: { total, limit, next_cursor, has_more } }
 * - GET  /topups/offers?category_id=<id>   -> { ok, kind, category_id, name,
 *                                                offers: [{ offer_id, name, price_usd }],
 *                                                fields: [{ key, label, type }], note }
 * - POST /topups/order                     -> body { category_id, offer_id, fields: {player_id[, server_id, ...]} };
 *                                            errors use { ok: false, error } ("Insufficient balance." etc.)
 * - GET  /orders/<providerOrderId>         -> order status; unknown id -> { ok: false, error: "Order not found" }
 *
 * Responses are enveloped in `ok` (NOT `success`). Categories are paginated
 * with an opaque cursor that MUST be followed while meta.has_more is true.
 *
 * Requests never fake success: any missing configuration, network error,
 * or non-OK response is surfaced to the caller as the real error.
 */

export interface FazerCardsCategory {
  category_id: string;
  name: string;
  /** Raw provider note; contains region and input instructions. */
  note?: string | null;
  /** Region extracted from the note when the provider provides one. */
  region?: string | null;
}

export interface FazerCardsOfferField {
  key: string;
  label: string;
  type?: string;
}

export interface FazerCardsOffer {
  offer_id: string;
  offer_name: string;
  price_usd: number;
}

export interface FazerCardsValidationResult {
  valid: boolean;
  player_name?: string | null;
  region?: string | null;
}

export interface FazerOffersPayload {
  offers: FazerCardsOffer[];
  /** Provider-declared customer input fields for this category. */
  fields: FazerCardsOfferField[];
  note?: string | null;
  categoryName?: string | null;
}

interface TopUpProviderConfig {
  apiUrl: string;
  apiKey: string;
}

/** Generic FazerCards success envelope. */
interface FazerEnvelope<T> {
  ok?: boolean;
  error?: string;
  message?: string;
  data?: T;
}

interface FazerBalanceResponse extends FazerEnvelope<{ balance?: string | number }> {
  balance?: string | number;
  currency?: string;
}

interface FazerCategoryItem {
  category_id: string;
  name: string;
  note?: string | null;
}

interface FazerCategoriesResponse extends FazerEnvelope<FazerCategoryItem[]> {
  items?: FazerCategoryItem[];
  meta?: {
    total?: number;
    limit?: number;
    next_cursor?: string | null;
    has_more?: boolean;
  };
}

interface FazerOffersResponse extends FazerEnvelope<{
  category_id?: string;
  name?: string;
  offers?: Array<{ offer_id: string; name: string; price_usd?: string | number }>;
  fields?: Array<{ key: string; label: string; type?: string }>;
  note?: string | null;
}> {
  category_id?: string;
  name?: string;
  offers?: Array<{ offer_id: string; name: string; price_usd?: string | number }>;
  fields?: Array<{ key: string; label: string; type?: string }>;
  note?: string | null;
}

interface FazerCreateOrderResponse extends FazerEnvelope<unknown> {
  order_id?: string;
  id?: string;
  status?: string;
}

interface FazerOrderStatusResponse extends FazerEnvelope<unknown> {
  order_id?: string;
  id?: string;
  status?: string;
  completed_at?: string;
}

interface FazerValidateIdListResponse extends FazerEnvelope<unknown> {
  items?: Array<{
    category_id?: string;
    name?: string;
    fields?: Array<{ key?: string; label?: string; type?: string }>;
  }>;
  meta?: {
    total?: number;
    limit?: number;
    next_cursor?: string | null;
    has_more?: boolean;
  };
}

interface FazerValidateIdResponse extends FazerEnvelope<unknown> {
  category_id?: string;
  valid?: boolean;
  player_name?: string | null;
  region?: string | null;
}

const MAX_CATEGORY_PAGES = 20;

/** Hard client-side timeout so a hung provider call cannot hold a request. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Error carrying an HTTP availability classification for callers. */
export class TopUpProviderHttpError extends Error {
  constructor(message: string, readonly statusCode: number, readonly retryable: boolean) {
    super(message);
    this.name = 'TopUpProviderHttpError';
  }
}

function extractRegion(note?: string | null): string | null {
  if (!note) return null;
  const match = note.match(/Region:\s*([^\n\r]+)/i);
  return match?.[1]?.trim() ?? null;
}

function toNumber(value: string | number | undefined | null): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function pickOrderId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  const candidate = record.order_id ?? record.id ?? record.orderId;
  if (typeof candidate === 'string' && candidate) return candidate;
  if (candidate != null) return String(candidate);
  const nested = record.data ?? record.order;
  if (nested && typeof nested === 'object') return pickOrderId(nested);
  return undefined;
}

export class FazerCardsTopUpProvider extends BaseTopUpProvider {
  readonly name = 'FazerCards';
  readonly providerType = 'FAZERCARDS';

  private config: TopUpProviderConfig | null;

  constructor(config?: TopUpProviderConfig) {
    super();
    const apiUrl = config?.apiUrl?.trim().replace(/\/$/, '');
    const apiKey = config?.apiKey?.trim();
    this.config = apiUrl && apiKey ? { apiUrl, apiKey } : null;
  }

  override isAvailable(): boolean {
    return this.config !== null;
  }

  async testConnection(): Promise<TestConnectionResult> {
    if (!this.config) {
      return { success: false, error: 'Top-up provider is not configured' };
    }

    try {
      const response = await this.makeRequest<FazerBalanceResponse>('/balance', 'GET');
      if (response.ok !== true) {
        return { success: false, error: response.error || response.message || 'Provider connection test failed' };
      }
      const balance = toNumber(response.balance);
      return {
        success: true,
        balance,
        currency: response.currency ?? 'USD'
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Provider connection test failed'
      };
    }
  }

  async createOrder(params: CreateTopUpOrderParams): Promise<CreateTopUpOrderResult> {
    if (!this.config) {
      return { success: false, error: 'Top-up provider is not configured' };
    }

    // The live API requires exactly: category_id + offer_id + fields object.
    // `serviceId` carries the EXTERNAL FazerCards category id and `offerId`
    // the EXTERNAL offer id â€” both resolved from our database by the caller.
    if (!params.serviceId || !params.offerId) {
      return { success: false, error: 'FazerCards order requires a category ID and an offer ID' };
    }

    const fields: Record<string, string> = {};
    if (params.target) fields.player_id = params.target;
    if (params.serverId) fields.server_id = params.serverId;
    for (const [key, value] of Object.entries(params.customerFields ?? {})) {
      if (key === 'player_id' || key === 'server_id') continue;
      fields[key] = value;
    }

    try {
      const response = await this.makeRequest<FazerCreateOrderResponse>(
        '/topups/order',
        'POST',
        {
          category_id: params.serviceId,
          offer_id: params.offerId,
          fields
        },
        // Official contract: order creation accepts an Idempotency-Key header;
        // retrying with the same key returns the original order.
        { 'Idempotency-Key': params.idempotencyKey }
      );

      if (response.ok !== true) {
        return { success: false, error: response.error || response.message || 'Failed to create top-up order' };
      }

      const providerOrderId = pickOrderId(response);
      if (!providerOrderId) {
        return { success: false, uncertain: true, error: 'Provider did not return an order ID' };
      }

      return { success: true, providerOrderId };
    } catch (error) {
      const uncertain = error instanceof TopUpProviderHttpError
        ? error.retryable
        : true;
      return {
        success: false,
        uncertain,
        error: error instanceof Error ? error.message : 'Failed to create top-up order'
      };
    }
  }

  async getOrderStatus(params: GetTopUpOrderStatusParams): Promise<GetTopUpOrderStatusResult> {
    if (!this.config) {
      return { success: false, error: 'Top-up provider is not configured' };
    }

    if (!params.providerOrderId) {
      return { success: false, error: 'Missing provider order ID' };
    }

    try {
      const response = await this.makeRequest<FazerOrderStatusResponse>(
        `/orders/${encodeURIComponent(params.providerOrderId)}`,
        'GET'
      );

      if (response.ok !== true) {
        return { success: false, error: response.error || response.message || 'Failed to get top-up order status' };
      }

      const rawStatus = typeof response.status === 'string' ? response.status.toLowerCase() : '';
      const statusMap: Record<string, GetTopUpOrderStatusResult['status']> = {
        pending: 'PENDING',
        processing: 'PROCESSING',
        in_progress: 'PROCESSING',
        completed: 'COMPLETED',
        success: 'COMPLETED',
        cancelled: 'CANCELLED',
        canceled: 'CANCELLED',
        failed: 'FAILED',
        refunded: 'REFUNDED'
      };

      return {
        success: true,
        status: statusMap[rawStatus] ?? 'PENDING',
        providerOrderId: pickOrderId(response) ?? params.providerOrderId,
        completedAt: response.completed_at ? new Date(response.completed_at) : undefined
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get top-up order status'
      };
    }
  }

  async verifyAccount(_params: VerifyAccountParams): Promise<VerifyAccountResult> {
    // The live FazerCards API exposes no account-verification endpoint.
    // Never fake success â€” report it as unsupported so admins do not enable
    // verification against this provider.
    void _params;
    return { success: false, error: 'FazerCards does not support account verification' };
  }

  /**
   * Fetch the full top-up catalog, following the cursor pagination until the
   * provider reports has_more=false (bounded by MAX_CATEGORY_PAGES).
   */
  async getCategories(): Promise<{ success: boolean; categories?: FazerCardsCategory[]; total?: number; error?: string }> {
    if (!this.config) {
      return { success: false, error: 'Top-up provider is not configured' };
    }

    const categories: FazerCardsCategory[] = [];
    let cursor: string | null = null;
    let reportedTotal: number | undefined;

    try {
      for (let page = 0; page < MAX_CATEGORY_PAGES; page += 1) {
        const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
        const response: FazerCategoriesResponse = await this.makeRequest<FazerCategoriesResponse>(`/topups${query}`, 'GET');

        if (response.ok !== true) {
          return { success: false, error: response.error || response.message || 'Failed to fetch categories from provider' };
        }

        const items = Array.isArray(response.items) ? response.items : [];
        for (const item of items) {
          if (!item?.category_id || !item?.name) continue;
          categories.push({
            category_id: item.category_id,
            name: item.name,
            note: item.note ?? null,
            region: extractRegion(item.note)
          });
        }

        reportedTotal = response.meta?.total ?? reportedTotal;
        if (response.meta?.has_more && response.meta.next_cursor) {
          cursor = response.meta.next_cursor;
        } else {
          break;
        }
      }

      return { success: true, categories, total: reportedTotal ?? categories.length };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch categories from provider'
      };
    }
  }

  async getOffers(categoryId: string): Promise<{ success: boolean; payload?: FazerOffersPayload; error?: string }> {
    if (!this.config) {
      return { success: false, error: 'Top-up provider is not configured' };
    }

    if (!categoryId) {
      return { success: false, error: 'Category ID is required' };
    }

    try {
      const response = await this.makeRequest<FazerOffersResponse>(
        `/topups/offers?category_id=${encodeURIComponent(categoryId)}`,
        'GET'
      );

      if (response.ok !== true) {
        return { success: false, error: response.error || response.message || 'Failed to fetch offers from provider' };
      }

      const rawOffers = Array.isArray(response.offers) ? response.offers : [];
      const offers: FazerCardsOffer[] = rawOffers
        .filter((offer) => offer?.offer_id && offer?.name)
        .map((offer) => ({
          offer_id: offer.offer_id,
          offer_name: offer.name,
          price_usd: toNumber(offer.price_usd)
        }));

      const fields = (Array.isArray(response.fields) ? response.fields : [])
        .filter((field) => field?.key && field?.label)
        .map((field) => ({ key: field.key, label: field.label, type: field.type }));

      return {
        success: true,
        payload: {
          offers,
          fields,
          note: response.note ?? null,
          categoryName: response.name ?? null
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch offers from provider'
      };
    }
  }

  /**
   * Dynamic Player-ID validation support catalog (GET /topups/validate-id).
   * The returned list is the ONLY source of truth for whether a category can
   * be validated and which fields it requires. Never hard-code per game.
   */
  override async getValidationSupport(): Promise<ValidationSupportResult> {
    if (!this.config) {
      return { success: false, error: 'Top-up provider is not configured' };
    }

    const categories: ValidationSupportCategory[] = [];
    let cursor: string | null = null;

    try {
      for (let page = 0; page < MAX_CATEGORY_PAGES; page += 1) {
        const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
        const response: FazerValidateIdListResponse = await this.makeRequest<FazerValidateIdListResponse>(`/topups/validate-id${query}`, 'GET');

        if (response.ok !== true) {
          return { success: false, error: response.error || response.message || 'Failed to fetch validation support from provider' };
        }

        const items = Array.isArray(response.items) ? response.items : [];
        for (const item of items) {
          if (!item?.category_id || !item?.name || !Array.isArray(item.fields)) continue;
          categories.push({
            categoryId: item.category_id,
            name: item.name,
            fields: item.fields
              .filter((field): field is { key: string; label: string; type?: string } => Boolean(field?.key && field?.label))
              .map((field) => ({ key: field.key, label: field.label, type: field.type }))
          });
        }

        if (response.meta?.has_more && response.meta.next_cursor) {
          cursor = response.meta.next_cursor;
        } else {
          break;
        }
      }

      return { success: true, categories };
    } catch (error) {
      if (error instanceof TopUpProviderHttpError) {
        return { success: false, retryable: error.retryable, error: error.message };
      }
      return {
        success: false,
        retryable: true,
        error: error instanceof Error ? error.message : 'Failed to fetch validation support from provider'
      };
    }
  }

  /**
   * Validate a Player ID before ordering (POST /topups/validate-id).
   * Only valid when the live support catalog lists the category â€” callers
   * must check getValidationSupport() first.
   */
  override async validateAccount(params: ProviderValidateAccountParams): Promise<ProviderValidateAccountResult> {
    if (!this.config) {
      return { success: false, retryable: false, error: 'Top-up provider is not configured' };
    }

    if (!params.categoryId || !params.fields || Object.keys(params.fields).length === 0) {
      return { success: false, retryable: false, error: 'Category ID and account fields are required' };
    }

    try {
      const response = await this.makeRequest<FazerValidateIdResponse>(
        '/topups/validate-id',
        'POST',
        {
          category_id: params.categoryId,
          fields: params.fields
        }
      );

      if (response.ok !== true) {
        return { success: false, retryable: false, error: response.error || response.message || 'Validation failed' };
      }

      return {
        success: true,
        valid: response.valid === true,
        playerName: response.player_name ?? null,
        region: response.region ?? null
      };
    } catch (error) {
      if (error instanceof TopUpProviderHttpError) {
        // Live behaviour: 422 = "We could not validate this Player ID" â€” a
        // deterministic per-account answer (treated as invalid), while 400 =
        // missing/mismatched fields for the category. Neither is retryable;
        // 429/5xx/timeouts remain retryable. statusCode is carried for
        // SERVER-SIDE diagnostics only — the verification service sanitizes
        // everything before any customer response is built.
        if (error.statusCode === 422) {
          return { success: true, valid: false, playerName: null, region: null };
        }
        if (error.statusCode === 400) {
          return { success: false, retryable: false, statusCode: error.statusCode, error: error.message, badRequest: true };
        }
        return { success: false, retryable: error.retryable, statusCode: error.statusCode || undefined, error: error.message };
      }
      return {
        success: false,
        retryable: true,
        error: error instanceof Error ? error.message : 'Account validation failed'
      };
    }
  }

  /**
   * Exact account-field keys required by this category's offers
   * (GET /topups/offers â†’ fields[].key). Used to filter the supplier payload.
   */
  async getOfferFieldKeys(categoryId: string): Promise<string[] | null> {
    const result = await this.getOffers(categoryId);
    if (!result.success || !result.payload) return null;
    return result.payload.fields.map((field) => field.key);
  }

  private async makeRequest<T>(endpoint: string, method: 'GET' | 'POST', body?: unknown, headers?: Record<string, string>): Promise<T> {
    if (!this.config) {
      throw new Error('Top-up provider is not configured');
    }

    const url = `${this.config.apiUrl}${endpoint}`;
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.config.apiKey,
        ...(headers ?? {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    }).catch((error: unknown) => {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new TopUpProviderHttpError('Provider request timed out', 0, true);
      }
      throw error;
    });

    if (!response.ok) {
      // Include only the provider's own error text â€” never credentials.
      const errorText = await response.text().catch(() => '');
      let message = errorText;
      try {
        const parsed = JSON.parse(errorText) as { error?: string; message?: string };
        message = parsed.error || parsed.message || errorText;
      } catch {
        // keep raw text
      }
      const retryable = response.status === 429 || response.status >= 500;
      throw new TopUpProviderHttpError(
        `FazerCards API request failed (${response.status}): ${String(message).slice(0, 300)}`,
        response.status,
        retryable
      );
    }

    return response.json() as Promise<T>;
  }
}
