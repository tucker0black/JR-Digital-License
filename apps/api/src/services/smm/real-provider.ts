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

interface SmmConfig {
  apiUrl: string;
  apiKey: string;
}

interface SmmServiceItem {
  id: string;
  provider_service_id: string;
  name: string;
  category: string;
  description?: string;
  rate: number;
  min: number;
  max: number;
  metadata?: Record<string, unknown>;
}

interface SmmOrderResponse {
  order_id: string;
  charge?: string;
  currency?: string;
  status: string;
  created_at?: string;
  completed_at?: string;
}

export class RealSmmProvider extends BaseSmmProvider {
  readonly name = 'Real SMM Provider';
  readonly providerType = 'SMM';

  private config: SmmConfig | null = null;
  private isConfigured = false;

  constructor() {
    super();
    this.initializeConfig();
  }

  private initializeConfig(): void {
    const apiUrl = process.env.SMM_API_URL;
    const apiKey = process.env.SMM_API_KEY;

    if (apiUrl && apiKey) {
      this.config = {
        apiUrl: apiUrl.replace(/\/$/, ''),
        apiKey,
      };
      this.isConfigured = true;
    }
  }

  override isAvailable(): boolean {
    return this.isConfigured;
  }

  private async makeRequest<T>(endpoint: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
    if (!this.config) {
      throw new Error('SMM provider is not configured');
    }

    const url = `${this.config.apiUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`,
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`SMM API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  async getServices(params: GetServicesParams): Promise<GetServicesResult> {
    if (!this.isConfigured) {
      return {
        success: false,
        error: 'SMM provider is not configured. Please set SMM_API_URL and SMM_API_KEY environment variables.',
      };
    }

    try {
      const response = await this.makeRequest<{ success: boolean; data?: SmmServiceItem[]; message?: string }>('/api/services', 'GET');

      if (!response.success) {
        return { success: false, error: response.message || 'Failed to fetch services' };
      }

      const services = (response.data || []).map((service) => ({
        id: service.id,
        providerServiceId: service.provider_service_id,
        name: service.name,
        category: service.category,
        description: service.description,
        rate: service.rate.toString(),
        minQuantity: service.min,
        maxQuantity: service.max,
        metadata: service.metadata,
      }));

      let filtered = services.filter((s: { category: string }) => s.category);

      if (params.category) {
        filtered = filtered.filter((s: { category: string }) => s.category.toLowerCase() === params.category!.toLowerCase());
      }

      return { success: true, services: filtered };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch services from SMM provider',
      };
    }
  }

  async getService(params: GetServiceParams): Promise<GetServiceResult> {
    if (!this.isConfigured) {
      return { success: false, error: 'SMM provider is not configured' };
    }

    try {
      const response = await this.makeRequest<{ success: boolean; data?: { id: string; provider_service_id: string; name: string; category: string; description?: string; rate: number; min: number; max: number; metadata?: Record<string, unknown> }; message?: string }>(`/api/services/${params.providerServiceId}`, 'GET');

      if (!response.success || !response.data) {
        return { success: false, error: response.message || 'Service not found' };
      }

      const service = response.data;

      return {
        success: true,
        service: {
          id: service.id,
          providerServiceId: service.provider_service_id,
          name: service.name,
          category: service.category,
          description: service.description,
          rate: service.rate.toString(),
          minQuantity: service.min,
          maxQuantity: service.max,
          metadata: service.metadata,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get service from SMM provider',
      };
    }
  }

  async createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
    if (!this.isConfigured) {
      return {
        success: false,
        error: 'SMM provider is not configured',
      };
    }

    try {
      const response = await this.makeRequest<{ success: boolean; data?: SmmOrderResponse; message?: string }>(
        '/api/orders',
        'POST',
        {
          service_id: params.serviceId,
          target: params.target,
          quantity: params.quantity,
          reference: params.reference,
          idempotency_key: params.idempotencyKey,
        }
      );

      if (!response.success || !response.data) {
        return { success: false, error: response.message || 'Failed to create SMM order' };
      }

      return {
        success: true,
        orderId: response.data.order_id,
        providerOrderId: response.data.order_id,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create SMM order',
      };
    }
  }

  async getOrderStatus(params: GetOrderStatusParams): Promise<GetOrderStatusResult> {
    if (!this.isConfigured) {
      return { success: false, status: 'FAILED', error: 'SMM provider is not configured' };
    }

    try {
      let endpoint = '';
      if (params.providerOrderId) {
        endpoint = `/api/orders/${params.providerOrderId}/status`;
      } else if (params.reference) {
        endpoint = `/api/orders/reference/${params.reference}/status`;
      } else if (params.idempotencyKey) {
        endpoint = `/api/orders/idempotency/${params.idempotencyKey}/status`;
      } else {
        return { success: false, status: 'FAILED', error: 'Missing payment identifier' };
      }

      const response = await this.makeRequest<{ success: boolean; data?: SmmOrderResponse; message?: string }>(endpoint, 'GET');

      if (!response.success || !response.data) {
        return { success: false, status: 'FAILED', error: response.message || 'Failed to get order status' };
      }

      const statusMap: Record<string, GetOrderStatusResult['status']> = {
        'pending': 'PENDING',
        'processing': 'PROCESSING',
        'in_progress': 'IN_PROGRESS',
        'completed': 'COMPLETED',
        'partial': 'PARTIAL',
        'cancelled': 'CANCELLED',
        'failed': 'FAILED',
        'refunded': 'REFUNDED',
      };

      return {
        success: true,
        status: statusMap[response.data.status.toLowerCase()] || 'FAILED',
        providerOrderId: response.data.order_id,
        completedAt: response.data.completed_at ? new Date(response.data.completed_at) : undefined,
        quantity: response.data.charge ? parseFloat(response.data.charge) : undefined,
        charge: response.data.charge,
        currency: response.data.currency,
      };
    } catch (error) {
      return {
        success: false,
        status: 'FAILED',
        error: error instanceof Error ? error.message : 'Failed to get order status from SMM provider',
      };
    }
  }

  async cancelOrder(params: CancelOrderParams): Promise<CancelOrderResult> {
    if (!this.isConfigured) {
      return { success: false, error: 'SMM provider is not configured' };
    }

    try {
      const reference = params.reference || params.providerOrderId;
      if (!reference) {
        return { success: false, error: 'Missing order reference or provider order ID' };
      }

      await this.makeRequest<{ success: boolean; message?: string }>(
        `/api/orders/${reference}/cancel`,
        'POST'
      );

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to cancel SMM order',
      };
    }
  }

  static clearMockData(): void {
    // No mock data to clear for real provider
  }
}