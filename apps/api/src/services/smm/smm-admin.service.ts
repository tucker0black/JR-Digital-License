import type { Prisma, PrismaClient, SmmProviderStatus, SmmServiceStatus } from '@prisma/client';
import { encryptInventoryValue } from '../../utils/encryption.js';

export interface CreateSmmProviderInput {
  name: string;
  apiUrl: string;
  apiKey: string;
  status?: SmmProviderStatus;
}

export interface UpdateSmmProviderInput {
  name?: string;
  apiUrl?: string;
  apiKey?: string;
  status?: SmmProviderStatus;
}

export interface CreateSmmServiceInput {
  providerId: string;
  productId?: string | null;
  providerServiceId: string;
  name: string;
  providerCost?: string | number | null;
  minimumQuantity: number;
  maximumQuantity: number;
  status?: SmmServiceStatus;
  metadata?: unknown;
}

export interface UpdateSmmServiceInput {
  productId?: string | null;
  providerServiceId?: string;
  name?: string;
  providerCost?: string | number | null;
  minimumQuantity?: number;
  maximumQuantity?: number;
  status?: SmmServiceStatus;
  metadata?: unknown;
}

export class SmmAdminService {
  constructor(private prisma: PrismaClient) {}

  // Providers are returned without any API key material, encrypted or otherwise.

