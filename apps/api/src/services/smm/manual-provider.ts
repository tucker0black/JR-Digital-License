import type {
  GetServicesParams,
  GetServicesResult,
  GetServiceParams,
  GetServiceResult,
  CreateOrderParams,
  CreateOrderResult,
  GetOrderStatusParams,
  GetOrderStatusResult,
  CancelOrderParams,
  CancelOrderResult,
} from './provider.js';
import { BaseSmmProvider } from './provider.js';

interface MockSmmService {
  id: string;
  providerServiceId: string;
  name: string;
  category: string;
  description?: string;
  rate: string;
  minQuantity: number;
  maxQuantity: number;
  metadata?: Record<string, unknown>;
  status: 'ACTIVE' | 'DISABLED';
}

interface MockSmmOrder {
  id: string;
  providerOrderId: string;
  reference: string;
  idempotencyKey: string;
  serviceId: string;
  target: string;
  quantity: number;
  status: 'PENDING' | 'PROCESSING' | 'IN_PROGRESS' | 'COMPLETED' | 'PARTIAL' | 'CANCELLED' | 'FAILED' | 'REFUNDED';
  amount: string;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

const mockServices = new Map<string, MockSmmService>();
const mockOrders = new Map<string, MockSmmOrder>();

// Initialize with some mock services
const initializeMockServices = () => {
  if (mockServices.size > 0) return;

  const services: MockSmmService[] = [
    {
      id: 'srv-1',
      providerServiceId: '1001',
      name: 'Instagram Followers',
      category: 'Instagram',
      description: 'High quality Instagram followers',
      rate: '0.001',
      minQuantity: 100,
      maxQuantity: 10000,
      status: 'ACTIVE',
    },
    {
      id: 'srv-2',
      providerServiceId: '1002',
      name: 'Instagram Likes',
      category: 'Instagram',
      description: 'Real Instagram likes',
      rate: '0.0005',
      minQuantity: 50,
      maxQuantity: 5000,
      status: 'ACTIVE',
    },
    {
      id: 'srv-3',
      providerServiceId: '1003',
      name: 'YouTube Views',
      category: 'YouTube',
      description: 'High retention YouTube views',
      rate: '0.0003',
      minQuantity: 1000,
      maxQuantity: 100000,
      status: 'ACTIVE',
    },
    {
      id: 'srv-4',
      providerServiceId: '1004',
      name: 'TikTok Followers',
      category: 'TikTok',
      description: 'Real TikTok followers',
      rate: '0.002',
      minQuantity: 100,
      maxQuantity: 5000,
      status: 'ACTIVE',
    },
    {
      id: 'srv-5',
      providerServiceId: '1005',
      name: 'Telegram Members',
      category: 'Telegram',
      description: 'Real Telegram channel members',
      rate: '0.005',
      minQuantity: 50,
      maxQuantity: 2000,
      status: 'ACTIVE',
    },
  ];

  for (const service of services) {
    mockServices.set(service.id, service);
  }
};

export class ManualSmmProvider extends BaseSmmProvider {
  readonly name = 'Manual SMM Provider';
  readonly providerType = 'MANUAL';

  constructor() {
    super();
    initializeMockServices();
  }

