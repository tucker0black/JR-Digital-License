import { Prisma } from '@prisma/client';
import type { PrismaClient, TopUpProviderStatus, TopUpProviderServiceStatus } from '@prisma/client';
import { encryptInventoryValue, decryptInventoryValue } from '../../utils/encryption.js';
import type { FazerCardsTopUpProvider } from '../topup/fazercards-provider.js';
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const catalogCache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = catalogCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    catalogCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T): void {
  catalogCache.set(key, { data, expiresAt: Date.now() + CATALOG_CACHE_TTL_MS });
}

export interface CreateTopUpProviderServiceInput {
  providerId: string;
  providerServiceId: string;
  name: string;
  status?: TopUpProviderServiceStatus;
}

export interface UpdateTopUpProviderServiceInput {
  providerServiceId?: string;
  name?: string;
  status?: TopUpProviderServiceStatus;
}

export interface TopUpProviderServiceFilters {
  providerId?: string;
  search?: string;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
}

export interface CreateTopUpGameInput {
  name: string;
  imageUrl?: string | null;
  providerId?: string | null;
  providerServiceId?: string;
  isActive?: boolean;
  sortOrder?: number;
}

export interface UpdateTopUpGameInput {
  name?: string;
  imageUrl?: string | null;
  providerId?: string | null;
  providerServiceId?: string;
  isActive?: boolean;
  sortOrder?: number;
}

export interface TopUpGameFilters {
  search?: string;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
}

export interface CreateTopUpPackageInput {
  gameId: string;
  name: string;
  /** Legacy numeric field retained for existing callers and records. */
  diamondAmount?: number;
  /** Generic customer-facing content, e.g. "60 UC" or "Prime (1 Month)". */
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
}

export interface UpdateTopUpPackageInput {
  gameId?: string;
  name?: string;
  diamondAmount?: number;
  content?: string | null;
  price?: string;
  currency?: string;
  providerId?: string | null;
  providerCost?: string | number | null;
  providerOfferId?: string | null;
  isActive?: boolean;
  sortOrder?: number;
  icon?: string | null;
  imageUrl?: string | null;
  customerNote?: string | null;
  noteColor?: 'WARNING' | 'INFO' | 'SUCCESS' | 'DANGER' | 'PURPLE';
}

export interface TopUpPackageFilters {
  search?: string;
  gameId?: string;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
}

export interface CreateTopUpProviderInput {
  name: string;
  apiUrl: string;
  apiKey: string;
  status?: TopUpProviderStatus;
}

export interface UpdateTopUpProviderInput {
  name?: string;
  apiUrl?: string;
  apiKey?: string;
  status?: TopUpProviderStatus;
}

export class AdminTopUpService {
  constructor(private prisma: PrismaClient) {}

  // ==================== PROVIDERS ====================

  // Providers are never returned with API key material, encrypted or otherwise.

