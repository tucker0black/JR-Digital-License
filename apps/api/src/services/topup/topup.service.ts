import crypto from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { decryptInventoryValue } from '../../utils/encryption.js';
import { TopUpVerificationService } from './verification.service.js';

export interface CreateCustomerTopUpOrderInput {
  packageId: string;
  target?: string;
  serverId?: string;
  customFields?: Record<string, string>;
  idempotencyKey?: string;
}

interface CustomFieldConfig {
  key: string;
  label: string;
  required: boolean;
  placeholder?: string;
}

export interface CreateCustomerTopUpOrderResult {
  success: boolean;
  order?: {
    id: string;
    orderNumber: number;
    status: string;
    currency: string;
    total: string;
    items: Array<{ id: string }>;
  };
  error?: string;
  conflict?: boolean;
}

function canonicalTopUpRequest(input: CreateCustomerTopUpOrderInput, userId: string): string {
  return JSON.stringify({
    userId,
    packageId: input.packageId,
    target: input.target?.trim() ?? null,
    serverId: input.serverId?.trim() ?? null,
    customFields: input.customFields ?? null,
    // A short bucket keeps legacy clients reasonably idempotent without
    // preventing a later intentional purchase of the same package.
    bucket: Math.floor(Date.now() / 30_000)
  });
}

function customerOrderResult(order: {
  id: string;
  orderNumber: number;
  status: string;
  currency: string;
  total: { toString(): string };
  items: Array<{ id: string }>;
}): CreateCustomerTopUpOrderResult['order'] {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    currency: order.currency,
    total: order.total.toString(),
    items: order.items.map((item) => ({ id: item.id }))
  };
}

export interface CreateTopUpOrderResult {
  success: boolean;
  order?: {
    id: string;
    reference: string;
    providerOrderId?: string;
  };
  error?: string;
}

/**
 * Top-Up business service.
 *
 * `createCustomerTopUpOrder` builds a DRAFT order using the authoritative
 * database price of the selected active package. The client never supplies a
 * price, provider, or provider service ID.
 *
 * `createTopUpOrder` (used by fulfillment) submits the paid order to the
 * configured provider exactly once. The idempotency guarantee is two-layered:
 * a TopUpOrder row is created only when no row exists for the order, and the
 * provider call itself carries an idempotency key.
 */
export class TopUpService {
  constructor(private prisma: PrismaClient) {}