  async getServices(params: GetServicesParams): Promise<GetServicesResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        error: 'Manual SMM provider is not configured',
      };
    }

    let services = Array.from(mockServices.values()).filter(s => s.status === 'ACTIVE');

    if (params.category) {
      services = services.filter(s => s.category.toLowerCase() === params.category!.toLowerCase());
    }

    return {
      success: true,
      services: services.map(s => ({
        id: s.id,
        providerServiceId: s.providerServiceId,
        name: s.name,
        category: s.category,
        description: s.description,
        rate: s.rate,
        minQuantity: s.minQuantity,
        maxQuantity: s.maxQuantity,
        metadata: s.metadata,
      })),
    };
  }

  async getService(params: GetServiceParams): Promise<GetServiceResult> {
    if (!this.isConfigured()) {
      return { success: false, error: 'Manual SMM provider is not configured' };
    }

    const service = mockServices.get(params.providerServiceId);

    if (!service) {
      return { success: false, error: 'Service not found' };
    }

    return {
      success: true,
      service: {
        id: service.id,
        providerServiceId: service.providerServiceId,
        name: service.name,
        category: service.category,
        description: service.description,
        rate: service.rate,
        minQuantity: service.minQuantity,
        maxQuantity: service.maxQuantity,
        metadata: service.metadata,
      },
    };
  }

  async createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        error: 'Manual SMM provider is not configured',
      };
    }

    const service = mockServices.get(params.serviceId);
    if (!service) {
      return { success: false, error: 'Service not found' };
    }

    if (params.quantity < service.minQuantity || params.quantity > service.maxQuantity) {
      return {
        success: false,
        error: `Quantity must be between ${service.minQuantity} and ${service.maxQuantity}`,
      };
    }

    const orderId = `smm_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const providerOrderId = `manual_${orderId}`;

    const order: MockSmmOrder = {
      id: orderId,
      providerOrderId,
      reference: params.reference,
      idempotencyKey: params.idempotencyKey,
      serviceId: params.serviceId,
      target: params.target,
      quantity: params.quantity,
      status: 'PENDING',
      amount: (parseFloat(service.rate) * params.quantity).toFixed(4),
      currency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockOrders.set(orderId, order);
    mockOrders.set(providerOrderId, order);

    return {
      success: true,
      orderId,
      providerOrderId,
    };
  }

  async getOrderStatus(params: GetOrderStatusParams): Promise<GetOrderStatusResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        status: 'FAILED',
        error: 'Manual SMM provider is not configured',
      };
    }

    let order: MockSmmOrder | undefined;

    if (params.providerOrderId) {
      order = mockOrders.get(params.providerOrderId);
    } else if (params.reference) {
      for (const [, order] of mockOrders) {
        if (order.reference === params.reference) break;
      }
    } else if (params.idempotencyKey) {
      for (const [, order] of mockOrders) {
        if (order.idempotencyKey === params.idempotencyKey) break;
      }
    }

    if (!order) {
      return { success: false, status: 'FAILED', error: 'Order not found' };
    }

    return {
      success: true,
      status: order.status,
      providerOrderId: order.providerOrderId,
      completedAt: order.completedAt,
      quantity: order.quantity,
      charge: order.amount,
      currency: order.currency,
    };
  }

  async cancelOrder(params: CancelOrderParams): Promise<CancelOrderResult> {
    if (!this.isConfigured()) {
      return { success: false, error: 'Manual SMM provider is not configured' };
    }

    let order: MockSmmOrder | undefined;

    if (params.providerOrderId) {
      order = mockOrders.get(params.providerOrderId);
    } else if (params.reference) {
      for (const [, o] of mockOrders) {
        if (o.reference === params.reference) {
          order = o;
          break;
        }
      }
    }

    if (!order) {
      return { success: false, error: 'Order not found' };
    }

    if (order.status === 'COMPLETED' || order.status === 'CANCELLED' || order.status === 'REFUNDED') {
      return { success: false, error: `Cannot cancel order with status ${order.status}` };
    }

    order.status = 'CANCELLED';
    order.updatedAt = new Date();

    return { success: true };
  }

  private isConfigured(): boolean {
    // Manual provider is always available
    return true;
  }

  static clearMockData(): void {
    mockServices.clear();
    mockOrders.clear();
    initializeMockServices();
  }

  static getMockOrder(referenceOrId: string): MockSmmOrder | undefined {
    return mockOrders.get(referenceOrId);
  }

  static getMockService(providerServiceId: string) {
    return mockServices.get(providerServiceId);
  }
}

// Add missing type for MockSmmOrder
interface MockSmmOrder {
  id: string;
  providerOrderId: string;
  reference: string;
  idempotencyKey: string;
  serviceId: string;
  target: string;
  quantity: number;
  status: 'PENDING' | 'PROCESSING' | 'IN_PROGRESS' | 'COMPLETED' | 'PARTIAL' | 'CANCELLED' | 'FAILED' | 'REFUNDED';
  amount: string;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}