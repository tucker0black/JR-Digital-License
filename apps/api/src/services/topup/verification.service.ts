import crypto from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { decryptInventoryValue } from '../../utils/encryption.js';
import type { TopUpProvider as ProviderAdapter } from './provider.js';
import type { ValidationSupportCategory } from './provider.js';

/**
 * Generic, provider-driven account verification for game top-ups.
 *
 * There is NO per-game logic here. Everything is decided by live provider
 * metadata:
 *   1. Resolve package → game → validation category id. By default this is
 *      the package provider service's EXTERNAL ordering id; an admin may pin
 *      an explicit verification provider/service on the game config for
 *      games whose ordering and validation ids diverge with no shared prefix.
 *   2. Ask the provider which categories currently support validation and
 *      what fields they require (GET /topups/validate-id on FazerCards).
 *      The stored ordering id matches by exact id or longest family prefix
 *      (e.g. "free_fire_sg" → family "free_fire").
 *   3. If the category is listed → require a successful, unexpired,
 *      single-use verification bound to the customer + package + exact field
 *      values before an order may be created.
 *   4. If it is not listed → verification is "not available"; purchase is
 *      only allowed when the game configuration explicitly permits it
 *      (allowUnverifiedPurchase). Verification is never faked.
 *
 * Adding a future game requires only the normal Provider → Service → Game →
 * Package configuration. If the provider reports validation support for its
 * category, this service picks it up automatically.
 */

export const VERIFICATION_TTL_MINUTES = Number(process.env.TOPUP_VERIFICATION_TTL_MINUTES ?? 10);
const SUPPORT_CACHE_TTL_MS = 5 * 60 * 1000;

interface SupportCacheEntry {
  categories: Map<string, ValidationSupportCategory>;
  fetchedAt: number;
}

const supportCache = new Map<string, SupportCacheEntry>();

function clearSupportCacheForTests(): void {
  supportCache.clear();
}
export { clearSupportCacheForTests };

