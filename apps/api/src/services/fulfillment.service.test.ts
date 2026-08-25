import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { FulfillmentService } from './fulfillment.service.js';

const stockServiceMock = {
  getOrderStock: vi.fn(),
  getStockWithDecryptedValue: vi.fn(),
  markStockSold: vi.fn(),
};

const topUpServiceMock = {
  createTopUpOrder: vi.fn()
};

const mockPrisma = {
  orderItem: { findUnique: vi.fn() },
  order: {
    findUnique: vi.fn(),
    update: vi.fn()
  },
  productStock: { updateMany: vi.fn() },
  fulfillmentRecord: {
    upsert: vi.fn(),
    findUnique: vi.fn()
  },
  $transaction: vi.fn()
};

function orderItemRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    orderId: 'order-1',
    productId: 'product-1',
    quantitySnapshot: 1,
    order: { id: 'order-1', status: 'PAID', userId: 'user-1' },
    fulfillment: null,
    ...overrides
  };
}

function stockRecord(id: string) {
  return { id, productId: 'product-1', status: 'RESERVED', orderId: 'order-1', deliveryValue: 'encrypted-value' };
}

describe('FulfillmentService', () => {
  let service: FulfillmentService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new FulfillmentService(mockPrisma as unknown as PrismaClient, stockServiceMock as never);
    mockPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback(mockPrisma));
    mockPrisma.fulfillmentRecord.upsert.mockResolvedValue({
      id: 'f-1',
      status: 'DELIVERED',
      deliveryRef: 'fulfillment-1',
      deliveredAt: new Date()
    });
    mockPrisma.productStock.updateMany.mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('fulfillOrderItem', () => {
    it('delivers exactly 1 stock item for quantity 1', async () => {
      mockPrisma.orderItem.findUnique.mockResolvedValue(orderItemRecord());
      stockServiceMock.getOrderStock.mockResolvedValue([stockRecord('stock-1')]);

      const result = await service.fulfillOrderItem('item-1');

      expect(result.success).toBe(true);
      expect(mockPrisma.productStock.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['stock-1'] } },
          data: expect.objectContaining({ status: 'SOLD', soldAt: expect.any(Date) })
        })
      );
      expect(mockPrisma.fulfillmentRecord.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orderItemId: 'item-1' } })
      );
    });

    it('delivers exactly 2 stock items for quantity 2', async () => {
      mockPrisma.orderItem.findUnique.mockResolvedValue(orderItemRecord({ quantitySnapshot: 2 }));
      stockServiceMock.getOrderStock.mockResolvedValue([stockRecord('stock-1'), stockRecord('stock-2')]);

      const result = await service.fulfillOrderItem('item-1');

      expect(result.success).toBe(true);
      expect(mockPrisma.productStock.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['stock-1', 'stock-2'] } } })
      );
    });

    it('delivers exactly 3 stock items for quantity 3', async () => {
      mockPrisma.orderItem.findUnique.mockResolvedValue(orderItemRecord({ quantitySnapshot: 3 }));
      stockServiceMock.getOrderStock.mockResolvedValue([stockRecord('s1'), stockRecord('s2'), stockRecord('s3'), stockRecord('s4')]);

      const result = await service.fulfillOrderItem('item-1');

      expect(result.success).toBe(true);
      expect(mockPrisma.productStock.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['s1', 's2', 's3'] } } })
      );
    });

    it('does not deliver twice when already DELIVERED', async () => {
      mockPrisma.orderItem.findUnique.mockResolvedValue(
        orderItemRecord({ fulfillment: { id: 'f-1', status: 'DELIVERED', deliveredAt: new Date() } })
      );

      const result = await service.fulfillOrderItem('item-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Order item already fulfilled');
      expect(mockPrisma.productStock.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.fulfillmentRecord.upsert).not.toHaveBeenCalled();
    });

    it('fails without stock and delivers nothing', async () => {
      mockPrisma.orderItem.findUnique.mockResolvedValue(orderItemRecord());
      stockServiceMock.getOrderStock.mockResolvedValue([]);

      const result = await service.fulfillOrderItem('item-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('No stock found for this order');
      expect(mockPrisma.productStock.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.fulfillmentRecord.upsert).not.toHaveBeenCalled();
    });
  });

  describe('fulfillOrder', () => {
    it('completes the order when every item is delivered', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        status: 'PAID',
        items: [{ id: 'item-1', fulfillment: null }, { id: 'item-2', fulfillment: null }]
      });
      mockPrisma.orderItem.findUnique.mockResolvedValueOnce(orderItemRecord({ id: 'item-1' }))
        .mockResolvedValueOnce(orderItemRecord({ id: 'item-2' }));
      stockServiceMock.getOrderStock.mockResolvedValue([stockRecord('stock-1')]);

      const result = await service.fulfillOrder('order-1');

      expect(result.success).toBe(true);
      expect(result.fulfilledItems).toBe(2);
      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order-1' },
          data: expect.objectContaining({ status: 'COMPLETED', completedAt: expect.any(Date) })
        })
      );
    });

    it('moves the order to FULFILLING when some items fail', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        status: 'PAID',
        items: [{ id: 'item-1', fulfillment: null }, { id: 'item-2', fulfillment: null }]
      });
      mockPrisma.orderItem.findUnique
        .mockResolvedValueOnce(orderItemRecord({ id: 'item-1' }))
        .mockResolvedValueOnce(orderItemRecord({ id: 'item-2' }));
      stockServiceMock.getOrderStock
        .mockResolvedValueOnce([stockRecord('stock-1')])
        .mockResolvedValueOnce([]);

      const result = await service.fulfillOrder('order-1');

      expect(result.success).toBe(false);
      expect(result.errors.length).toBe(1);
      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'FULFILLING' }) })
      );
    });

    it('rejects orders that are not in a fulfillable state', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        status: 'DRAFT',
        items: [{ id: 'item-1', fulfillment: null }]
      });

      const result = await service.fulfillOrder('order-1');

      expect(result.success).toBe(false);
      expect(result.errors[0]).toBe('Order not in fulfillable state');
      expect(mockPrisma.orderItem.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('top-up fulfillment', () => {
    let service: FulfillmentService;

    beforeEach(() => {
      service = new FulfillmentService(
        mockPrisma as unknown as PrismaClient,
        stockServiceMock as never,
        undefined,
        topUpServiceMock as never
      );
      topUpServiceMock.createTopUpOrder.mockResolvedValue({
        success: true,
        order: { id: 'topup-order-1', reference: 'topup-order-1', providerOrderId: 'external-1' }
      });
      mockPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback(mockPrisma));
      mockPrisma.fulfillmentRecord.upsert.mockResolvedValue({
        id: 'f-1',
        status: 'DELIVERED',
        deliveryRef: 'topup-order-1',
        deliveredAt: new Date()
      });
    });

    it('submits the top-up order to the provider exactly once per item', async () => {
      mockPrisma.orderItem.findUnique.mockResolvedValue(orderItemRecord({ deliveryTypeSnapshot: 'TOPUP' }));

      const first = await service.fulfillOrderItem('item-1');
      expect(first.success).toBe(true);

      mockPrisma.orderItem.findUnique.mockResolvedValue(
        orderItemRecord({ deliveryTypeSnapshot: 'TOPUP', fulfillment: { id: 'f-1', status: 'DELIVERED', deliveredAt: new Date() } })
      );

      const second = await service.fulfillOrderItem('item-1');

      expect(second.success).toBe(false);
      expect(second.error).toBe('Order item already fulfilled');
      expect(topUpServiceMock.createTopUpOrder).toHaveBeenCalledTimes(1);
      expect(topUpServiceMock.createTopUpOrder).toHaveBeenCalledWith(
        'user-1',
        'order-1',
        'fulfill_item-1'
      );
    });

    it('records the delivery when the provider accepts the order', async () => {
      mockPrisma.orderItem.findUnique.mockResolvedValue(orderItemRecord({ deliveryTypeSnapshot: 'TOPUP' }));

      const result = await service.fulfillOrderItem('item-1');

      expect(result.success).toBe(true);
      expect(result.fulfillmentRecord?.status).toBe('DELIVERED');
      expect(mockPrisma.fulfillmentRecord.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orderItemId: 'item-1' },
          create: expect.objectContaining({ status: 'DELIVERED', deliveryRef: 'topup-order-1' }),
          update: expect.objectContaining({ attemptCount: { increment: 1 } })
        })
      );
      expect(stockServiceMock.getOrderStock).not.toHaveBeenCalled();
    });

    it('surfaces provider failures without marking the item delivered', async () => {
      mockPrisma.orderItem.findUnique.mockResolvedValue(orderItemRecord({ deliveryTypeSnapshot: 'TOPUP' }));
      topUpServiceMock.createTopUpOrder.mockResolvedValue({ success: false, error: 'Top-up API error: 500' });

      const result = await service.fulfillOrderItem('item-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Top-up API error: 500');
      expect(mockPrisma.fulfillmentRecord.upsert).not.toHaveBeenCalled();
    });

    it('fails safely when the top-up service is not configured', async () => {
      const bareService = new FulfillmentService(
        mockPrisma as unknown as PrismaClient,
        stockServiceMock as never
      );
      mockPrisma.orderItem.findUnique.mockResolvedValue(orderItemRecord({ deliveryTypeSnapshot: 'TOPUP' }));

      const result = await bareService.fulfillOrderItem('item-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Top-up fulfillment is not available');
      expect(mockPrisma.fulfillmentRecord.upsert).not.toHaveBeenCalled();
    });
  });

  describe('retryFailedFulfillment', () => {
    it('refuses to retry an already delivered item', async () => {
      mockPrisma.fulfillmentRecord.findUnique.mockResolvedValue({
        id: 'f-1',
        status: 'DELIVERED',
        orderItemId: 'item-1'
      });

      const result = await service.retryFailedFulfillment('f-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Already delivered');
      expect(mockPrisma.orderItem.findUnique).not.toHaveBeenCalled();
    });

    it('retries a failed item once stock is available', async () => {
      mockPrisma.fulfillmentRecord.findUnique.mockResolvedValue({
        id: 'f-1',
        status: 'FAILED',
        orderItemId: 'item-1'
      });
      mockPrisma.orderItem.findUnique.mockResolvedValue(orderItemRecord());
      stockServiceMock.getOrderStock.mockResolvedValue([stockRecord('stock-1')]);

      const result = await service.retryFailedFulfillment('f-1');

      expect(result.success).toBe(true);
      expect(mockPrisma.fulfillmentRecord.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orderItemId: 'item-1' } })
      );
    });
  });
});
