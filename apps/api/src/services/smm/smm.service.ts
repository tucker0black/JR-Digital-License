import type { PrismaClient, SmmOrderStatus} from '@prisma/client';
import { ManualSmmProvider } from './manual-provider.js';
import { RealSmmProvider } from './real-provider.js';
import type { BaseSmmProvider } from './provider.js';

export interface SmmProviderFactory {
  getProvider(type: string): BaseSmmProvider;
}

export class DefaultSmmProviderFactory implements SmmProviderFactory {
  private providers = new Map<string, BaseSmmProvider>();

  constructor() {
    this.providers.set('MANUAL', new ManualSmmProvider());
    this.providers.set('SMM', new RealSmmProvider());
  }

  getProvider(type: string): BaseSmmProvider {
    const provider = this.providers.get(type);
    if (!provider) {
      throw new Error(`SMM provider ${type} not implemented`);
    }
    return provider;
  }

  registerProvider(type: string, provider: BaseSmmProvider): void {
    this.providers.set(type, provider);
  }
}

export interface CreateSmmOrderResult {
  success: boolean;
  order?: {
    id: string;
    reference: string;
    providerOrderId?: string;
  };
  error?: string;
}

export interface GetSmmOrderStatusResult {
  success: boolean;
  order?: {
    id: string;
    reference: string;
    providerOrderId?: string;
    status: string;
    amount: string;
    currency: string;
    target: string;
    quantity: number;
    createdAt: Date;
    updatedAt: Date;
    completedAt?: Date;
  };
  error?: string;
}

export class SmmService {
  private factory: SmmProviderFactory;

  constructor(
    private prisma: PrismaClient,
    factory?: SmmProviderFactory
  ) {
    this.factory = factory ?? new DefaultSmmProviderFactory();
  }

  async getServices(params?: { category?: string }) {
    // Try real provider first, fall back to manual
    const providers = ['SMM', 'MANUAL'];
    
    for (const providerType of providers) {
      try {
        const provider = this.factory.getProvider(providerType);
        if (provider.isAvailable()) {
          const result = await provider.getServices({ category: params?.category });
          if (result.success) {
            return { provider: providerType, ...result };
          }
        }
      } catch {
        // Try next provider
      }
    }

    // Fallback to manual
    const manualProvider = this.factory.getProvider('MANUAL');
    const result = await manualProvider.getServices({ category: params?.category });
    return { provider: 'MANUAL', ...result };
  }

  async getService(providerServiceId: string) {
    // Try real provider first
    try {
      const provider = this.factory.getProvider('SMM');
      if (provider.isAvailable()) {
        const result = await provider.getService({ providerServiceId });
        if (result.success) {
          return { provider: 'SMM', ...result };
        }
      }
    } catch {
      // Try manual
    }

    // Fallback to manual
    const manualProvider = this.factory.getProvider('MANUAL');
    const result = await manualProvider.getService({ providerServiceId });
    return { provider: 'MANUAL', ...result };
  }

