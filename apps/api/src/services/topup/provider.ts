/**
 * Top-Up provider abstraction, modeled after the SMM provider layer.
 *
 * A provider adapter receives its credentials (apiUrl + decrypted apiKey)
 * from the database at call time. Adapters must never fall back to fake
 * "success" — if the provider is unavailable or rejects the request, the
 * real error is returned and the order is left for retry/administration.
 */
export interface TopUpProvider {
  readonly name: string;
  readonly providerType: string;

  isAvailable(): boolean;
  createOrder(params: CreateTopUpOrderParams): Promise<CreateTopUpOrderResult>;
  getOrderStatus(params: GetTopUpOrderStatusParams): Promise<GetTopUpOrderStatusResult>;
  testConnection(): Promise<TestConnectionResult>;
  verifyAccount(params: VerifyAccountParams): Promise<VerifyAccountResult>;
  getValidationSupport?(): Promise<ValidationSupportResult>;
  validateAccount?(params: ProviderValidateAccountParams): Promise<ProviderValidateAccountResult>;
  /**
   * Optional: the exact account-field keys required by this category's
   * offers, used to filter what is sent in the supplier order payload.
   */
  getOfferFieldKeys?(categoryId: string): Promise<string[] | null>;
}

export interface CreateTopUpOrderParams {
  orderId: string;
  /**
   * EXTERNAL provider service/category ID (e.g. FazerCards category_id).
   * Callers must resolve the internal database reference before calling.
   */
  serviceId: string;
  /** EXTERNAL provider offer/product ID (e.g. FazerCards offer_id). */
  offerId?: string;
  target: string;
  serverId?: string;
  customerFields?: Record<string, string>;
  quantity: number;
  reference: string;
  idempotencyKey: string;
}

export interface CreateTopUpOrderResult {
  success: boolean;
  providerOrderId?: string;
  /** The provider may have accepted the request even though no response was received. */
  uncertain?: boolean;
  error?: string;
}

export interface GetTopUpOrderStatusParams {
  providerOrderId?: string;
  reference?: string;
}

export type TopUpOrderStatusValue =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'REFUNDED';

export interface GetTopUpOrderStatusResult {
  success: boolean;
  status?: TopUpOrderStatusValue;
  providerOrderId?: string;
  completedAt?: Date;
  error?: string;
}

export interface TestConnectionResult {
  success: boolean;
  error?: string;
  balance?: number;
  currency?: string;
}

export interface VerifyAccountParams {
  serviceId: string;
  target: string;
  serverId?: string;
}

export interface VerifyAccountResult {
  success: boolean;
  accountName?: string;
  error?: string;
}

/**
 * Generic, metadata-driven account verification contract.
 *
 * A provider adapter that supports pre-purchase account validation implements
 * `getValidationSupport` (which games/categories can be verified and which
 * fields they require) and `validateAccount` (the actual check). Both are
 * OPTIONAL: providers without this capability fall back to the base-class
 * defaults, which report "unsupported" — the system must never fake a result.
 */
export interface ValidationSupportField {
  key: string;
  label: string;
  type?: string;
}

export interface ValidationSupportCategory {
  /** External provider category/service id. */
  categoryId: string;
  name: string;
  fields: ValidationSupportField[];
}

export interface ValidationSupportResult {
  success: boolean;
  categories?: ValidationSupportCategory[];
  retryable?: boolean;
  error?: string;
}

export interface ProviderValidateAccountParams {
  categoryId: string;
  /** Dynamic field map keyed exactly as the provider requires. */
  fields: Record<string, string>;
}

export interface ProviderValidateAccountResult {
  success: boolean;
  valid?: boolean;
  playerName?: string | null;
  region?: string | null;
  retryable?: boolean;
  /** True when the provider rejected the submitted field set (client error). */
  badRequest?: boolean;
  /** Supplier HTTP status, for SERVER-SIDE diagnostics only. Never forwarded to customers. */
  statusCode?: number;
  error?: string;
}

export abstract class BaseTopUpProvider implements TopUpProvider {
  abstract readonly name: string;
  abstract readonly providerType: string;

  abstract createOrder(params: CreateTopUpOrderParams): Promise<CreateTopUpOrderResult>;
  abstract getOrderStatus(params: GetTopUpOrderStatusParams): Promise<GetTopUpOrderStatusResult>;
  abstract testConnection(): Promise<TestConnectionResult>;
  abstract verifyAccount(params: VerifyAccountParams): Promise<VerifyAccountResult>;

  isAvailable(): boolean {
    return true;
  }

  /**
   * Default: this provider does not expose a validation-support catalog.
   * Adapters with pre-purchase account verification override this.
   */
  async getValidationSupport(): Promise<ValidationSupportResult> {
    return { success: true, categories: [] };
  }

  /** Default: this provider cannot validate accounts. Never fake success. */
  async validateAccount(_params: ProviderValidateAccountParams): Promise<ProviderValidateAccountResult> {
    void _params;
    return { success: false, retryable: false, error: 'Provider does not support account validation' };
  }

  protected generateReference(): string {
    return `topup_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  protected generateIdempotencyKey(): string {
    return `topup_idem_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }
}