  async getProviders() {
    const providers = await this.prisma.smmProvider.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { services: true } } }
    });

    return {
      providers: providers.map(provider => ({
        id: provider.id,
        name: provider.name,
        apiUrl: provider.apiUrl,
        status: provider.status,
        serviceCount: provider._count.services,
        createdAt: provider.createdAt,
        updatedAt: provider.updatedAt
      }))
    };
  }

  async createProvider(input: CreateSmmProviderInput, adminId: string) {
    const existing = await this.prisma.smmProvider.findUnique({
      where: { name: input.name }
    });

    if (existing) {
      throw new Error('An SMM provider with this name already exists');
    }

    return this.prisma.$transaction(async (tx) => {
      const provider = await tx.smmProvider.create({
        data: {
          name: input.name,
          apiUrl: input.apiUrl,
          encryptedApiKey: encryptInventoryValue(input.apiKey),
          status: input.status ?? 'ACTIVE'
        }
      });

      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'SmmProvider',
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

  async updateProvider(id: string, input: UpdateSmmProviderInput, adminId: string) {
    const existing = await this.prisma.smmProvider.findUnique({
      where: { id },
      include: { _count: { select: { services: true } } }
    });

    if (!existing) {
      throw new Error('SMM provider not found');
    }

    if (input.name && input.name !== existing.name) {
      const nameTaken = await this.prisma.smmProvider.findUnique({
        where: { name: input.name }
      });
      if (nameTaken) {
        throw new Error('An SMM provider with this name already exists');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const provider = await tx.smmProvider.update({
        where: { id },
        data: {
          name: input.name,
          apiUrl: input.apiUrl,
          encryptedApiKey: input.apiKey ? encryptInventoryValue(input.apiKey) : undefined,
          status: input.status
        }
      });

      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'SmmProvider',
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

      return serializeProvider(provider, existing._count.services);
    });
  }

  async setProviderStatus(id: string, status: SmmProviderStatus, adminId: string) {
    const existing = await this.prisma.smmProvider.findUnique({
      where: { id },
      include: { _count: { select: { services: true } } }
    });

    if (!existing) {
      throw new Error('SMM provider not found');
    }

    if (existing.status === status) {
      throw new Error(`Provider is already ${status}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const provider = await tx.smmProvider.update({
        where: { id },
        data: { status }
      });

      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'SmmProvider',
          entityId: id,
          action: 'STATUS_CHANGED',
          oldValue: { status: existing.status },
          newValue: { status }
        }
      });

      return serializeProvider(provider, existing._count.services);
    });
  }

  async getServices() {
    const services = await this.prisma.smmService.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        provider: { select: { id: true, name: true, status: true } },
        product: { select: { id: true, name: true, slug: true } }
      }
    });

    return {
      services: services.map(service => ({
        ...service,
        providerCost: service.providerCost?.toString() ?? null
      }))
    };
  }

  async createService(input: CreateSmmServiceInput, adminId: string) {
    const provider = await this.prisma.smmProvider.findUnique({
      where: { id: input.providerId }
    });

    if (!provider) {
      throw new Error('SMM provider not found');
    }

    const existing = await this.prisma.smmService.findUnique({
      where: { providerId_providerServiceId: {
        providerId: input.providerId,
        providerServiceId: input.providerServiceId
      } }
    });

    if (existing) {
      throw new Error('A service with this provider service ID already exists for the provider');
    }

    if (input.productId) {
      const product = await this.prisma.product.findUnique({
        where: { id: input.productId }
      });
      if (!product) {
        throw new Error('Linked product not found');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const service = await tx.smmService.create({
        data: {
          providerId: input.providerId,
          productId: input.productId ?? null,
          providerServiceId: input.providerServiceId,
          name: input.name,
          providerCost: input.providerCost ?? null,
          minimumQuantity: input.minimumQuantity,
          maximumQuantity: input.maximumQuantity,
          status: input.status ?? 'ACTIVE',
          metadata: (input.metadata ?? null) as never
        }
      });

      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'SmmService',
          entityId: service.id,
          action: 'CREATE',
          newValue: {
            providerId: service.providerId,
            providerServiceId: service.providerServiceId,
            name: service.name,
            providerCost: service.providerCost?.toString() ?? null,
            status: service.status
          }
        }
      });

      return serializeService(service, { id: provider.id, name: provider.name, status: provider.status }, null);
    });
  }

  async updateService(id: string, input: UpdateSmmServiceInput, adminId: string) {
    const existing = await this.prisma.smmService.findUnique({
      where: { id },
      include: { provider: { select: { id: true, name: true, status: true } } }
    });

    if (!existing) {
      throw new Error('SMM service not found');
    }

    if (input.productId !== undefined && input.productId !== null) {
      const product = await this.prisma.product.findUnique({
        where: { id: input.productId }
      });
      if (!product) {
        throw new Error('Linked product not found');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const service = await tx.smmService.update({
        where: { id },
        data: {
          productId: input.productId,
          providerServiceId: input.providerServiceId,
          name: input.name,
          providerCost: input.providerCost,
          minimumQuantity: input.minimumQuantity,
          maximumQuantity: input.maximumQuantity,
          status: input.status,
          metadata: input.metadata === undefined ? undefined : (input.metadata as never)
        }
      });

      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'SmmService',
          entityId: id,
          action: 'UPDATE',
          oldValue: {
            name: existing.name,
            providerCost: existing.providerCost?.toString() ?? null,
            status: existing.status,
            productId: existing.productId
          },
          newValue: {
            name: service.name,
            providerCost: service.providerCost?.toString() ?? null,
            status: service.status,
            productId: service.productId
          }
        }
      });

      const product = service.productId
        ? await tx.product.findUnique({
            where: { id: service.productId },
            select: { id: true, name: true, slug: true }
          })
        : null;

      return serializeService(service, existing.provider, product);
    });
  }

  async setServiceStatus(id: string, status: SmmServiceStatus, adminId: string) {
    const existing = await this.prisma.smmService.findUnique({
      where: { id },
      include: {
        provider: { select: { id: true, name: true, status: true } },
        product: { select: { id: true, name: true, slug: true } }
      }
    });

    if (!existing) {
      throw new Error('SMM service not found');
    }

    if (existing.status === status) {
      throw new Error(`Service is already ${status}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const service = await tx.smmService.update({
        where: { id },
        data: { status }
      });

      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'SmmService',
          entityId: id,
          action: 'STATUS_CHANGED',
          oldValue: { status: existing.status },
          newValue: { status }
        }
      });

      return serializeService(service, existing.provider, existing.product);
    });
  }
}

function serializeProvider(provider: {
  id: string;
  name: string;
  apiUrl: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}, serviceCount: number) {
  return {
    id: provider.id,
    name: provider.name,
    apiUrl: provider.apiUrl,
    status: provider.status,
    serviceCount,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt
  };
}

function serializeService(
  service: {
    id: string;
    providerId: string;
    productId: string | null;
    providerServiceId: string;
    name: string;
    providerCost: Prisma.Decimal | null;
    minimumQuantity: number;
    maximumQuantity: number;
    status: string;
    metadata: unknown;
    createdAt: Date;
    updatedAt: Date;
  },
  provider: { id: string; name: string; status: string },
  product: { id: string; name: string; slug: string } | null
) {
  return {
    id: service.id,
    providerId: service.providerId,
    productId: service.productId,
    providerServiceId: service.providerServiceId,
    name: service.name,
    providerCost: service.providerCost?.toString() ?? null,
    minimumQuantity: service.minimumQuantity,
    maximumQuantity: service.maximumQuantity,
    status: service.status,
    metadata: service.metadata,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt,
    provider,
    product
  };
}