  async getProviders() {
    const providers = await this.prisma.topUpProvider.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { packages: true } } }
    });

    return {
      providers: providers.map((provider) => ({
        id: provider.id,
        name: provider.name,
        apiUrl: provider.apiUrl,
        status: provider.status,
        packageCount: provider._count.packages,
        createdAt: provider.createdAt,
        updatedAt: provider.updatedAt
      }))
    };
  }

  async createProvider(input: CreateTopUpProviderInput, adminId: string) {
    const name = input.name.trim();
    const apiUrl = input.apiUrl.trim();
    const apiKey = input.apiKey;

    if (!name) throw new Error('Provider name is required');
    if (!apiUrl) throw new Error('API URL is required');
    if (!apiKey) throw new Error('API key is required');

    const existing = await this.prisma.topUpProvider.findUnique({ where: { name } });
    if (existing) {
      throw new Error('A top-up provider with this name already exists');
    }

    return this.prisma.$transaction(async (tx) => {
      const provider = await tx.topUpProvider.create({
        data: {
          name,
          apiUrl,
          encryptedApiKey: encryptInventoryValue(apiKey),
          status: input.status ?? 'ACTIVE'
        }
      });

      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'TopUpProvider',
          entityId: provider.id,
          action: 'CREATE',
          newValue: {
            name: provider.name,
            apiUrl: provider.apiUrl,
            status: provider.status
          }
        }
      });

      return serializeProvider(provider, 0);
    });
  }

  async updateProvider(id: string, input: UpdateTopUpProviderInput, adminId: string) {
    const existing = await this.prisma.topUpProvider.findUnique({
      where: { id },
      include: { _count: { select: { packages: true } } }
    });

    if (!existing) {
      throw new Error('Top-up provider not found');
    }

    if (input.name && input.name.trim() !== existing.name) {
      const nameTaken = await this.prisma.topUpProvider.findUnique({
        where: { name: input.name.trim() }
      });
      if (nameTaken) {
        throw new Error('A top-up provider with this name already exists');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const provider = await tx.topUpProvider.update({
        where: { id },
        data: {
          name: input.name?.trim() || undefined,
          apiUrl: input.apiUrl?.trim() || undefined,
          encryptedApiKey: input.apiKey ? encryptInventoryValue(input.apiKey) : undefined,
          status: input.status
        }
      });

      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'TopUpProvider',
          entityId: id,
          action: 'UPDATE',
          oldValue: {
            name: existing.name,
            apiUrl: existing.apiUrl,
            status: existing.status
          },
          newValue: {
            name: provider.name,
            apiUrl: provider.apiUrl,
            status: provider.status,
            apiKeyChanged: input.apiKey !== undefined
          }
        }
      });

      return serializeProvider(provider, existing._count.packages);
    });
  }

  async setProviderStatus(id: string, status: TopUpProviderStatus, adminId: string) {
    const existing = await this.prisma.topUpProvider.findUnique({
      where: { id },
      include: { _count: { select: { packages: true } } }
    });

    if (!existing) {
      throw new Error('Top-up provider not found');
    }

    if (existing.status === status) {
      throw new Error(`Provider is already ${status}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const provider = await tx.topUpProvider.update({
        where: { id },
        data: { status }
      });

      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'TopUpProvider',
          entityId: id,
          action: 'STATUS_CHANGED',
          oldValue: { status: existing.status },
          newValue: { status }
        }
      });

      return serializeProvider(provider, existing._count.packages);
    });
  }

  async deleteProvider(id: string, adminId: string) {
    const existing = await this.prisma.topUpProvider.findUnique({
      where: { id },
      include: { _count: { select: { packages: true } } }
    });

    if (!existing) {
      throw new Error('Top-up provider not found');
    }

    if (existing._count.packages > 0) {
      throw new Error('Cannot delete a provider that still has linked packages');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.topUpProvider.delete({ where: { id } });

      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'TopUpProvider',
          entityId: id,
          action: 'DELETE',
          oldValue: { name: existing.name, apiUrl: existing.apiUrl, status: existing.status }
        }
      });
    });

    return { success: true };
  }

  // ==================== PROVIDER SERVICES ====================

  async getProviderServices(filters: TopUpProviderServiceFilters = {}) {
    const { providerId, search, isActive, page = 1, pageSize = 50 } = filters;

    const pageNum = Math.max(1, page);
    const pageSizeNum = Math.min(100, Math.max(1, pageSize));
    const skip = (pageNum - 1) * pageSizeNum;

    const where: Record<string, unknown> = {};
    if (providerId) where.providerId = providerId;
    if (isActive !== undefined) where.status = isActive ? 'ACTIVE' : 'DISABLED';
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { providerServiceId: { contains: search, mode: 'insensitive' } }
      ];
    }

    const [services, total] = await Promise.all([
      this.prisma.topUpProviderService.findMany({
        where,
        include: {
          provider: { select: { id: true, name: true, status: true } },
          _count: { select: { games: true, packages: true } }
        },
        orderBy: [{ provider: { name: 'asc' } }, { name: 'asc' }],
        skip,
        take: pageSizeNum
      }),
      this.prisma.topUpProviderService.count({ where })
    ]);

    return {
      services: services.map((s) => serializeProviderService(s)),
      total,
      page: pageNum,
      pageSize: pageSizeNum
    };
  }

  async createProviderService(input: CreateTopUpProviderServiceInput, adminId: string) {
    const provider = await this.prisma.topUpProvider.findUnique({ where: { id: input.providerId } });
    if (!provider) throw new Error('Top-up provider not found');

    const providerServiceId = input.providerServiceId.trim();
    const name = input.name.trim();
    if (!providerServiceId) throw new Error('Provider service ID is required');
    if (!name) throw new Error('Service name is required');

    const existing = await this.prisma.topUpProviderService.findUnique({
      where: { providerId_providerServiceId: { providerId: input.providerId, providerServiceId } }
    });
    if (existing) {
      throw new Error(`This ${provider.name} service already exists.`);
    }

    return this.prisma.$transaction(async (tx) => {
      const service = await tx.topUpProviderService.create({
        data: {
          providerId: input.providerId,
          providerServiceId,
          name,
          status: input.status ?? 'ACTIVE'
        },
        include: {
          provider: { select: { id: true, name: true, status: true } },
          _count: { select: { games: true, packages: true } }
        }
      });

      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'TopUpProviderService',
          entityId: service.id,
          action: 'CREATE',
          newValue: {
            providerId: service.providerId,
            providerServiceId: service.providerServiceId,
            name: service.name,
            status: service.status
          }
        }
      });

      return serializeProviderService(service);
    });
  }

  async updateProviderService(id: string, input: UpdateTopUpProviderServiceInput, adminId: string) {
    const existing = await this.prisma.topUpProviderService.findUnique({
      where: { id },
      include: { _count: { select: { games: true, packages: true } } }
    });

    if (!existing) {
      throw new Error('Top-up provider service not found');
    }

    if (input.providerServiceId && input.providerServiceId.trim() !== existing.providerServiceId) {
      const idTaken = await this.prisma.topUpProviderService.findUnique({
        where: { providerId_providerServiceId: { providerId: existing.providerId, providerServiceId: input.providerServiceId.trim() } }
      });
      if (idTaken) {
        throw new Error('A provider service with this ID already exists for this provider');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const service = await tx.topUpProviderService.update({
        where: { id },
        data: {
          providerServiceId: input.providerServiceId?.trim() || undefined,
          name: input.name?.trim() || undefined,
          status: input.status
        },
        include: {
          provider: { select: { id: true, name: true, status: true } },
          _count: { select: { games: true, packages: true } }
        }
      });

      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'TopUpProviderService',
          entityId: id,
          action: 'UPDATE',
          oldValue: {
            providerServiceId: existing.providerServiceId,
            name: existing.name,
            status: existing.status
          },
          newValue: {
            providerServiceId: service.providerServiceId,
            name: service.name,
            status: service.status
          }
        }
      });

      return serializeProviderService(service);
    });
  }

  async setProviderServiceStatus(id: string, status: TopUpProviderServiceStatus, adminId: string) {
    const existing = await this.prisma.topUpProviderService.findUnique({
      where: { id },
      include: { _count: { select: { games: true, packages: true } } }
    });

    if (!existing) {
      throw new Error('Top-up provider service not found');
    }

    if (existing.status === status) {
      throw new Error(`Provider service is already ${status}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const service = await tx.topUpProviderService.update({
        where: { id },
        data: { status }
      });

      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'TopUpProviderService',
          entityId: id,
          action: 'STATUS_CHANGED',
          oldValue: { status: existing.status },
          newValue: { status }
        }
      });

      return serializeProviderService(service);
    });
  }

  async deleteProviderService(id: string, adminId: string) {
    const existing = await this.prisma.topUpProviderService.findUnique({
      where: { id },
      include: { _count: { select: { games: true, packages: true } } }
    });

    if (!existing) {
      throw new Error('Top-up provider service not found');
    }

    if (existing._count.games > 0 || existing._count.packages > 0) {
      throw new Error('Cannot delete a provider service that still has linked games or packages');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.topUpProviderService.delete({ where: { id } });

      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'TopUpProviderService',
          entityId: id,
          action: 'DELETE',
          oldValue: { providerId: existing.providerId, providerServiceId: existing.providerServiceId, name: existing.name }
        }
      });
    });

    return { success: true };
  }

  async testProviderConnection(id: string): Promise<{ success: boolean; error?: string; balance?: number; currency?: string }> {
    const provider = await this.prisma.topUpProvider.findUnique({ where: { id } });

    if (!provider) {
      throw new Error('Top-up provider not found');
    }

    let apiKey: string;
    try {
      apiKey = decryptInventoryValue(provider.encryptedApiKey);
    } catch {
      return { success: false, error: 'Failed to decrypt provider API key' };
    }

    const { createTopUpProvider } = await import('../topup/provider-factory.js');
    const instance = await createTopUpProvider({ name: provider.name, apiUrl: provider.apiUrl, apiKey });

    if (!instance.isAvailable()) {
      return { success: false, error: 'Top-up provider is not configured' };
    }

    return instance.testConnection();
  }

  /**
   * Live provider catalog fetch (admin only). Read-only against the database.
   *
   * Returns the real remote categories plus a `warnings` list describing
   * stored services whose external IDs are NOT present in the live catalog.
   * Stored configuration is never mutated by this method Ã¢â‚¬â€ a missing remote
   * entry is surfaced as a warning so the admin can decide what to do.
   */
  async fetchRemoteCategories(providerId: string): Promise<{
    categories: Array<{ category_id: string; name: string; note: string | null; region: string | null }>;
    total: number;
    warnings: Array<{ id: string; name: string; providerServiceId: string }>;
  }> {
    const cacheKey = `categories:${providerId}`;
    const cached = getCached<{
      categories: Array<{ category_id: string; name: string; note: string | null; region: string | null }>;
      total: number;
      warnings: Array<{ id: string; name: string; providerServiceId: string }>;
    }>(cacheKey);
    if (cached) return cached;

    const provider = await this.prisma.topUpProvider.findUnique({
      where: { id: providerId },
      include: { services: { select: { id: true, name: true, providerServiceId: true } } }
    });
    if (!provider) throw new Error('Top-up provider not found');

    let apiKey: string;
    try {
      apiKey = decryptInventoryValue(provider.encryptedApiKey);
    } catch {
      throw new Error('Failed to decrypt provider API key');
    }

    const { createTopUpProvider } = await import('../topup/provider-factory.js');
    const instance = await createTopUpProvider({ name: provider.name, apiUrl: provider.apiUrl, apiKey }) as unknown as FazerCardsTopUpProvider;
    if (!instance.isAvailable()) throw new Error('Top-up provider is not configured');

    let result;
    try {
      result = await instance.getCategories();
    } catch {
      throw new Error(`${provider.name} API request failed. Existing configuration was preserved.`);
    }
    if (!result.success) {
      throw new Error(`${provider.name} API request failed. Existing configuration was preserved. ${result.error ?? ''}`.trim());
    }

    const categories: Array<{ category_id: string; name: string; note: string | null; region: string | null }> =
      (result.categories ?? []).map((category) => ({
        category_id: category.category_id,
        name: category.name,
        note: category.note ?? null,
        region: category.region ?? null
      }));
    const remoteIds = new Set(categories.map((category) => category.category_id));

    // Stored services whose external IDs vanished from the live account are
    // reported as unavailable Ã¢â‚¬â€ never deleted, disabled or rewritten.
    const warnings = provider.services
      .filter((service) => !remoteIds.has(service.providerServiceId))
      .map((service) => ({ id: service.id, name: service.name, providerServiceId: service.providerServiceId }));

    const data = { categories, total: result.total ?? categories.length, warnings };
    setCache(cacheKey, data);
    return data;
  }

  /**
   * Live offers fetch for one provider service (admin only).
   *
   * Accepts EITHER the internal TopUpProviderService UUID (as referenced by
   * games/packages) OR the raw external FazerCards category id. The internal
   * reference is resolved to the external ID before calling the provider Ã¢â‚¬â€
   * internal UUIDs must never be sent to the provider.
   */
  async fetchRemoteOffers(providerId: string, categoryIdOrInternalId: string): Promise<{
    offers: Array<{ offer_id: string; offer_name: string; price_usd: number }>;
    fields: Array<{ key: string; label: string; type?: string }>;
    note: string | null;
    categoryName: string | null;
    externalCategoryId: string;
  }> {
    const provider = await this.prisma.topUpProvider.findUnique({ where: { id: providerId } });
    if (!provider) throw new Error('Top-up provider not found');

    // Resolve an internal service row to its EXTERNAL provider category id.
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(categoryIdOrInternalId);
    let externalCategoryId = categoryIdOrInternalId;

    if (isUuid) {
      const serviceRow = await this.prisma.topUpProviderService.findFirst({
        where: { id: categoryIdOrInternalId, providerId },
        select: { providerServiceId: true }
      });
      if (!serviceRow) {
        throw new Error('FazerCards service unavailable. Existing database configuration preserved.');
      }
      externalCategoryId = serviceRow.providerServiceId;
    }

    const cacheKey = `offers:${providerId}:${externalCategoryId}`;
    const cached = getCached<{
      offers: Array<{ offer_id: string; offer_name: string; price_usd: number }>;
      fields: Array<{ key: string; label: string; type?: string }>;
      note: string | null;
      categoryName: string | null;
      externalCategoryId: string;
    }>(cacheKey);
    if (cached) return cached;

    let apiKey: string;
    try {
      apiKey = decryptInventoryValue(provider.encryptedApiKey);
    } catch {
      throw new Error('Failed to decrypt provider API key');
    }

    const { createTopUpProvider } = await import('../topup/provider-factory.js');
    const instance = await createTopUpProvider({ name: provider.name, apiUrl: provider.apiUrl, apiKey }) as unknown as FazerCardsTopUpProvider;
    if (!instance.isAvailable()) throw new Error('Top-up provider is not configured');

    let result;
    try {
      result = await instance.getOffers(externalCategoryId);
    } catch {
      throw new Error(`FazerCards service unavailable. Existing database configuration preserved.`);
    }
    if (!result.success || !result.payload) {
      throw new Error(`FazerCards service unavailable. Existing database configuration preserved. ${result.error ?? ''}`.trim());
    }

    const data = {
      offers: result.payload.offers,
      fields: result.payload.fields,
      note: result.payload.note ?? null,
      categoryName: result.payload.categoryName ?? null,
      externalCategoryId
    };
    setCache(cacheKey, data);
    return data;
  }

  /**
   * Admin view of the live Player-ID validation support catalog
   * (GET /topups/validate-id). Read-only; shows which categories currently
   * support verification and which fields they require. Never mutates data.
   */
  async fetchValidationSupport(providerId: string): Promise<{
    providerId: string;
    categories: Array<{ categoryId: string; name: string; fields: Array<{ key: string; label: string; type?: string }> }>;
    total: number;
  }> {
    const provider = await this.prisma.topUpProvider.findUnique({ where: { id: providerId } });
    if (!provider) throw new Error('Top-up provider not found');

    let apiKey: string;
    try {
      apiKey = decryptInventoryValue(provider.encryptedApiKey);
    } catch {
      throw new Error('Failed to decrypt provider API key');
    }

    const { createTopUpProvider } = await import('../topup/provider-factory.js');
    const instance = await createTopUpProvider({ name: provider.name, apiUrl: provider.apiUrl, apiKey });
    if (!instance.getValidationSupport) return { providerId, categories: [], total: 0 };

    const result = await instance.getValidationSupport();
    if (!result.success) {
      throw new Error(`${provider.name} API request failed. Existing configuration was preserved. ${result.error ?? ''}`.trim());
    }

    const categories = result.categories ?? [];
    return { providerId, categories, total: categories.length };
  }

  /**
   * Link an existing package to an EXTERNAL provider offer and snapshot the
   * provider cost. Selling price, name, status and schedule are NEVER touched
   * by this method — that remains an explicit admin action.
   */
  async linkPackageOffer(
    id: string,
    input: { providerOfferId?: string | null; providerCost?: string | number | null },
    adminId: string
  ) {
    const existing = await this.prisma.topUpPackage.findUnique({ where: { id } });
    if (!existing) throw new Error('Top-up package not found');

    const data: Record<string, unknown> = {};
    if (input.providerOfferId !== undefined) {
      const offerId = input.providerOfferId?.trim() ?? '';
      data.providerOfferId = offerId || null;
    }
    if (input.providerCost !== undefined) {
      data.providerCost = this.validateProviderCost(input.providerCost);
    }

    if (Object.keys(data).length === 0) {
      throw new Error('Nothing to link: provide an offer ID or provider cost');
    }

    return this.prisma.$transaction(async (tx) => {
      const pkg = await tx.topUpPackage.update({
        where: { id },
        data,
        include: {
          game: { select: { id: true, name: true, providerId: true, providerServiceId: true } },
          provider: { select: { id: true, name: true, status: true } }
        }
      });

      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'TopUpPackage',
          entityId: pkg.id,
          action: 'PROVIDER_OFFER_LINKED',
          oldValue: {
            providerOfferId: existing.providerOfferId,
            providerCost: existing.providerCost?.toString() ?? null,
            price: existing.price.toString()
          },
          newValue: {
            providerOfferId: pkg.providerOfferId,
            providerCost: pkg.providerCost?.toString() ?? null,
            price: pkg.price.toString()
          }
        }
      });

      return serializePackage(pkg);
    });
  }

  // ==================== GAMES ====================

  async getGames(filters: TopUpGameFilters = {}) {
    const { search, isActive, page = 1, pageSize = 50 } = filters;

    const pageNum = Math.max(1, page);
    const pageSizeNum = Math.min(100, Math.max(1, pageSize));
    const skip = (pageNum - 1) * pageSizeNum;

    const where: Record<string, unknown> = {};
    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    const [games, total] = await Promise.all([
      this.prisma.topUpGame.findMany({
        where,
        include: {
          provider: { select: { id: true, name: true, status: true } },
          _count: { select: { packages: true } }
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        skip,
        take: pageSizeNum
      }),
      this.prisma.topUpGame.count({ where })
    ]);

    return {
      games: games.map((g) => serializeGame(g)),
      total,
      page: pageNum,
      pageSize: pageSizeNum
    };
  }

  async getGameById(id: string) {
    const game = await this.prisma.topUpGame.findUnique({
      where: { id },
      include: {
        provider: { select: { id: true, name: true, status: true } },
        gameConfig: true,
        _count: { select: { packages: true } }
      }
    });

    if (!game) return null;

    return {
      ...serializeGame(game),
gameConfig: game.gameConfig ? serializeGameConfig({
        ...game.gameConfig,
        gameId: game.id,
        createdAt: game.gameConfig.createdAt ?? new Date(),
        updatedAt: game.gameConfig.updatedAt ?? new Date()
      }) : null
    };
  }

  async createGame(input: CreateTopUpGameInput, adminId: string) {
    const name = input.name.trim();
    if (!name) throw new Error('Game name is required');

    const existing = await this.prisma.topUpGame.findUnique({ where: { name } });
    if (existing) {
      throw new Error('A top-up game with this name already exists');
    }

    if (input.providerId) {
      const provider = await this.prisma.topUpProvider.findUnique({ where: { id: input.providerId } });
      if (!provider) {
        throw new Error('Top-up provider not found');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const game = await tx.topUpGame.create({
        data: {
          name,
          imageUrl: input.imageUrl?.trim() || null,
          providerId: input.providerId ?? null,
          providerServiceId: input.providerId ? (input.providerServiceId?.trim() ?? null) : null,
          isActive: input.isActive !== false,
          sortOrder: input.sortOrder || 0
        },
        include: {
          provider: { select: { id: true, name: true, status: true } },
          _count: { select: { packages: true } }
        }
      });

      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'TopUpGame',
          entityId: game.id,
          action: 'CREATE',
          newValue: {
            name: game.name,
            imageUrl: game.imageUrl,
            providerId: game.providerId,
            providerServiceId: game.providerServiceId,
            isActive: game.isActive,
            sortOrder: game.sortOrder
          }
        }
      });

      return serializeGame(game);
    });
  }

  async updateGame(id: string, input: UpdateTopUpGameInput, adminId: string) {
    const existing = await this.prisma.topUpGame.findUnique({
      where: { id },
      include: { _count: { select: { packages: true } } }
    });

    if (!existing) {
      throw new Error('Top-up game not found');
    }

    if (input.name && input.name.trim() !== existing.name) {
      const nameTaken = await this.prisma.topUpGame.findUnique({
        where: { name: input.name.trim() }
      });
      if (nameTaken) {
        throw new Error('A top-up game with this name already exists');
      }
    }

    if (input.providerId !== undefined) {
      if (input.providerId) {
        const provider = await this.prisma.topUpProvider.findUnique({ where: { id: input.providerId } });
        if (!provider) {
          throw new Error('Top-up provider not found');
        }
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const game = await tx.topUpGame.update({
        where: { id },
        data: {
          name: input.name?.trim() || undefined,
          imageUrl: input.imageUrl !== undefined ? (input.imageUrl?.trim() || null) : undefined,
          providerId: input.providerId !== undefined ? (input.providerId ?? null) : undefined,
          providerServiceId: input.providerId !== undefined
            ? (input.providerId ? (input.providerServiceId?.trim() ?? null) : null)
            : input.providerServiceId !== undefined
              ? (input.providerServiceId?.trim() ?? null)
              : undefined,
          isActive: input.isActive,
          sortOrder: input.sortOrder
        },
        include: {
          provider: { select: { id: true, name: true, status: true } },
          _count: { select: { packages: true } }
        }
      });

      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'TopUpGame',
          entityId: id,
          action: 'UPDATE',
          oldValue: {
            name: existing.name,
            imageUrl: existing.imageUrl,
            providerId: existing.providerId,
            providerServiceId: existing.providerServiceId,
            isActive: existing.isActive,
            sortOrder: existing.sortOrder
          },
          newValue: {
            name: game.name,
            imageUrl: game.imageUrl,
            providerId: game.providerId,
            providerServiceId: game.providerServiceId,
            isActive: game.isActive,
            sortOrder: game.sortOrder
          }
        }
      });

      return serializeGame(game);
    });
  }

  async setGameStatus(id: string, isActive: boolean, adminId: string) {
    const existing = await this.prisma.topUpGame.findUnique({
      where: { id },
      include: { _count: { select: { packages: true } } }
    });

    if (!existing) {
      throw new Error('Top-up game not found');
    }

    if (existing.isActive === isActive) {
      throw new Error(`Game is already ${isActive ? 'ACTIVE' : 'DISABLED'}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const game = await tx.topUpGame.update({
        where: { id },
        data: { isActive }
      });

      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'TopUpGame',
          entityId: id,
          action: isActive ? 'ENABLE' : 'DISABLE',
          oldValue: { isActive: existing.isActive },
          newValue: { isActive }
        }
      });

      return serializeGame(game);
    });
  }

  async deleteGame(id: string, adminId: string) {
    const existing = await this.prisma.topUpGame.findUnique({
      where: { id },
      include: { _count: { select: { packages: true } } }
    });

    if (!existing) {
      throw new Error('Top-up game not found');
    }

    if (existing._count.packages > 0) {
      throw new Error('Cannot delete a game that still has packages');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.topUpGameConfig.delete({ where: { gameId: id } });
      await tx.topUpGame.delete({ where: { id } });

      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'TopUpGame',
          entityId: id,
          action: 'DELETE',
          oldValue: { name: existing.name }
        }
      });
    });

    return { success: true };
  }

  // ==================== PACKAGES ====================

  async getPackages(filters: TopUpPackageFilters = {}) {
    const { search, gameId, isActive, page = 1, pageSize = 50 } = filters;

    const pageNum = Math.max(1, page);
    const pageSizeNum = Math.min(100, Math.max(1, pageSize));
    const skip = (pageNum - 1) * pageSizeNum;

    const where: Record<string, unknown> = {};
    if (gameId) where.gameId = gameId;
    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { game: { name: { contains: search, mode: 'insensitive' } } }
      ];
    }

    const [packages, total] = await Promise.all([
      this.prisma.topUpPackage.findMany({
        where,
        include: {
          game: { select: { id: true, name: true, providerId: true, providerServiceId: true } },
          provider: { select: { id: true, name: true, status: true } }
        },
        orderBy: [{ game: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
        skip,
        take: pageSizeNum
      }),
      this.prisma.topUpPackage.count({ where })
    ]);

    return {
      packages: packages.map((p) => serializePackage(p)),
      total,
      page: pageNum,
      pageSize: pageSizeNum
    };
  }

  async getGamesList(): Promise<string[]> {
    const games = await this.prisma.topUpGame.findMany({
      distinct: ['name'],
      select: { name: true },
      orderBy: { name: 'asc' }
    });
    return games.map((g) => g.name);
  }

  async createPackage(input: CreateTopUpPackageInput, adminId: string) {
    const game = await this.prisma.topUpGame.findUnique({ where: { id: input.gameId } });
    if (!game) throw new Error('Top-up game not found');

    const name = input.name.trim();
    if (!name) throw new Error('Package name is required');
    const content = normalizePackageContent(input.content);
    const diamondAmount = input.diamondAmount ?? parseLegacyDiamondAmount(content);
    if (!Number.isInteger(diamondAmount) || diamondAmount < 0) {
      throw new Error('Diamond amount must be a non-negative integer');
    }
    const price = parseFloat(input.price);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error('Price must be a positive number');
    }

    if (game.providerId && !input.providerCost) {
      // Provider cost is optional, but we can warn or require it
    }
    if (game.providerId && !game.providerServiceId) {
      throw new Error('Provider service ID is required for this game');
    }
    const providerCost = this.validateProviderCost(input.providerCost);

    return this.prisma.$transaction(async (tx) => {
      const pkg = await tx.topUpPackage.create({
        data: {
          gameId: input.gameId,
          name,
          diamondAmount,
          content,
          price,
          currency: input.currency?.trim().toUpperCase() || 'USD',
          providerId: game.providerId ?? null,
          providerServiceId: game.providerId ? (game.providerServiceId ?? null) : null,
          providerOfferId: game.providerId ? (input.providerOfferId?.trim() || null) : null,
          providerCost: game.providerId ? providerCost : null,
          isActive: input.isActive !== false,
          sortOrder: input.sortOrder || 0,
          icon: input.icon?.trim() || null,
          imageUrl: input.imageUrl?.trim() || null,
          customerNote: input.customerNote?.trim() || null,
          noteColor: input.noteColor || 'WARNING'
        },
        include: {
          game: { select: { id: true, name: true, providerId: true, providerServiceId: true } },
          provider: { select: { id: true, name: true, status: true } }
        }
      });

      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'TopUpPackage',
          entityId: pkg.id,
          action: 'CREATE',
          newValue: {
            gameId: pkg.gameId,
            name: pkg.name,
            diamondAmount: pkg.diamondAmount,
            content: pkg.content,
            price: pkg.price.toString(),
            providerId: pkg.providerId,
            providerServiceId: pkg.providerServiceId,
            providerCost: pkg.providerCost?.toString() ?? null
          }
        }
      });

      return serializePackage(pkg);
    });
  }

  async updatePackage(id: string, input: UpdateTopUpPackageInput, adminId: string) {
    const existing = await this.prisma.topUpPackage.findUnique({
      where: { id },
      include: {
        game: { select: { id: true, name: true, providerId: true, providerServiceId: true } },
        provider: { select: { id: true, name: true, status: true } }
      }
    });
    if (!existing) throw new Error('Top-up package not found');

    const data: Record<string, unknown> = {};
    if (input.providerId !== undefined) {
      if (input.providerId) {
        const provider = await this.prisma.topUpProvider.findUnique({ where: { id: input.providerId } });
        if (!provider) throw new Error('Top-up provider not found');
        data.providerId = input.providerId;
      } else {
        data.providerId = null;
        data.providerServiceId = null;
        data.providerCost = null;
      }
    }
    if (input.gameId !== undefined) {
      const game = await this.prisma.topUpGame.findUnique({ where: { id: input.gameId } });
      if (!game) throw new Error('Top-up game not found');
      data.gameId = input.gameId;
      // Inherit provider from game if not explicitly provided
      if (input.providerCost === undefined && input.currency === undefined) {
        data.providerId = game.providerId ?? null;
        data.providerServiceId = game.providerId ? (game.providerServiceId ?? null) : null;
        data.providerCost = game.providerId ? undefined : null;
      }
    }
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new Error('Package name is required');
      data.name = name;
    }
    if (input.diamondAmount !== undefined) {
      if (!Number.isInteger(input.diamondAmount) || input.diamondAmount < 0) {
        throw new Error('Diamond amount must be a non-negative integer');
      }
      data.diamondAmount = input.diamondAmount;
    }
    if (input.content !== undefined) {
      data.content = normalizePackageContent(input.content);
    }
    if (input.price !== undefined) {
      const price = parseFloat(input.price);
      if (!Number.isFinite(price) || price <= 0) {
        throw new Error('Price must be a positive number');
      }
      data.price = price;
    }
    if (input.currency !== undefined) {
      const currency = input.currency.trim().toUpperCase();
      if (!currency) throw new Error('Currency is required');
      data.currency = currency;
    }
    if (input.providerCost !== undefined) {
      data.providerCost = this.validateProviderCost(input.providerCost);
    }
    if (input.providerOfferId !== undefined) {
      data.providerOfferId = input.providerOfferId?.trim() || null;
    }
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
    if (input.icon !== undefined) data.icon = input.icon?.trim() || null;
    if (input.imageUrl !== undefined) data.imageUrl = input.imageUrl?.trim() || null;
    if (input.customerNote !== undefined) data.customerNote = input.customerNote?.trim() || null;
    if (input.noteColor !== undefined) data.noteColor = input.noteColor || 'WARNING';

    return this.prisma.$transaction(async (tx) => {
      const pkg = await tx.topUpPackage.update({
        where: { id },
        data,
        include: {
          game: { select: { id: true, name: true, providerId: true, providerServiceId: true } },
          provider: { select: { id: true, name: true, status: true } }
        }
      });

      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'TopUpPackage',
          entityId: pkg.id,
          action: 'UPDATE',
          oldValue: {
            gameId: existing.gameId,
            name: existing.name,
            diamondAmount: existing.diamondAmount,
            content: existing.content,
            price: existing.price.toString(),
            providerId: existing.providerId,
            providerServiceId: existing.providerServiceId,
            providerOfferId: existing.providerOfferId ?? null,
            providerCost: existing.providerCost?.toString() ?? null,
            isActive: existing.isActive
          },
          newValue: {
            gameId: pkg.gameId,
            name: pkg.name,
            diamondAmount: pkg.diamondAmount,
            content: pkg.content,
            price: pkg.price.toString(),
            providerId: pkg.providerId,
            providerServiceId: pkg.providerServiceId,
            providerOfferId: pkg.providerOfferId ?? null,
            providerCost: pkg.providerCost?.toString() ?? null,
            isActive: pkg.isActive
          }
        }
      });

      return serializePackage(pkg);
    });
  }

  async setPackageStatus(id: string, isActive: boolean, adminId: string) {
    const existing = await this.prisma.topUpPackage.findUnique({ where: { id } });
    if (!existing) throw new Error('Top-up package not found');

    return this.prisma.$transaction(async (tx) => {
      const pkg = await tx.topUpPackage.update({
        where: { id },
        data: { isActive }
      });

      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'TopUpPackage',
          entityId: pkg.id,
          action: isActive ? 'ENABLE' : 'DISABLE',
          oldValue: { isActive: existing.isActive },
          newValue: { isActive }
        }
      });

      return { ...serializePackage(pkg), provider: null };
    });
  }

  async deletePackage(id: string, adminId: string) {
    const existing = await this.prisma.topUpPackage.findUnique({ where: { id } });
    if (!existing) throw new Error('Top-up package not found');

    const orderCount = await this.prisma.topUpOrder.count({ where: { topUpPackageId: id } });
    if (orderCount > 0) {
      throw new Error('Cannot delete a package that has historical orders');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.topUpPackage.delete({ where: { id } });

      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'TopUpPackage',
          entityId: id,
          action: 'DELETE',
          oldValue: {
            gameId: existing.gameId,
            name: existing.name,
            diamondAmount: existing.diamondAmount,
            content: existing.content,
            price: existing.price.toString(),
            providerId: existing.providerId,
            providerServiceId: existing.providerServiceId
          }
        }
      });
    });

    return { success: true };
  }

  // ==================== GAME INPUT CONFIGURATION ====================

  async getGameConfigs() {
    const configs = await this.prisma.topUpGameConfig.findMany({
      include: { game: { select: { id: true, name: true } } },
      orderBy: { game: { name: 'asc' } }
    });
    return {
      configs: configs.map((config) => ({
        ...serializeGameConfig(config),
        game: config.game?.name ?? 'Unknown Game'
      }))
    };
  }

  async getGameConfigByGameId(gameId: string) {
    const config = await this.prisma.topUpGameConfig.findUnique({ where: { gameId } });
    if (!config) return null;
    return serializeGameConfig(config);
  }

  async upsertGameConfig(input: {
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
    customFields?: Array<{ key: string; label: string; required?: boolean; placeholder?: string }> | null;
  }, adminId: string) {
    const game = await this.prisma.topUpGame.findUnique({ where: { id: input.gameId } });
    if (!game) throw new Error('Top-up game not found');

    // Validate verification provider/service if provided
    if (input.verificationProviderId) {
      const provider = await this.prisma.topUpProvider.findUnique({ where: { id: input.verificationProviderId } });
      if (!provider) throw new Error('Verification provider not found');
      if (provider.status !== 'ACTIVE') throw new Error('Verification provider is not active');
    }
    if (input.verificationServiceId) {
      const service = await this.prisma.topUpProviderService.findUnique({ where: { id: input.verificationServiceId } });
      if (!service) throw new Error('Verification provider service not found');
      if (service.status !== 'ACTIVE') throw new Error('Verification provider service is not active');
      if (input.verificationProviderId && service.providerId !== input.verificationProviderId) {
        throw new Error('Verification service does not belong to the selected verification provider');
      }
    }

    const customFields = input.customFields === undefined || input.customFields === null
      ? []
      : this.validateCustomFields(input.customFields);

    const data = {
      gameId: input.gameId,
      requirePlayerId: input.requirePlayerId ?? true,
      requireServerId: input.requireServerId ?? false,
      playerIdValidation: input.playerIdValidation ?? 'TEXT',
      serverIdValidation: input.serverIdValidation ?? 'TEXT',
      verificationEnabled: input.verificationEnabled ?? false,
      allowUnverifiedPurchase: input.allowUnverifiedPurchase ?? false,
      verificationProviderId: input.verificationProviderId ?? null,
      verificationServiceId: input.verificationServiceId ?? null,
      customerNote: input.customerNote?.trim() || null,
      customFields: customFields.length > 0 ? customFields : Prisma.JsonNull
    };

    const existing = await this.prisma.topUpGameConfig.findUnique({ where: { gameId: input.gameId } });

    return this.prisma.$transaction(async (tx) => {
      let config;
      if (existing) {
        config = await tx.topUpGameConfig.update({
          where: { id: existing.id },
          data
        });
        await tx.auditLog.create({
          data: {
            adminId,
            entityType: 'TopUpGameConfig',
            entityId: config.id,
            action: 'UPDATE',
            oldValue: {
              requirePlayerId: existing.requirePlayerId,
              requireServerId: existing.requireServerId,
              playerIdValidation: existing.playerIdValidation,
              serverIdValidation: existing.serverIdValidation,
              verificationEnabled: existing.verificationEnabled,
              allowUnverifiedPurchase: existing.allowUnverifiedPurchase,
              verificationProviderId: existing.verificationProviderId,
              verificationServiceId: existing.verificationServiceId,
              customerNote: existing.customerNote,
              customFields: existing.customFields
            },
            newValue: {
              requirePlayerId: config.requirePlayerId,
              requireServerId: config.requireServerId,
              playerIdValidation: config.playerIdValidation,
              serverIdValidation: config.serverIdValidation,
              verificationEnabled: config.verificationEnabled,
              allowUnverifiedPurchase: config.allowUnverifiedPurchase,
              verificationProviderId: config.verificationProviderId,
              verificationServiceId: config.verificationServiceId,
              customerNote: config.customerNote,
              customFields: config.customFields
            }
          }
        });
      } else {
        config = await tx.topUpGameConfig.create({ data });
        await tx.auditLog.create({
          data: {
            adminId,
            entityType: 'TopUpGameConfig',
            entityId: config.id,
            action: 'CREATE',
            newValue: {
              requirePlayerId: config.requirePlayerId,
              requireServerId: config.requireServerId,
              playerIdValidation: config.playerIdValidation,
              serverIdValidation: config.serverIdValidation,
              verificationEnabled: config.verificationEnabled,
              allowUnverifiedPurchase: config.allowUnverifiedPurchase,
              verificationProviderId: config.verificationProviderId,
              verificationServiceId: config.verificationServiceId,
              customerNote: config.customerNote,
              customFields: config.customFields
            }
          }
        });
      }

      return serializeGameConfig(config);
    });
  }

  async deleteGameConfig(gameId: string, adminId: string) {
    const existing = await this.prisma.topUpGameConfig.findUnique({ where: { gameId } });
    if (!existing) throw new Error('Top-up game config not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.topUpGameConfig.delete({ where: { id: existing.id } });
      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'TopUpGameConfig',
          entityId: existing.id,
          action: 'DELETE',
          oldValue: { gameId: existing.gameId }
        }
      });
    });

    return { success: true };
  }

  private validateCustomFields(fields: Array<{ key: string; label: string; required?: boolean; placeholder?: string }>) {
    if (!Array.isArray(fields) || fields.length > 20) {
      throw new Error('Custom fields must be an array of at most 20 items');
    }

    const keys = new Set<string>();
    for (const field of fields) {
      if (!field || typeof field !== 'object') {
        throw new Error('Invalid custom field');
      }
      const key = typeof field.key === 'string' ? field.key.trim() : '';
      const label = typeof field.label === 'string' ? field.label.trim() : '';
      if (!key || !/^[a-zA-Z0-9_]+$/.test(key)) {
        throw new Error('Custom field keys must contain only letters, numbers, and underscores');
      }
      if (!label) {
        throw new Error('Custom field label is required');
      }
      if (keys.has(key)) {
        throw new Error('Custom field keys must be unique');
      }
      keys.add(key);
    }

    return fields.map((field) => ({
      key: field.key.trim(),
      label: field.label.trim(),
      required: field.required === true,
      placeholder: typeof field.placeholder === 'string' && field.placeholder.trim()
        ? field.placeholder.trim()
        : undefined
    }));
  }

  private async validateProviderBinding(providerId: string | null) {
    if (!providerId) return null;
    const provider = await this.prisma.topUpProvider.findUnique({ where: { id: providerId } });
    if (!provider) {
      throw new Error('Top-up provider not found');
    }
    if (provider.status !== 'ACTIVE') {
      throw new Error('Top-up provider is not active');
    }
    return provider;
  }

  private validateProviderCost(providerCost?: string | number | null): Prisma.Decimal | null {
    if (providerCost === undefined || providerCost === null || providerCost === '') return null;
    const value = parseFloat(String(providerCost));
    if (!Number.isFinite(value) || value < 0) {
      throw new Error('Provider cost must be a non-negative number');
    }
    return new Prisma.Decimal(value);
  }
}

function serializeProvider(provider: {
  id: string;
  name: string;
  apiUrl: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}, packageCount: number) {
  return {
    id: provider.id,
    name: provider.name,
    apiUrl: provider.apiUrl,
    status: provider.status,
    packageCount,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt
  };
}

function serializeGame(game: {
  id: string;
  name: string;
  imageUrl: string | null;
  providerId: string | null;
  providerServiceId: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  provider?: { id: string; name: string; status: string } | null;
  _count?: { packages: number };
  gameConfig?: {
    id: string; gameId: string; requirePlayerId: boolean; requireServerId: boolean;
    playerIdValidation: string; serverIdValidation: string;
    verificationEnabled: boolean; allowUnverifiedPurchase: boolean;
    verificationProviderId: string | null; verificationServiceId: string | null;
    customerNote: string | null; customFields: unknown; createdAt: Date; updatedAt: Date;
  } | null;
}) {
  return {
    id: game.id,
    name: game.name,
    imageUrl: game.imageUrl,
    providerId: game.providerId,
    providerServiceId: game.providerServiceId,
    isActive: game.isActive,
    sortOrder: game.sortOrder,
    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
    provider: game.provider ?? null,
    packageCount: game._count?.packages ?? 0,
    gameConfig: game.gameConfig ? serializeGameConfig(game.gameConfig) : null
  };
}

function serializePackage(pkg: {
  id: string;
  gameId: string;
  name: string;
  diamondAmount: number;
  content: string | null;
  price: Prisma.Decimal;
  currency: string;
  providerId: string | null;
  providerServiceId: string | null;
  providerOfferId?: string | null;
  providerCost: Prisma.Decimal | null;
  isActive: boolean;
  sortOrder: number;
  icon: string | null;
  imageUrl: string | null;
  customerNote: string | null;
  noteColor: string;
  createdAt: Date;
  updatedAt: Date;
  game?: { id: string; name: string; providerId: string | null; providerServiceId: string | null } | null;
  provider?: { id: string; name: string; status: string } | null;
}) {
  return {
    id: pkg.id,
    gameId: pkg.gameId,
    game: pkg.game?.name ?? '',
    name: pkg.name,
    diamondAmount: pkg.diamondAmount,
    content: pkg.content,
    price: pkg.price.toString(),
    currency: pkg.currency,
    providerId: pkg.providerId,
    providerServiceId: pkg.providerServiceId,
    providerOfferId: pkg.providerOfferId ?? null,
    providerCost: pkg.providerCost?.toString() ?? null,
    isActive: pkg.isActive,
    sortOrder: pkg.sortOrder,
    icon: pkg.icon,
    imageUrl: pkg.imageUrl,
    customerNote: pkg.customerNote,
    noteColor: pkg.noteColor,
    createdAt: pkg.createdAt,
    updatedAt: pkg.updatedAt,
    provider: pkg.provider ?? null,
    gameObj: pkg.game ?? null
  };
}

function normalizePackageContent(content: string | null | undefined): string | null {
  if (content === undefined || content === null) return null;
  if (typeof content !== 'string') throw new Error('Product content must be text');
  const normalized = content.trim();
  return normalized || null;
}

function parseLegacyDiamondAmount(content: string | null): number {
  if (!content) return Number.NaN;
  const match = content.match(/^([\d,_]+)/);
  if (!match?.[1]) return 0;
  const value = Number(match[1].replace(/[,_]/g, ''));
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function serializeGameConfig(config: {
  id: string;
  gameId: string;
  requirePlayerId: boolean;
  requireServerId: boolean;
  playerIdValidation: string;
  serverIdValidation: string;
  verificationEnabled: boolean;
  allowUnverifiedPurchase: boolean;
  verificationProviderId: string | null;
  verificationServiceId: string | null;
  customerNote: string | null;
  customFields: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: config.id,
    game: config.gameId,
    requirePlayerId: config.requirePlayerId,
    requireServerId: config.requireServerId,
    playerIdValidation: config.playerIdValidation,
    serverIdValidation: config.serverIdValidation,
    verificationEnabled: config.verificationEnabled,
    allowUnverifiedPurchase: config.allowUnverifiedPurchase,
    verificationProviderId: config.verificationProviderId,
    verificationServiceId: config.verificationServiceId,
    customerNote: config.customerNote,
    customFields: Array.isArray(config.customFields) ? config.customFields : [],
    createdAt: config.createdAt,
    updatedAt: config.updatedAt
  };
}

function serializeProviderService(service: {
  id: string;
  providerId: string;
  providerServiceId: string;
  name: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  provider?: { id: string; name: string; status: string } | null;
  _count?: { games: number; packages: number };
}) {
  return {
    id: service.id,
    providerId: service.providerId,
    providerServiceId: service.providerServiceId,
    name: service.name,
    status: service.status,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt,
    provider: service.provider ?? null,
    gameCount: service._count?.games ?? 0,
    packageCount: service._count?.packages ?? 0
  };
}
