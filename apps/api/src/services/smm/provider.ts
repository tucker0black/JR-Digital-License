export interface SmmProvider {
  readonly name: string;
  readonly providerType: string;

  getServices(params: GetServicesParams): Promise<GetServicesResult>;
  getService(params: GetServiceParams): Promise<GetServiceResult>;
  createOrder(params: CreateOrderParams): Promise<CreateOrderResult>;
  getOrderStatus(params: GetOrderStatusParams): Promise<GetOrderStatusResult>;
  cancelOrder(params: CancelOrderParams): Promise<CancelOrderResult>;
}

export interface GetServicesParams {
  category?: string;
}

export interface GetServicesResult {
  success: boolean;
  services?: Array<{
    id: string;
    providerServiceId: string;
    name: string;
    category: string;
    description?: string;
    rate: string; // cost per unit
    minQuantity: number;
    maxQuantity: number;
    metadata?: Record<string, unknown>;
  }>;
  error?: string;
}

export interface GetServiceParams {
  providerServiceId: string;
}

export interface GetServiceResult {
  success: boolean;
  service?: {
    id: string;
    providerServiceId: string;
    name: string;
    category: string;
    description?: string;
    rate: string;
    minQuantity: number;
    maxQuantity: number;
    metadata?: Record<string, unknown>;
  };
  error?: string;
}

export interface CreateOrderParams {
  orderId: string;
  serviceId: string;
  target: string;
  quantity: number;
  reference: string;
  idempotencyKey: string;
}

export interface CreateOrderResult {
  success: boolean;
  orderId?: string;
  providerOrderId?: string;
  error?: string;
}

export interface GetOrderStatusParams {
  providerOrderId?: string;
  reference?: string;
  idempotencyKey?: string;
}

export interface GetOrderStatusResult {
  success: boolean;
  status: 'PENDING' | 'PROCESSING' | 'IN_PROGRESS' | 'COMPLETED' | 'PARTIAL' | 'CANCELLED' | 'FAILED' | 'REFUNDED';
  providerOrderId?: string;
  completedAt?: Date;
  quantity?: number;
  charge?: string;
  currency?: string;
  error?: string;
}

export interface CancelOrderParams {
  providerOrderId?: string;
  reference?: string;
}

export interface CancelOrderResult {
  success: boolean;
  error?: string;
}

export abstract class BaseSmmProvider implements SmmProvider {
  abstract readonly name: string;
  abstract readonly providerType: string;

  abstract getServices(params: GetServicesParams): Promise<GetServicesResult>;
  abstract getService(params: GetServiceParams): Promise<GetServiceResult>;
  abstract createOrder(params: CreateOrderParams): Promise<CreateOrderResult>;
  abstract getOrderStatus(params: GetOrderStatusParams): Promise<GetOrderStatusResult>;
  abstract cancelOrder(params: CancelOrderParams): Promise<CancelOrderResult>;

  isAvailable(): boolean {
    return true;
  }

  protected generateReference(): string {
    return `smm_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  protected generateIdempotencyKey(): string {
    return `smm_idem_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }
}