/** Deterministic hash of the verified field values (order-independent). */
export function hashFields(fields: Record<string, string>): string {
  const canonical = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\u0001');
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export interface VerificationFieldInfo {
  key: string;
  label: string;
  type?: string;
}

export interface VerificationInfo {
  /** False when the package is not provider-linked at all (no checks apply). */
  applicable: boolean;
  /** Whether the resolved category is in the provider's live support list. */
  verificationAvailable: boolean;
  /**
   * False when we could not CHECK the live support catalog at all (provider
   * down/auth/timeout). Customers must then see "temporarily unavailable",
   * never "not available for this game" — those are different states.
   */
  availabilityKnown: boolean;
  /** Required fields straight from provider metadata (dynamic keys). */
  fields: VerificationFieldInfo[];
  categoryId: string | null;
  /** Admin escape hatch for games the provider cannot verify. */
  allowUnverifiedPurchase: boolean;
  /**
   * Provider that owns the validation call — the ordering provider, or the
   * admin-pinned verification override when one is configured.
   */
  providerId?: string | null;
  /** Internal TopUpProviderService row whose external id was matched. */
  providerServiceId?: string | null;
}

/**
 * Customer-safe failure reasons. These (and ONLY these) reach the Mini App;
 * every supplier-side detail is logged server-side instead.
 *
 * VERIFICATION_UNAVAILABLE covers EVERY supplier-side outage or rejection
 * that is not a per-account answer: auth failures, inactive subscriptions,
 * rate limits, 5xx, timeouts, network errors, unexpected responses.
 * Customers see a generic "temporarily unavailable" message — never the
 * supplier name, status code, or error text.
 */
export type VerifyFailureReason =
  | 'PLAYER_NOT_FOUND'
  | 'VALIDATION_NOT_SUPPORTED'
  | 'VERIFICATION_UNAVAILABLE'
  | 'MISSING_FIELDS'
  | 'UNKNOWN_FIELD'
  | 'PACKAGE_NOT_FOUND';

/** Generic, customer-safe messages. NEVER embed supplier details here. */
export const VERIFICATION_SAFE_ERRORS = {
  PLAYER_NOT_FOUND: 'Player ID not found.',
  VERIFICATION_UNAVAILABLE: 'Account verification is temporarily unavailable. Please try again later.',
  VALIDATION_NOT_SUPPORTED: 'Player ID verification is not available for this game.',
  MISSING_FIELDS_CHECK: 'Please check your account details and try again.'
} as const;

export interface VerifyPlayerResult {
  // CASE 1: supported + valid
  valid?: true;
  verified?: true;
  playerName?: string;
  region?: string;
  verificationToken?: string;
  expiresAt?: string;
  // CASE 2 / CASE 3 diagnostics
  reason?: VerifyFailureReason;
  verificationAvailable?: boolean;
  allowUnverifiedPurchase?: boolean;
  error?: string;
}

/**
 * Resolve the validation-support entry for an externally-configured category.
 *
 * FazerCards' validate-id catalog exposes GENERIC family ids (e.g.
 * "free_fire", "mobile_legends") while ordering uses REGIONAL ids
 * (e.g. "free_fire_sg", "mobile_legends_singapore"). Matching rule,
 * fully metadata-driven (no game names in code):
 *   1. Exact id match, else
 *   2. Longest family prefix: external id starts with "<family>_".
 * Works automatically for any future game whose family follows the same
 * convention, and keeps working unchanged if the provider lists regional
 * ids directly (rule 1 then applies).
 */
function findSupportEntry(
  categories: Map<string, ValidationSupportCategory>,
  externalCategoryId: string
): ValidationSupportCategory | undefined {
  const exact = categories.get(externalCategoryId);
  if (exact) return exact;

  let bestFamilyId: string | null = null;
  for (const familyId of categories.keys()) {
    if (!externalCategoryId.startsWith(`${familyId}_`)) continue;
    if (bestFamilyId === null || familyId.length > bestFamilyId.length) {
      bestFamilyId = familyId;
    }
  }
  return bestFamilyId ? categories.get(bestFamilyId) : undefined;
}

export class TopUpVerificationService {
  /**
   * Optional structured logger (pino-style). Server-side ONLY: supplier
   * diagnostics (provider name, HTTP status, raw reason) go here and NEVER
   * into a customer response.
   */
  constructor(
    private prisma: PrismaClient,
    private logger?: { warn?: (obj: unknown, msg?: string) => void; error?: (obj: unknown, msg?: string) => void }
  ) {}

  /**
   * Log the real supplier failure for administrators/developers. This is the
   * ONLY place supplier details are recorded; nothing logged here is ever
   * returned to the Mini App.
   */
  private logProviderFailure(providerName: string, detail: {
    status?: number | string;
    reason?: string;
    categoryId?: string | null;
    scope: 'validate-account' | 'support-catalog';
  }): void {
    const entry = { provider: providerName, ...detail };
    try {
      (this.logger?.warn ?? ((obj, msg) => console.warn(`${msg ?? ''} ${JSON.stringify(obj)}`)))(
        entry,
        '[TopUpVerification] supplier verification failed'
      );
    } catch {
      // Logging must never break verification.
    }
  }

  private async loadProviderAdapter(providerId: string): Promise<ProviderAdapter> {
    const provider = await this.prisma.topUpProvider.findUnique({ where: { id: providerId } });
    if (!provider) throw new Error('Top-up provider not found');
    if (provider.status !== 'ACTIVE') throw new Error('Top-up provider is disabled');

    let apiKey: string;
    try {
      apiKey = decryptInventoryValue(provider.encryptedApiKey);
    } catch {
      throw new Error('Failed to load top-up provider credentials');
    }

    const { createTopUpProvider } = await import('./provider-factory.js');
    return createTopUpProvider({ name: provider.name, apiUrl: provider.apiUrl, apiKey });
  }

  private async getSupportCategories(providerId: string, adapter: ProviderAdapter): Promise<Map<string, ValidationSupportCategory>> {
    const cached = supportCache.get(providerId);
    if (cached && Date.now() - cached.fetchedAt < SUPPORT_CACHE_TTL_MS) {
      return cached.categories;
    }

    if (!adapter.getValidationSupport) {
      return new Map();
    }

    const result = await adapter.getValidationSupport();
    if (!result.success || !result.categories) {
      throw new Error(result.error ?? 'Provider validation support unavailable');
    }

    const map = new Map<string, ValidationSupportCategory>();
    for (const category of result.categories) {
      map.set(category.categoryId, category);
    }
    supportCache.set(providerId, { categories: map, fetchedAt: Date.now() });
    return map;
  }

  /**
   * Live verification metadata for one package. Read-only; safe to call on
   * every page load (the support catalog is cached briefly server-side).
   *
   * Resolution order (always metadata-driven, never per-game):
   *   1. Admin-pinned override: gameConfig.verificationProviderId +
   *      verificationServiceId (both ACTIVE) → that service's EXTERNAL id is
   *      the validation category, regardless of the ordering category.
   *   2. Otherwise: the package's own provider + its EXTERNAL ordering
   *      category id, matched against the live support catalog by exact id
   *      or longest family prefix (e.g. "free_fire_sg" → "free_fire").
   */
  async getVerificationInfo(packageId: string): Promise<VerificationInfo> {
    const pkg = await this.prisma.topUpPackage.findUnique({
      where: { id: packageId },
      include: {
        game: { include: { gameConfig: true } },
        providerService: true,
        provider: true
      }
    });

    if (!pkg) {
      return {
        applicable: false,
        verificationAvailable: false,
        availabilityKnown: false,
        fields: [],
        categoryId: null,
        allowUnverifiedPurchase: true
      };
    }

    // Not provider-linked: nothing to verify against.
    if (!pkg.providerId || !pkg.providerServiceId || !pkg.providerService) {
      return { applicable: false, verificationAvailable: false, availabilityKnown: false, fields: [], categoryId: null, allowUnverifiedPurchase: true };
    }

    const gameConfig = pkg.game?.gameConfig ?? null;
    const allowUnverifiedPurchase = gameConfig?.allowUnverifiedPurchase ?? false;

    // Resolve which provider + external category id own the VALIDATION call.
    let validationProviderId = pkg.providerId;
    let externalCategoryId = pkg.providerService.providerServiceId;
    let validationServiceRowId = pkg.providerService.id;

    if (
      gameConfig?.verificationProviderId &&
      gameConfig?.verificationServiceId &&
      (gameConfig.verificationProviderId !== pkg.providerId ||
        gameConfig.verificationServiceId !== pkg.providerServiceId)
    ) {
      const overrideService = await this.prisma.topUpProviderService.findUnique({
        where: { id: gameConfig.verificationServiceId }
      });
      if (
        overrideService &&
        overrideService.status === 'ACTIVE' &&
        overrideService.providerId === gameConfig.verificationProviderId
      ) {
        validationProviderId = overrideService.providerId;
        externalCategoryId = overrideService.providerServiceId;
        validationServiceRowId = overrideService.id;
      }
      // A misconfigured override falls through to the ordering-category
      // resolution below rather than silently disabling verification.
    }

    let supported: ValidationSupportCategory | undefined;
    let catalogAvailable = true;
    try {
      const adapter = await this.loadProviderAdapter(validationProviderId);
      const categories = await this.getSupportCategories(validationProviderId, adapter);
      supported = findSupportEntry(categories, externalCategoryId);
    } catch (error) {
      // Catalog could not be CHECKED right now. Customers must see
      // "temporarily unavailable" — never "not available for this game".
      // The raw reason is logged server-side only.
      catalogAvailable = false;
      this.logProviderFailure(pkg.provider?.name ?? String(validationProviderId), {
        scope: 'support-catalog',
        categoryId: externalCategoryId,
        status: 'unreachable',
        reason: error instanceof Error ? error.message : 'unknown error'
      });
    }

    return {
      applicable: true,
      verificationAvailable: Boolean(supported),
      availabilityKnown: catalogAvailable,
      fields: supported?.fields ?? [],
      // The FAMILY category id used for validation calls (may differ from the
      // regional ordering id — that one stays on providerService).
      categoryId: supported?.categoryId ?? null,
      allowUnverifiedPurchase,
      providerId: validationProviderId,
      providerServiceId: validationServiceRowId
    };
  }

  /** Assemble the canonical field map from the customer's order inputs. */
  static buildFieldsFromOrderInputs(
    requiredKeys: string[],
    inputs: { target?: string; serverId?: string; customFields?: Record<string, string> }
  ): Record<string, string> {
    const fields: Record<string, string> = {};
    for (const key of requiredKeys) {
      let value: string | undefined;
      if (key === 'player_id') value = inputs.target;
      else if (key === 'server_id') value = inputs.serverId;
      else value = inputs.customFields?.[key];
      if (value !== undefined && value !== null) fields[key] = String(value).trim();
    }
    return fields;
  }

  /**
   * CASE 1/2/3 handler for POST /api/verify-player.
   */
  async verifyPlayer(
    userId: string,
    packageId: string,
    rawFields: Record<string, unknown>
  ): Promise<VerifyPlayerResult> {
    const info = await this.getVerificationInfo(packageId);

    if (!info.applicable) {
      return { reason: 'PACKAGE_NOT_FOUND', error: 'Top-up package not found' };
    }

    if (!info.verificationAvailable) {
      // Distinguish "we could not check right now" from "genuinely not
      // supported" — different customer messages, both supplier-blind.
      if (info.availabilityKnown === false) {
        return {
          reason: 'VERIFICATION_UNAVAILABLE',
          verificationAvailable: false,
          allowUnverifiedPurchase: info.allowUnverifiedPurchase,
          error: VERIFICATION_SAFE_ERRORS.VERIFICATION_UNAVAILABLE
        };
      }
      // CASE 3 — genuinely unsupported category; never pretend verification ran.
      return {
        reason: 'VALIDATION_NOT_SUPPORTED',
        verificationAvailable: false,
        allowUnverifiedPurchase: info.allowUnverifiedPurchase,
        error: VERIFICATION_SAFE_ERRORS.VALIDATION_NOT_SUPPORTED
      };
    }

    // Normalize + validate the submitted dynamic fields.
    const fields: Record<string, string> = {};
    const knownKeys = new Set(info.fields.map((field) => field.key));
    for (const [key, value] of Object.entries(rawFields ?? {})) {
      if (!knownKeys.has(key)) {
        return { reason: 'UNKNOWN_FIELD', error: `Unknown account field: ${key}` };
      }
      if (typeof value !== 'string' || value.trim().length === 0) {
        return { reason: 'MISSING_FIELDS', error: `'${info.fields.find((f) => f.key === key)?.label ?? key}' is required` };
      }
      if (value.length > 100) {
        return { reason: 'MISSING_FIELDS', error: `Invalid value for '${key}'` };
      }
      fields[key] = value.trim();
    }
    for (const field of info.fields) {
      if (!(field.key in fields)) {
        return { reason: 'MISSING_FIELDS', error: `'${field.label}' is required` };
      }
    }

    const pkg = await this.prisma.topUpPackage.findUnique({
      where: { id: packageId },
      select: { gameId: true, providerId: true, providerServiceId: true }
    });
    if (!pkg?.providerId || !info.categoryId) {
      return { reason: 'PACKAGE_NOT_FOUND', error: 'Top-up package not found' };
    }

    // Same provider resolution as getVerificationInfo (override-aware) so the
    // support lookup and the validation call can never target two providers.
    const adapter = await this.loadProviderAdapter(info.providerId ?? pkg.providerId);
    if (!adapter.validateAccount) {
      return {
        reason: 'VALIDATION_NOT_SUPPORTED',
        verificationAvailable: false,
        allowUnverifiedPurchase: info.allowUnverifiedPurchase,
        error: VERIFICATION_SAFE_ERRORS.VALIDATION_NOT_SUPPORTED
      };
    }

    const providerName = (await this.prisma.topUpProvider.findUnique({
      where: { id: info.providerId ?? pkg.providerId },
      select: { name: true }
    }))?.name ?? 'unknown';

    let result;
    try {
      result = await adapter.validateAccount({ categoryId: info.categoryId!, fields });
    } catch {
      result = { success: false, retryable: true, error: 'Provider request failed' };
    }

    if (!result.success) {
      // SERVER-SIDE ONLY diagnostics — the raw supplier error (name, HTTP
      // status, message) is logged here and must NEVER reach the response.
      this.logProviderFailure(providerName, {
        scope: 'validate-account',
        categoryId: info.categoryId,
        status: (result as { statusCode?: number }).statusCode ?? (result.retryable ? 'transient' : 'rejected'),
        reason: result.error ?? 'unknown provider error'
      });
      if (result.badRequest) {
        // Field set rejected by the supplier (missing/malformed input) —
        // generic retry-your-inputs message; no supplier text.
        return { reason: 'MISSING_FIELDS', error: VERIFICATION_SAFE_ERRORS.MISSING_FIELDS_CHECK };
      }
      // EVERY other supplier failure is a temporary unavailability from the
      // customer's point of view: auth failures, inactive subscriptions,
      // rate limits, 5xx, timeouts, network errors, unexpected responses.
      // Same generic message regardless of which supplier is behind the game.
      return { reason: 'VERIFICATION_UNAVAILABLE', verificationAvailable: false, error: VERIFICATION_SAFE_ERRORS.VERIFICATION_UNAVAILABLE };
    }

    if (result.valid !== true) {
      // CASE 2 — supplier answered definitively: account does not exist.
      return { reason: 'PLAYER_NOT_FOUND', error: VERIFICATION_SAFE_ERRORS.PLAYER_NOT_FOUND };
    }

    // CASE 1 — persist a short-lived, single-use verification record.
    const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MINUTES * 60_000);
    const fieldsHash = hashFields(fields);

    // Any previous still-valid verification for this user+package is superseded.
    await this.prisma.topUpVerification.updateMany({
      where: { userId, packageId, status: 'VALID' },
      data: { status: 'SUPERSEDED' }
    });

    const record = await this.prisma.topUpVerification.create({
      data: {
        userId,
        packageId,
        gameId: pkg.gameId,
        // Persist the provider/service that ACTUALLY validated (override-aware).
        providerId: info.providerId ?? pkg.providerId,
        providerServiceId: info.providerServiceId ?? pkg.providerServiceId,
        categoryId: info.categoryId!,
        fields,
        fieldsHash,
        status: 'VALID',
        playerName: result.playerName ?? null,
        expiresAt
      }
    });

    return {
      valid: true,
      verified: true,
      playerName: result.playerName ?? undefined,
      region: result.region ?? undefined,
      verificationToken: record.id,
      expiresAt: expiresAt.toISOString()
    };
  }

  /**
   * Order-time enforcement. Called while creating a customer top-up order —
   * BEFORE any payment or provider order exists. Throws a customer-safe
   * Error message when the order must not proceed.
   */
  async assertVerifiedForOrder(input: {
    userId: string;
    packageId: string;
    target?: string;
    serverId?: string;
    customFields?: Record<string, string>;
  }, client: PrismaClient | Prisma.TransactionClient = this.prisma, orderId?: string): Promise<void> {
    const info = await this.getVerificationInfo(input.packageId);

    // Not provider-linked → legacy behaviour, no verification applies.
    if (!info.applicable) return;

    if (!info.verificationAvailable) {
      if (info.allowUnverifiedPurchase) return;
      // Catalog unknown → temporary outage wording; known-unsupported →
      // not-supported wording. Either way the purchase is blocked.
      if (info.availabilityKnown === false) {
        throw new Error('Account verification is temporarily unavailable. Please try again later.');
      }
      throw new Error('Player ID verification is not available for this game, and purchases without verification are disabled for it. Please contact support.');
    }

    const requiredKeys = info.fields.map((field) => field.key);
    const expectedFields = TopUpVerificationService.buildFieldsFromOrderInputs(requiredKeys, input);
    const expectedHash = hashFields(expectedFields);
    const now = new Date();

    const match = await client.topUpVerification.findFirst({
      where: {
        userId: input.userId,
        packageId: input.packageId,
        status: 'VALID',
        fieldsHash: expectedHash,
        expiresAt: { gt: now }
      },
      orderBy: { verifiedAt: 'desc' }
    });

    if (!match) {
      throw new Error('Account verification required. Please verify your game account before continuing.');
    }

    // Single-use: bind to this order so the token can never be replayed. The
    // status predicate is essential when two order requests race.
    const consumed = await client.topUpVerification.updateMany({
      where: {
        id: match.id,
        userId: input.userId,
        packageId: input.packageId,
        status: 'VALID',
        expiresAt: { gt: now }
      },
      data: { status: 'CONSUMED', orderId: orderId ?? null }
    });
    if (consumed.count !== 1) {
      throw new Error('Account verification required. Please verify your game account before continuing.');
    }
  }
}