  async createCustomerTopUpOrder(
    userId: string,
    input: CreateCustomerTopUpOrderInput
  ): Promise<CreateCustomerTopUpOrderResult> {
    const idempotencyKey = input.idempotencyKey?.trim() ||
      `legacy_${crypto.createHash('sha256').update(canonicalTopUpRequest(input, userId)).digest('hex')}`;

    if (input.idempotencyKey) {
      const existingOrder = await this.prisma.order.findUnique({
        where: { idempotencyKey },
        include: { items: true }
      });
      if (existingOrder) {
        const item = existingOrder.items[0];
        const sameRequest = existingOrder.userId === userId &&
          item?.topUpPackageId === input.packageId &&
          (item.target ?? null) === (input.target?.trim() ?? null) &&
          (item.serverId ?? null) === (input.serverId?.trim() ?? null);
        if (!sameRequest) {
          return { success: false, conflict: true, error: 'This idempotency key is already in use' };
        }
        return { success: true, order: customerOrderResult(existingOrder) };
      }
    }

    const pkg = await this.prisma.topUpPackage.findUnique({
      where: { id: input.packageId },
      include: { provider: true, providerService: true, game: true }
    });

    const gameIsActive = typeof pkg?.game === 'object' && pkg.game !== null
      ? pkg.game.isActive !== false
      : true;
    if (!pkg || !pkg.isActive || !gameIsActive) {
      return { success: false, error: 'Top-up package not found' };
    }

    if (pkg.providerId) {
      if (!pkg.provider) {
        return { success: false, error: 'Top-up provider is not available' };
      }
      if (pkg.provider.status !== 'ACTIVE') {
        return { success: false, error: 'Top-up provider is not available' };
      }
      if (!pkg.providerServiceId) {
        return { success: false, error: 'Top-up package is missing a provider service ID' };
      }
      if (pkg.providerService && pkg.providerService.status && pkg.providerService.status !== 'ACTIVE') {
        return { success: false, error: 'Top-up service is not available' };
      }
      if (!pkg.providerService) {
        return { success: false, error: 'Top-up service is not available' };
      }
      if (!input.target || typeof input.target !== 'string' || input.target.trim().length === 0) {
        return { success: false, error: 'Player ID is required for this package' };
      }
    }

    if (input.target !== undefined && (typeof input.target !== 'string' || input.target.length > 500)) {
      return { success: false, error: 'Invalid player ID' };
    }

    // Customer input configuration is loaded from the database (per game).
    // When no config exists, fall back to the legacy default: player ID is
    // required only for provider-linked packages.
    const gameConfig = await this.prisma.topUpGameConfig.findUnique({
      where: { gameId: pkg.gameId },
      include: {
        verificationProvider: true,
        verificationService: true
      }
    });
    const requirePlayerId = gameConfig ? gameConfig.requirePlayerId : pkg.providerId != null;
    const requireServerId = gameConfig ? gameConfig.requireServerId : false;
    const customFieldsConfig: CustomFieldConfig[] = Array.isArray(gameConfig?.customFields)
      ? (gameConfig.customFields as unknown as CustomFieldConfig[])
      : [];

    if (requirePlayerId && (!input.target || input.target.trim().length === 0)) {
      return { success: false, error: 'Player ID is required for this package' };
    }
    if (requireServerId) {
      if (!input.serverId || input.serverId.trim().length === 0) {
        return { success: false, error: 'Server ID is required for this package' };
      }
      if (input.serverId.length > 100) {
        return { success: false, error: 'Invalid server ID' };
      }
    }

    // Validate numeric fields according to Game Input Config
    if (gameConfig?.playerIdValidation === 'NUMERIC' && input.target && !/^\d+$/.test(input.target.trim())) {
      return { success: false, error: 'Player ID must contain numbers only' };
    }
    if (requireServerId && gameConfig?.serverIdValidation === 'NUMERIC' && input.serverId && !/^\d+$/.test(input.serverId.trim())) {
      return { success: false, error: 'Server ID must contain numbers only' };
    }

    // Server-side account verification: when the game has verification enabled,
    // independently verify the player ID before allowing order creation.
    // This prevents unverified purchases even if the frontend check is bypassed.
    if (gameConfig?.verificationEnabled && input.target) {
      if (gameConfig.verificationProviderId && gameConfig.verificationProvider
          && gameConfig.verificationProvider.status === 'ACTIVE'
          && gameConfig.verificationServiceId && gameConfig.verificationService
          && gameConfig.verificationService.status === 'ACTIVE') {
        let verifyApiKey: string;
        try {
          verifyApiKey = decryptInventoryValue(gameConfig.verificationProvider.encryptedApiKey);
        } catch {
          // If credentials cannot be loaded, reject the order rather than
          // allowing an unverified purchase through.
          return { success: false, error: 'Account verification is temporarily unavailable. Please try again.' };
        }

        const { createTopUpProvider } = await import('./provider-factory.js');
        const verifyProvider = await createTopUpProvider({
          name: gameConfig.verificationProvider.name,
          apiUrl: gameConfig.verificationProvider.apiUrl,
          apiKey: verifyApiKey
        });

        if (!verifyProvider.isAvailable()) {
          return { success: false, error: 'Account verification is temporarily unavailable. Please try again.' };
        }

        let verifyResult;
        try {
          verifyResult = await verifyProvider.verifyAccount({
            serviceId: gameConfig.verificationService.providerServiceId,
            target: input.target.trim(),
            serverId: input.serverId?.trim()
          });
        } catch {
          return { success: false, error: 'Account verification is temporarily unavailable. Please try again.' };
        }

        if (!verifyResult.success) {
          return { success: false, error: 'Player ID not found. Please check your account details and try again.' };
        }
      } else {
        return { success: false, error: 'Account verification is not available for this game.' };
      }
    }

    // Custom fields are only accepted when they are configured by the admin.
    // Provider-declared verification/account fields (e.g. "zone_id") are ALSO
    // accepted automatically — provider metadata is the primary source, so a
    // new game needs no admin reconfiguration to accept its account inputs.
    const allowedCustomKeys = new Set(customFieldsConfig.map((field) => field.key));
    if (pkg.providerId && pkg.providerServiceId) {
      try {
        const { TopUpVerificationService } = await import('./verification.service.js');
        const info = await new TopUpVerificationService(this.prisma).getVerificationInfo(input.packageId);
        for (const field of info.fields) {
          if (field.key !== 'player_id' && field.key !== 'server_id') allowedCustomKeys.add(field.key);
        }
      } catch {
        // Metadata unavailable → fall back to the admin-configured whitelist only.
      }
    }
    const customFieldValues: Record<string, string> = {};
    if (input.customFields !== undefined) {
      if (typeof input.customFields !== 'object' || input.customFields === null) {
        return { success: false, error: 'Invalid custom fields' };
      }
      for (const [key, value] of Object.entries(input.customFields)) {
        if (!allowedCustomKeys.has(key)) {
          return { success: false, error: 'Invalid custom field' };
        }
        if (typeof value !== 'string') {
          return { success: false, error: 'Invalid custom field value' };
        }
        if (value.length > 500) {
          return { success: false, error: 'Invalid custom field value' };
        }
        customFieldValues[key] = value.trim();
      }
    }
    for (const field of customFieldsConfig) {
      const value = customFieldValues[field.key];
      if (field.required && (!value || value.length === 0)) {
        return { success: false, error: `'${field.label}' is required` };
      }
    }

    const verificationService = new TopUpVerificationService(this.prisma);
    const createOrder = async (tx: Prisma.TransactionClient) => {
      // Serialize first-order verification consumption and order creation for
      // this customer. This prevents two concurrent requests from replaying a
      // single VALID verification record.
      if (typeof tx.$queryRaw === 'function') {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
      }

      const order = await tx.order.create({
        data: {
          userId,
          status: 'DRAFT',
          currency: pkg.currency,
          subtotal: pkg.price,
          discount: 0,
          total: pkg.price,
          idempotencyKey,
          items: {
            create: {
              productId: null,
              topUpPackageId: pkg.id,
              productNameSnapshot: `${typeof pkg.game === 'object' && pkg.game ? pkg.game.name : ''} — ${pkg.name}`,
              unitPriceSnapshot: pkg.price,
              quantitySnapshot: 1,
              totalSnapshot: pkg.price,
              currencySnapshot: pkg.currency,
              deliveryTypeSnapshot: 'TOPUP',
              providerServiceIdSnapshot: pkg.providerServiceId ?? null,
              providerIdSnapshot: pkg.providerId ?? null,
              providerServiceExternalIdSnapshot: pkg.providerService?.providerServiceId ?? null,
              providerOfferIdSnapshot: pkg.providerOfferId ?? null,
              providerCostSnapshot: pkg.providerCost ?? null,
              target: input.target?.trim() ?? null,
              serverId: input.serverId?.trim() ?? null,
              customFieldValues: Object.keys(customFieldValues).length > 0 ? customFieldValues : undefined
            }
          }
        },
        include: { items: true }
      });

      // Provider-driven account verification gate. The conditional consume is
      // part of the same transaction as the order insert.
      await verificationService.assertVerifiedForOrder({
        userId,
        packageId: input.packageId,
        target: input.target,
        serverId: input.serverId,
        customFields: Object.keys(customFieldValues).length > 0 ? customFieldValues : undefined
      }, tx, order.id);

      return order;
    };

    let order;
    try {
      const transaction = (this.prisma as PrismaClient & {
        $transaction?: <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, options?: unknown) => Promise<T>;
      }).$transaction;
      order = transaction
        ? await transaction(createOrder, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
        : await createOrder(this.prisma as unknown as Prisma.TransactionClient);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existingOrder = await this.prisma.order.findUnique({
          where: { idempotencyKey },
          include: { items: true }
        });
        if (existingOrder?.userId === userId) {
          return { success: true, order: customerOrderResult(existingOrder) };
        }
        return { success: false, conflict: true, error: 'This idempotency key is already in use' };
      }
      return { success: false, error: error instanceof Error ? error.message : 'Failed to create top-up order' };
    }

