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
 * Volsever Game ID Checker — verification-only provider adapter.
 *
 * Endpoint contract (verified against live gateway at gate.volsever.com):
 *
 * - POST /proxy/api/game/id/check
 *   Body: { "game": "<game-slug>", "user_id": "<player-id>" }
 *   Auth: X-API-KEY: <VOLSEVER_API_KEY>
 *
 * - GET /proxy/api/balance
 *   Auth: X-API-KEY: <VOLSEVER_API_KEY>
 *   Returns remaining request balance.
 *
 * Base URL: https://gate.volsever.com
 *
 * This adapter ONLY implements account verification. It does NOT place
 * top-up orders — FazerCards handles all ordering. The `createOrder`
 * and `getOrderStatus` methods throw because they should never be called.
 */

const DEFAULT_BASE_URL = 'https://gate.volsever.com';

/**
 * Maps our internal TopUpProviderService.providerServiceId values
 * to Volsever's game slugs. This translation is adapter-internal —
 * the rest of the system never sees Volsever slugs.
 */
const VOLSEVER_GAME_SLUGS: Record<string, string> = {
  honor_of_kings: 'honor-of-kings',
  where_winds_meet: 'where-winds-meet',
  zepeto: 'zepeto',
};

/** Categories exposed for account validation. */
const VALIDATION_CATEGORIES: ValidationSupportCategory[] = [
  {
    categoryId: 'honor_of_kings',
    name: 'Honor of Kings',
    fields: [{ key: 'user_id', label: 'Player ID', type: 'text' }],
  },
  {
    categoryId: 'where_winds_meet',
    name: 'Where Winds Meet',
    fields: [{ key: 'user_id', label: 'Player ID', type: 'text' }],
  },
  {
    categoryId: 'zepeto',
    name: 'Zepeto',
    fields: [{ key: 'user_id', label: 'Player ID', type: 'text' }],
  },
];

/** Volsever success response shape. */
interface VolseverSuccessResponse {
  status: boolean;
  code: number;
  message: string;
  data?: {
    username?: string;
    user_id?: string;
    zone?: string;
    game?: string;
    region?: string;
  };
}

/** Volsever error response shape. */
interface VolseverErrorResponse {
  status: boolean;
  code: number;
  message: string;
}

interface VolseverProviderConfig {
  apiUrl: string;
  apiKey: string;
}

export class VolseverTopUpProvider extends BaseTopUpProvider {
  readonly name = 'Volsever';
  readonly providerType = 'volsever';

  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: VolseverProviderConfig) {
    super();
    this.baseUrl = (config.apiUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.apiKey = config.apiKey;
  }

  override isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  // ─── Account Verification (the only real purpose of this adapter) ───

  override async getValidationSupport(): Promise<ValidationSupportResult> {
    if (!this.apiKey) {
      return { success: false, error: 'Volsever API key not configured' };
    }
    return { success: true, categories: VALIDATION_CATEGORIES };
  }

  override async validateAccount(
    params: ProviderValidateAccountParams
  ): Promise<ProviderValidateAccountResult> {
    if (!this.apiKey) {
      return {
        success: false,
        retryable: false,
        error: 'Volsever API key not configured',
      };
    }

    const gameSlug = VOLSEVER_GAME_SLUGS[params.categoryId];
    if (!gameSlug) {
      return {
        success: false,
        retryable: false,
        error: `Unsupported game category: ${params.categoryId}`,
        badRequest: true,
      };
    }

    const playerId = params.fields.user_id;
    if (!playerId || !playerId.trim()) {
      return {
        success: false,
        retryable: false,
        error: 'Player ID is required',
        badRequest: true,
      };
    }

    const url = `${this.baseUrl}/proxy/api/game/id/check`;

    let response: Response;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15_000);

      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': this.apiKey,
        },
        body: JSON.stringify({
          game: gameSlug,
          user_id: playerId.trim(),
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
    } catch (error: unknown) {
      const isAbort =
        error instanceof DOMException && error.name === 'AbortError';
      return {
        success: false,
        retryable: true,
        error: isAbort
          ? 'Volsever request timed out'
          : 'Failed to connect to Volsever',
      };
    }

    // Read body once for all branches.
    let body: VolseverSuccessResponse | VolseverErrorResponse;
    try {
      body = (await response.json()) as
        | VolseverSuccessResponse
        | VolseverErrorResponse;
    } catch {
      return {
        success: false,
        retryable: true,
        error: 'Invalid Volsever response',
        statusCode: response.status,
      };
    }

    // ── HTTP-level errors ──
    if (!response.ok) {
      const is401 = response.status === 401;
      const is429 = response.status === 429;
      const is5xx = response.status >= 500;

      return {
        success: false,
        retryable: is429 || is5xx,
        badRequest: response.status === 400,
        statusCode: response.status,
        error: is401
          ? 'Volsever authentication failed (invalid API key)'
          : is429
            ? 'Volsever rate limit exceeded'
            : is5xx
              ? 'Volsever server error'
              : body.message || `Volsever error (HTTP ${response.status})`,
      };
    }

    // ── Application-level success check ──
    // Volsever returns status: true when the ID was found, false when not.
    if (body.status !== true) {
      return {
        success: true,
        valid: false,
        playerName: null,
        error: body.message || 'Player ID not found',
      };
    }

    // ── Valid account — extract nickname ──
    const data = (body as VolseverSuccessResponse).data;
    const nickname = data?.username ?? null;

    return {
      success: true,
      valid: true,
      playerName: nickname,
      region: data?.region ?? data?.zone ?? null,
    };
  }

  // ─── Stubs: ordering is NOT handled by Volsever ───

  async createOrder(
    _params: CreateTopUpOrderParams
  ): Promise<CreateTopUpOrderResult> {
    void _params;
    return {
      success: false,
      error:
        'Volsever is a verification-only provider. Use FazerCards for top-up orders.',
    };
  }

  async getOrderStatus(
    _params: GetTopUpOrderStatusParams
  ): Promise<GetTopUpOrderStatusResult> {
    void _params;
    return {
      success: false,
      error:
        'Volsever is a verification-only provider. Use FazerCards for order status.',
    };
  }

  async verifyAccount(
    _params: VerifyAccountParams
  ): Promise<VerifyAccountResult> {
    void _params;
    return {
      success: false,
      error:
        'Use validateAccount() for pre-purchase verification.',
    };
  }

  async testConnection(): Promise<TestConnectionResult> {
    if (!this.apiKey) {
      return { success: false, error: 'Volsever API key not configured' };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);

      const response = await fetch(`${this.baseUrl}/proxy/api/balance`, {
        method: 'GET',
        headers: {
          'X-API-KEY': this.apiKey,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          success: false,
          error: `Volsever balance check failed (HTTP ${response.status})`,
        };
      }

      const body = (await response.json()) as {
        status?: boolean;
        balance?: number;
        currency?: string;
      };

      return {
        success: body.status === true || response.ok,
        balance: body.balance,
        currency: body.currency,
      };
    } catch (error: unknown) {
      const isAbort =
        error instanceof DOMException && error.name === 'AbortError';
      return {
        success: false,
        error: isAbort ? 'Volsever connection timed out' : 'Failed to connect to Volsever',
      };
    }
  }
}
