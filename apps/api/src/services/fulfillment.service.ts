import type { PrismaClient, FulfillmentStatus } from '@prisma/client';
import type { StockService } from './stock.service.js';
import type { SmmService } from './smm/smm.service.js';
import type { TopUpService } from './topup/topup.service.js';

export interface FulfillmentResult {
  success: boolean;
  fulfillmentRecord?: { id: string; status: FulfillmentStatus; deliveredAt: Date | null };
  error?: string;
}

export interface FulfillmentItem {
  orderItemId: string;
  productId: string;
  deliveryType: string;
  quantity: number;
}

export class FulfillmentService {
  constructor(
    private prisma: PrismaClient,
    private stockService: StockService,
    private smmService?: SmmService,
    private topUpService?: TopUpService
  ) {}

  async fulfillOrderItem(
    orderItemId: string,
    deliveryRef?: string
  ): Promise<FulfillmentResult> {
    const orderItem = await this.prisma.orderItem.findUnique({
      where: { id: orderItemId },
      include: {
        order: true,
        fulfillment: true,
        product: { select: { isHandDelivery: true } }
      }
    });

    if (!orderItem) {
      return { success: false, error: 'Order item not found' };
    }

    if (!orderItem.order) {
      return { success: false, error: 'Order not found' };
    }

    if (orderItem.fulfillment) {
      if (orderItem.fulfillment.status === 'DELIVERED') {
        return { success: false, error: 'Order item already fulfilled' };
      }
    }

    if (orderItem.product?.isHandDelivery) {
      return { success: false, error: 'Hand delivery items must be fulfilled manually by an admin' };
    }

    if (orderItem.deliveryTypeSnapshot === 'SMM') {
      return this.fulfillSmmOrderItem(orderItemId);
    }

    if (orderItem.deliveryTypeSnapshot === 'TOPUP') {
      return this.fulfillTopUpOrderItem(orderItemId);
    }

    const reservedStock = await this.stockService.getOrderStock(orderItem.order.id);

    if (reservedStock.length === 0) {
      return { success: false, error: 'No stock found for this order' };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const stockToMarkSold = reservedStock.slice(0, orderItem.quantitySnapshot);
      const stockIds = stockToMarkSold.map(s => s.id);

      await tx.productStock.updateMany({
        where: { id: { in: stockIds } },
        data: {
          status: 'SOLD',
          soldAt: new Date()
        }
      });

      const fulfillmentRecord = await tx.fulfillmentRecord.upsert({
        where: { orderItemId },
        create: {
          orderItemId,
          status: 'DELIVERED',
          deliveryRef: deliveryRef ?? `fulfillment-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          deliveredAt: new Date(),
          attemptCount: 1
        },
        update: {
          status: 'DELIVERED',
          deliveryRef: deliveryRef ?? `fulfillment-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          deliveredAt: new Date(),
          attemptCount: { increment: 1 }
        }
      });

      return fulfillmentRecord;
    });