    return { success: true, order: customerOrderResult(order) };
  }

  async createTopUpOrder(
    userId: string,
    orderId: string,
    idempotencyKey?: string
  ): Promise<CreateTopUpOrderResult> {
    const idempotency = idempotencyKey ?? `topup_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

    const existingByOrder = await this.prisma.topUpOrder.findFirst({
      where: { orderId }
    });

    if (existingByOrder) {
      // Already submitted to the provider — never submit the same order twice.
      // Re-reading the stored provider reference keeps retries idempotent.
      return {
        success: true,
        order: {
          id: existingByOrder.id,
          reference: existingByOrder.id,
          providerOrderId: existingByOrder.providerOrderId ?? undefined
        }
      };
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            topUpPackage: {
              include: {
                provider: true,
                providerService: true
              }
            }
          }
        }
      }
    });

    if (!order) {
      return { success: false, error: 'Order not found' };
    }

    if (order.userId !== userId) {
      return { success: false, error: 'Order does not belong to user' };
    }

    const fulfillable = ['PAID', 'COMPLETED', 'PROCESSING', 'FULFILLING'];
    if (!fulfillable.includes(order.status)) {
      return { success: false, error: 'Order must be paid before creating top-up order' };
    }

    const topUpItem = order.items.find((item) => item.deliveryTypeSnapshot === 'TOPUP');
    if (!topUpItem) {
      return { success: false, error: 'No top-up item found in order' };
    }

    const pkg = topUpItem.topUpPackage;
    if (!pkg) {
      return { success: false, error: 'Top-up package not found' };
    }

    if (!pkg.providerId || !pkg.provider) {
      return { success: false, error: 'Top-up package has no provider configured' };
    }

    if (pkg.provider.status !== 'ACTIVE') {
      return { success: false, error: 'Top-up provider is disabled' };
    }

    let apiKey: string;
    try {
      apiKey = decryptInventoryValue(pkg.provider.encryptedApiKey);
    } catch {
      return { success: false, error: 'Failed to load top-up provider credentials' };
    }

    const { createTopUpProvider } = await import('./provider-factory.js');
    const providerInstance = await createTopUpProvider({
      name: pkg.provider.name,
      apiUrl: pkg.provider.apiUrl,
      apiKey
    });

    if (!providerInstance.isAvailable()) {
      return { success: false, error: 'Top-up provider is not configured' };
    }

    // The provider must receive its OWN external identifiers — never our
    // internal database UUIDs. pkg.providerServiceId is the internal
    // TopUpProviderService row; the external FazerCards category id lives on
    // the related service record, and the external offer id on the package.
    const externalServiceId = pkg.providerService?.providerServiceId ?? null;
    if (!externalServiceId) {
      return {
        success: false,
        error: 'FazerCards service unavailable. Existing database configuration preserved. Link this package\'s game to a valid provider service before retrying.'
      };
    }

    if (!pkg.providerOfferId) {
      return {
        success: false,
        error: 'FazerCards offer unavailable. Existing package preserved. Link the package to a provider offer (Admin → Top Up → Packages) before retrying.'
      };
    }

    // Custom game fields flow into the provider `fields` object; player/server
    // IDs are mapped by the adapter to their canonical keys.
    const customerFields: Record<string, string> = {};
    for (const [key, value] of Object.entries((topUpItem.customFieldValues as Record<string, string> | null | undefined) ?? {})) {
      if (typeof value === 'string' && value.length > 0) customerFields[key] = value;
    }

    // The order payload must contain exactly the keys this category's offers
    // declare (e.g. server_id vs zone_id differences between endpoints).
    // Verification-only extras must not leak into the supplier payload.
    let offerFieldKeys: Set<string> | null = null;
    try {
      const keys = await providerInstance.getOfferFieldKeys?.(externalServiceId);
      if (keys) offerFieldKeys = new Set(keys);
    } catch {
      // Metadata hiccup: fall back to sending the assembled fields as-is.
    }
    const filteredCustomerFields =
      offerFieldKeys
        ? Object.fromEntries(Object.entries(customerFields).filter(([key]) => offerFieldKeys!.has(key)))
        : customerFields;

    const createParams = {
      orderId,
      serviceId: externalServiceId,
      offerId: pkg.providerOfferId,
      target: topUpItem.target ?? '',
      serverId: topUpItem.serverId ?? undefined,
      customerFields: filteredCustomerFields,
      quantity: topUpItem.quantitySnapshot,
      reference: `topup_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      idempotencyKey: idempotency
    };

    const providerResult = await providerInstance.createOrder(createParams);

    if (!providerResult.success) {
      return { success: false, error: providerResult.error || 'Failed to create top-up order with provider' };
    }

    const topUpOrder = await this.prisma.topUpOrder.create({
      data: {
        orderId,
        topUpPackageId: pkg.id,
        providerId: pkg.provider.id,
        providerOrderId: providerResult.providerOrderId ?? null,
        target: topUpItem.target ?? '',
        serverId: topUpItem.serverId ?? undefined,
        customFieldValues: topUpItem.customFieldValues ?? undefined,
        quantity: topUpItem.quantitySnapshot,
        status: 'PENDING'
      }
    });

    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'PROCESSING' }
    });

    return {
      success: true,
      order: {
        id: topUpOrder.id,
        reference: topUpOrder.id,
        providerOrderId: topUpOrder.providerOrderId ?? undefined
      }
    };
  }
}
