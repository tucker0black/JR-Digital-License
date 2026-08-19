import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

vi.mock('../utils/encryption.js', () => ({
  encryptInventoryValue: vi.fn((value: string) => `encrypted-${value}`),
  decryptInventoryValue: vi.fn((value: string) => value.replace('encrypted-', '')),
}));

import { StockService } from './stock.service.js';

const mockPrisma = {
  productStock: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
    createManyAndReturn: vi.fn(),
    groupBy: vi.fn(),
  },
  $transaction: vi.fn(),
};

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn().mockImplementation(() => mockPrisma),
  Prisma: {
    TransactionIsolationLevel: {
      Serializable: 'Serializable',
    },
  },
}));

describe('StockService', () => {
  let stockService: StockService;

  beforeEach(() => {
    vi.clearAllMocks();
    stockService = new StockService(mockPrisma as unknown as PrismaClient);
  });

  afterEach(async () => {
    vi.clearAllMocks();
  });

  describe('getAvailableStockInfo', () => {
    it('returns stock counts by status', async () => {
      mockPrisma.productStock.groupBy.mockResolvedValue([
        { status: 'AVAILABLE', _count: { status: 5 } },
        { status: 'RESERVED', _count: { status: 2 } },
        { status: 'SOLD', _count: { status: 10 } },
        { status: 'DISABLED', _count: { status: 1 } },
      ]);

      const result = await stockService.getAvailableStockInfo('product-1');

      expect(result).toEqual({
        productId: 'product-1',
        availableCount: 5,
        reservedCount: 2,
        soldCount: 10,
        disabledCount: 1,
      });
    });
  });

  describe('createStock', () => {
    it('creates a single stock item with encrypted value', async () => {
      mockPrisma.productStock.create.mockResolvedValue({
        id: 'stock-1',
        productId: 'product-1',
        variantId: null,
        deliveryValue: 'encrypted-value',
        deliveryType: 'DIGITAL_LINK',
        status: 'AVAILABLE',
        orderId: null,
        reservedAt: null,
        soldAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await stockService.createStock({
        productId: 'product-1',
        deliveryValue: 'license-key-123',
        deliveryType: 'DIGITAL_LINK',
      });

      expect(result.id).toBe('stock-1');
      expect(mockPrisma.productStock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            productId: 'product-1',
            deliveryType: 'DIGITAL_LINK',
            status: 'AVAILABLE',
          }),
        })
      );
    });
  });

  describe('createStockBatch', () => {
    it('creates multiple stock items with encrypted values', async () => {
      mockPrisma.productStock.createManyAndReturn.mockResolvedValue([
        { id: 'stock-1', productId: 'product-1', variantId: null, deliveryValue: 'encrypted-1', deliveryType: 'DIGITAL_CODE', status: 'AVAILABLE', orderId: null, reservedAt: null, soldAt: null, createdAt: new Date(), updatedAt: new Date() },
        { id: 'stock-2', productId: 'product-1', variantId: null, deliveryValue: 'encrypted-2', deliveryType: 'DIGITAL_CODE', status: 'AVAILABLE', orderId: null, reservedAt: null, soldAt: null, createdAt: new Date(), updatedAt: new Date() },
        { id: 'stock-3', productId: 'product-1', variantId: null, deliveryValue: 'encrypted-3', deliveryType: 'DIGITAL_CODE', status: 'AVAILABLE', orderId: null, reservedAt: null, soldAt: null, createdAt: new Date(), updatedAt: new Date() },
      ]);

      const result = await stockService.createStockBatch('product-1', undefined, 'DIGITAL_CODE', ['code-1', 'code-2', 'code-3']);

      expect(result).toHaveLength(3);
      expect(mockPrisma.productStock.createManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ productId: 'product-1', deliveryType: 'DIGITAL_CODE', status: 'AVAILABLE' }),
          ]),
        })
      );
    });
  });

  describe('reserveStock', () => {
    it('successfully reserves available stock', async () => {
      mockPrisma.productStock.findMany.mockResolvedValue([
        { id: 'stock-1', productId: 'product-1', variantId: null, status: 'AVAILABLE' },
        { id: 'stock-2', productId: 'product-1', variantId: null, status: 'AVAILABLE' },
      ]);
      mockPrisma.productStock.updateMany.mockResolvedValue({ count: 2 });
      mockPrisma.productStock.findMany.mockResolvedValueOnce([
        { id: 'stock-1', productId: 'product-1', status: 'RESERVED' },
        { id: 'stock-2', productId: 'product-1', status: 'RESERVED' },
      ]);
      mockPrisma.$transaction.mockImplementation(async (fn) => fn(mockPrisma));

      const result = await stockService.reserveStock('product-1', 2, 'order-1');

      expect(result.success).toBe(true);
      expect(result.reservedStock).toHaveLength(2);
    });

    it('fails when insufficient stock is available', async () => {
      mockPrisma.productStock.findMany.mockResolvedValue([
        { id: 'stock-1', productId: 'product-1', variantId: null, status: 'AVAILABLE' },
      ]);
      mockPrisma.$transaction.mockImplementation(async (fn) => fn(mockPrisma));

      const result = await stockService.reserveStock('product-1', 2, 'order-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Insufficient stock');
    });

    it('only claims stock items that are still AVAILABLE', async () => {
      mockPrisma.productStock.findMany.mockResolvedValue([
        { id: 'stock-1', productId: 'product-1', variantId: null, status: 'AVAILABLE' },
        { id: 'stock-2', productId: 'product-1', variantId: null, status: 'AVAILABLE' },
      ]);
      mockPrisma.productStock.updateMany.mockResolvedValue({ count: 2 });
      mockPrisma.productStock.findMany.mockResolvedValueOnce([
        { id: 'stock-1', productId: 'product-1', status: 'RESERVED' },
        { id: 'stock-2', productId: 'product-1', status: 'RESERVED' },
      ]);
      mockPrisma.$transaction.mockImplementation(async (fn) => fn(mockPrisma));

      await stockService.reserveStock('product-1', 2, 'order-1');

      expect(mockPrisma.productStock.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['stock-1', 'stock-2'] }, status: 'AVAILABLE' }
        })
      );
    });

    it('does not claim stock already claimed by a concurrent order', async () => {
      mockPrisma.productStock.findMany.mockResolvedValue([
        { id: 'stock-1', productId: 'product-1', variantId: null, status: 'AVAILABLE' },
        { id: 'stock-2', productId: 'product-1', variantId: null, status: 'AVAILABLE' },
      ]);
      mockPrisma.productStock.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.$transaction.mockImplementation(async (fn) => fn(mockPrisma));

      const result = await stockService.reserveStock('product-1', 2, 'order-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Insufficient stock');
      expect(result.reservedStock).toBeUndefined();
    });
  });

  describe('releaseReservation', () => {
    it('releases reserved stock back to available', async () => {
      mockPrisma.productStock.updateMany.mockResolvedValue({ count: 2 });

      await stockService.releaseReservation(['stock-1', 'stock-2']);

      expect(mockPrisma.productStock.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['stock-1', 'stock-2'] }, status: 'RESERVED' },
        data: { status: 'AVAILABLE', orderId: null, reservedAt: null },
      });
    });
  });

  describe('releaseReservationByOrderId', () => {
    it('releases all reserved stock for an order', async () => {
      mockPrisma.productStock.updateMany.mockResolvedValue({ count: 3 });

      const count = await stockService.releaseReservationByOrderId('order-1');

      expect(count).toBe(3);
      expect(mockPrisma.productStock.updateMany).toHaveBeenCalledWith({
        where: { orderId: 'order-1', status: 'RESERVED' },
        data: { status: 'AVAILABLE', orderId: null, reservedAt: null },
      });
    });
  });

  describe('markStockSold', () => {
    it('marks reserved stock as sold', async () => {
      mockPrisma.productStock.updateMany.mockResolvedValue({ count: 2 });

      await stockService.markStockSold(['stock-1', 'stock-2']);

      expect(mockPrisma.productStock.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['stock-1', 'stock-2'] }, status: 'RESERVED' },
        data: { status: 'SOLD', soldAt: expect.any(Date) },
      });
    });
  });

  describe('getReservedStockByOrderId', () => {
    it('returns reserved stock for an order', async () => {
      mockPrisma.productStock.findMany.mockResolvedValue([
        { id: 'stock-1', orderId: 'order-1', status: 'RESERVED' },
        { id: 'stock-2', orderId: 'order-1', status: 'RESERVED' },
      ]);

      const result = await stockService.getReservedStockByOrderId('order-1');

      expect(result).toHaveLength(2);
      expect(mockPrisma.productStock.findMany).toHaveBeenCalledWith({
        where: { orderId: 'order-1', status: 'RESERVED' },
      });
    });
  });

  describe('disableStock', () => {
    it('disables available and reserved stock', async () => {
      mockPrisma.productStock.updateMany.mockResolvedValue({ count: 2 });

      const count = await stockService.disableStock(['stock-1', 'stock-2']);

      expect(count).toBe(2);
      expect(mockPrisma.productStock.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['stock-1', 'stock-2'] }, status: { in: ['AVAILABLE', 'RESERVED'] } },
        data: { status: 'DISABLED' },
      });
    });
  });
});