  async createSmmOrder(
    userId: string,
    orderId: string,
    provider: string,
    idempotencyKey?: string
  ): Promise<CreateSmmOrderResult> {
    const idempotency = idempotencyKey ?? `smm_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

    const existingByIdempotency = await this.prisma.smmOrder.findFirst({
      where: { orderId }
    });

    if (existingByIdempotency) {
      return { success: false, error: 'SMM order already exists for this order' };
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } } }
    });

    if (!order) {
      return { success: false, error: 'Order not found' };
    }

    if (order.userId !== userId) {
      return { success: false, error: 'Order does not belong to user' };
    }

    if (order.status !== 'PAID' && order.status !== 'COMPLETED') {
      return { success: false, error: 'Order must be paid before creating SMM order' };
    }

    // Get the first order item that is an SMM service
    const smmItem = order.items.find(orderItem => {
      return orderItem.product?.deliveryType === 'SMM' || orderItem.deliveryTypeSnapshot === 'SMM';
    });

    if (!smmItem) {
      return { success: false, error: 'No SMM service found in order' };
    }

    // Resolve the SmmService from the selected provider service ID snapshot.
    // Fall back to the first active service linked to the product for legacy orders.
    let smmService = null;
    if (smmItem.providerServiceIdSnapshot) {
      smmService = await this.prisma.smmService.findFirst({
        where: {
          providerServiceId: smmItem.providerServiceIdSnapshot,
          status: 'ACTIVE'
        },
        include: { provider: true }
      });
    }

    if (!smmService && smmItem.productId) {
      smmService = await this.prisma.smmService.findFirst({
        where: { productId: smmItem.productId, status: 'ACTIVE' },
        include: { provider: true },
        orderBy: { name: 'asc' }
      });
    }

    if (!smmService) {
      return { success: false, error: 'No active SMM service linked to this order item' };
    }

    if (!smmService.provider) {
      return { success: false, error: 'SMM provider is not available' };
    }

    let providerInstance = this.factory.getProvider(provider);
    if (!providerInstance.isAvailable()) {
      providerInstance = this.factory.getProvider('MANUAL');
    }

    const createParams = {
      orderId,
      serviceId: smmService.providerServiceId,
      target: smmItem.target || '',
      quantity: smmItem.quantitySnapshot,
      reference: `smm_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      idempotencyKey: idempotency,
    };

    const providerResult = await providerInstance.createOrder(createParams);

    if (!providerResult.success) {
      return { success: false, error: providerResult.error || 'Failed to create SMM order with provider' };
    }

    const smmOrder = await this.prisma.smmOrder.create({
      data: {
        orderId,
        smmServiceId: smmService.id,
        providerId: smmService.providerId,
        providerOrderId: providerResult.providerOrderId,
        target: smmItem.target || '',
        quantity: smmItem.quantitySnapshot,
        status: 'PENDING',
      },
      include: {
        service: { include: { provider: true } },
        provider: true,
        order: true,
      }
    });

    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'PROCESSING' }
    });

    return {
      success: true,
      order: {
        id: smmOrder.id,
        reference: smmOrder.id,
        providerOrderId: smmOrder.providerOrderId ?? undefined,
      }
    };
  }

  async getSmmOrderStatus(smmOrderId: string, userId: string): Promise<GetSmmOrderStatusResult> {
    const smmOrder = await this.prisma.smmOrder.findUnique({
      where: { id: smmOrderId },
      include: {
        order: { select: { userId: true, total: true, currency: true } },
        service: { include: { provider: true } },
        provider: true,
      }
    });

    if (!smmOrder) {
      return { success: false, error: 'SMM order not found' };
    }

    if (smmOrder.order.userId !== userId) {
      return { success: false, error: 'SMM order not found' };
    }

    const providerInstance = this.factory.getProvider(smmOrder.provider.name);

    const statusResult = await providerInstance.getOrderStatus({
      providerOrderId: smmOrder.providerOrderId ?? undefined,
      reference: smmOrder.id ?? undefined,
    });

    if (statusResult.success) {
      // Update local status if changed
      if (statusResult.status !== smmOrder.status) {
        await this.updateSmmOrderStatus(smmOrder.id, statusResult.status, statusResult.completedAt);
      }
    }

    return {
      success: true,
      order: {
        id: smmOrder.id,
        reference: smmOrder.id,
        providerOrderId: smmOrder.providerOrderId ?? undefined,
        status: smmOrder.status,
        amount: smmOrder.order.total.toString(),
        currency: smmOrder.order.currency,
        target: smmOrder.target,
        quantity: smmOrder.quantity,
        createdAt: smmOrder.createdAt,
        updatedAt: smmOrder.updatedAt,
        completedAt: smmOrder.updatedAt,
      }
    };
  }

  private async updateSmmOrderStatus(smmOrderId: string, status: string, _completedAt?: Date): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.smmOrder.update({
        where: { id: smmOrderId },
        data: {
          status: status as SmmOrderStatus,
          updatedAt: new Date()
        }
      });

      await tx.auditLog.create({
        data: {
          entityType: 'SmmOrder',
          entityId: smmOrderId,
          action: 'STATUS_UPDATE',
          newValue: { status }
        }
      });
    });
  }
}