    return {
      success: true,
      fulfillmentRecord: {
        id: result.id,
        status: result.status,
        deliveredAt: result.deliveredAt
      }
    };
  }

  async fulfillOrder(orderId: string): Promise<{ success: boolean; fulfilledItems: number; errors: string[] }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: { fulfillment: true }
        }
      }
    });

    if (!order) {
      return { success: false, fulfilledItems: 0, errors: ['Order not found'] };
    }

    if (order.status !== 'PAID' && order.status !== 'PROCESSING' && order.status !== 'FULFILLING') {
      return { success: false, fulfilledItems: 0, errors: ['Order not in fulfillable state'] };
    }

    const errors: string[] = [];
    let fulfilledItems = 0;

    for (const item of order.items) {
      if (item.fulfillment?.status === 'DELIVERED') {
        fulfilledItems++;
        continue;
      }

      const result = await this.fulfillOrderItem(item.id);
      if (result.success) {
        fulfilledItems++;
      } else {
        errors.push(`Item ${item.id}: ${result.error}`);
      }
    }

    if (errors.length === 0 && fulfilledItems === order.items.length && order.items.length > 0) {
      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: 'COMPLETED', completedAt: new Date() }
      });

      // Create customer notification for order completion
      try {
        const productNames = order.items.map((item) => item.productNameSnapshot).join(', ');
        await this.prisma.customerNotification.create({
          data: {
            userId: order.userId,
            type: 'DELIVERY',
            title: 'Order Completed',
            message: `Your order #${order.orderNumber} for ${productNames} has been delivered successfully.`,
            orderId: order.id,
            dedupeKey: `order:${order.id}:DELIVERY`
          }
        });
      } catch (error) {
        console.error('Failed to create customer notification:', error);
      }
    } else if (errors.length > 0) {
      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: 'FULFILLING' }
      });
    }

    return { success: errors.length === 0, fulfilledItems, errors };
  }

  private async fulfillSmmOrderItem(orderItemId: string): Promise<FulfillmentResult> {
    const orderItem = await this.prisma.orderItem.findUnique({
      where: { id: orderItemId },
      include: { order: true }
    });

    if (!orderItem) {
      return { success: false, error: 'Order item not found' };
    }

    if (!this.smmService) {
      return { success: false, error: 'SMM fulfillment is not available' };
    }

    const result = await this.smmService.createSmmOrder(
      orderItem.order.userId,
      orderItem.order.id,
      'SMM',
      `fulfill_${orderItem.id}`
    );

    if (!result.success) {
      return { success: false, error: result.error || 'Failed to submit SMM order to provider' };
    }

    const fulfillmentRecord = await this.prisma.fulfillmentRecord.upsert({
      where: { orderItemId },
      create: {
        orderItemId,
        status: 'DELIVERED',
        deliveryRef: result.order?.id ?? `smm-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        deliveredAt: new Date(),
        attemptCount: 1
      },
      update: {
        status: 'DELIVERED',
        deliveryRef: result.order?.id,
        deliveredAt: new Date(),
        attemptCount: { increment: 1 }
      }
    });

    return {
      success: true,
      fulfillmentRecord: {
        id: fulfillmentRecord.id,
        status: fulfillmentRecord.status,
        deliveredAt: fulfillmentRecord.deliveredAt
      }
    };
  }

  private async fulfillTopUpOrderItem(orderItemId: string): Promise<FulfillmentResult> {
    const orderItem = await this.prisma.orderItem.findUnique({
      where: { id: orderItemId },
      include: { order: true }
    });

    if (!orderItem) {
      return { success: false, error: 'Order item not found' };
    }

    if (!this.topUpService) {
      return { success: false, error: 'Top-up fulfillment is not available' };
    }

    // Idempotent by design: the service refuses to submit the same order to
    // the provider twice, so a duplicate payment callback or a retry can
    // never create a second provider order.
    const result = await this.topUpService.createTopUpOrder(
      orderItem.order.userId,
      orderItem.order.id,
      `fulfill_${orderItem.id}`
    );

    if (!result.success) {
      return { success: false, error: result.error || 'Failed to submit top-up order to provider' };
    }

    const fulfillmentRecord = await this.prisma.fulfillmentRecord.upsert({
      where: { orderItemId },
      create: {
        orderItemId,
        status: 'DELIVERED',
        deliveryRef: result.order?.id ?? `topup-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        deliveredAt: new Date(),
        attemptCount: 1
      },
      update: {
        status: 'DELIVERED',
        deliveryRef: result.order?.id,
        deliveredAt: new Date(),
        attemptCount: { increment: 1 }
      }
    });

    return {
      success: true,
      fulfillmentRecord: {
        id: fulfillmentRecord.id,
        status: fulfillmentRecord.status,
        deliveredAt: fulfillmentRecord.deliveredAt
      }
    };
  }

  async getFulfillmentStatus(orderItemId: string): Promise<{ status: FulfillmentStatus; deliveryRef: string | null; deliveredAt: Date | null } | null> {
    const fulfillment = await this.prisma.fulfillmentRecord.findUnique({
      where: { orderItemId }
    });

    if (!fulfillment) {
      return null;
    }

    return {
      status: fulfillment.status,
      deliveryRef: fulfillment.deliveryRef,
      deliveredAt: fulfillment.deliveredAt
    };
  }

  async getDeliveryValueForFulfillment(fulfillmentRecordId: string): Promise<string | null> {
    const fulfillment = await this.prisma.fulfillmentRecord.findUnique({
      where: { id: fulfillmentRecordId },
      include: { orderItem: true }
    });

    if (!fulfillment || !fulfillment.orderItem) {
      return null;
    }

    const reservedStock = await this.stockService.getOrderStock(fulfillment.orderItem.orderId);

    if (reservedStock.length === 0) {
      return null;
    }

    const stockToDeliver = reservedStock[0];
    if (!stockToDeliver) {
      return null;
    }
    const decrypted = await this.stockService.getStockWithDecryptedValue(stockToDeliver.id);

    return decrypted?.deliveryValue ?? null;
  }

  async retryFailedFulfillment(fulfillmentRecordId: string): Promise<FulfillmentResult> {
    const fulfillment = await this.prisma.fulfillmentRecord.findUnique({
      where: { id: fulfillmentRecordId }
    });

    if (!fulfillment) {
      return { success: false, error: 'Fulfillment record not found' };
    }

    if (fulfillment.status === 'DELIVERED') {
      return { success: false, error: 'Already delivered' };
    }

    return this.fulfillOrderItem(fulfillment.orderItemId);
  }
}
