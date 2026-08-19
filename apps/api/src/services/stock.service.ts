import type { PrismaClient, ProductStock, DeliveryType } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { encryptInventoryValue, decryptInventoryValue } from '../utils/encryption.js';

export interface StockReservationResult {
  success: boolean;
  reservedStock?: ProductStock[];
  error?: string;
}

export interface AvailableStockInfo {
  productId: string;
  availableCount: number;
  reservedCount: number;
  soldCount: number;
  disabledCount: number;
}

export interface CreateStockInput {
  productId: string;
  variantId?: string;
  deliveryValue: string;
  deliveryType: string;
}

export class StockService {
  constructor(private prisma: PrismaClient) {}

  async getAvailableStockInfo(productId: string): Promise<AvailableStockInfo> {
    const stock = await this.prisma.productStock.groupBy({
      by: ['status'],
      where: { productId },
      _count: { status: true }
    });

    const counts = stock.reduce((acc, item) => {
      acc[item.status.toLowerCase()] = item._count.status;
      return acc;
    }, {} as Record<string, number>);

    return {
      productId,
      availableCount: counts.available || 0,
      reservedCount: counts.reserved || 0,
      soldCount: counts.sold || 0,
      disabledCount: counts.disabled || 0
    };
  }

  async createStock(input: CreateStockInput): Promise<ProductStock> {
    const encryptedValue = encryptInventoryValue(input.deliveryValue);
    
    return this.prisma.productStock.create({
      data: {
        productId: input.productId,
        variantId: input.variantId ?? null,
        deliveryValue: encryptedValue,
        deliveryType: input.deliveryType as DeliveryType,
        status: 'AVAILABLE'
      }
    });
  }

  async createStockBatch(productId: string, variantId: string | undefined, deliveryType: string, values: string[]): Promise<ProductStock[]> {
    const encryptedValues = values.map(v => ({
      productId,
      variantId: variantId ?? null,
      deliveryValue: encryptInventoryValue(v),
      deliveryType: deliveryType as DeliveryType,
      status: 'AVAILABLE' as const
    }));

    return this.prisma.productStock.createManyAndReturn({
      data: encryptedValues
    });
  }

  async reserveStock(
    productId: string,
    quantity: number,
    orderId: string,
    variantId?: string,
    client: Prisma.TransactionClient = this.prisma
  ): Promise<StockReservationResult> {
    const runReservation = async (tx: Prisma.TransactionClient) => {
      const availableStock = await tx.productStock.findMany({
        where: {
          productId,
          variantId: variantId ?? null,
          status: 'AVAILABLE'
        },
        take: quantity,
        orderBy: { createdAt: 'asc' }
      });

      if (availableStock.length < quantity) {
        return {
          success: false,
          error: `Insufficient stock: requested ${quantity}, available ${availableStock.length}`
        };
      }

      const stockIds = availableStock.map(s => s.id);

      const updateResult = await tx.productStock.updateMany({
        where: { id: { in: stockIds }, status: 'AVAILABLE' },
        data: {
          status: 'RESERVED',
          orderId,
          reservedAt: new Date()
        }
      });

      if (updateResult.count < quantity) {
        return {
          success: false,
          error: `Insufficient stock: requested ${quantity}, available ${updateResult.count}`
        };
      }

      const reservedStock = await tx.productStock.findMany({
        where: { id: { in: stockIds } }
      });

      return { success: true, reservedStock };
    };

    if (client !== this.prisma) {
      return runReservation(client);
    }

    return this.prisma.$transaction(runReservation, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable
    });
  }

  async releaseReservation(stockIds: string[]): Promise<void> {
    await this.prisma.productStock.updateMany({
      where: {
        id: { in: stockIds },
        status: 'RESERVED'
      },
      data: {
        status: 'AVAILABLE',
        orderId: null,
        reservedAt: null
      }
    });
  }

  async releaseReservationByOrderId(orderId: string): Promise<number> {
    const result = await this.prisma.productStock.updateMany({
      where: {
        orderId,
        status: 'RESERVED'
      },
      data: {
        status: 'AVAILABLE',
        orderId: null,
        reservedAt: null
      }
    });
    return result.count;
  }

  async markStockSold(stockIds: string[]): Promise<void> {
    await this.prisma.productStock.updateMany({
      where: {
        id: { in: stockIds },
        status: 'RESERVED'
      },
      data: {
        status: 'SOLD',
        soldAt: new Date()
      }
    });
  }

  async getReservedStockByOrderId(orderId: string): Promise<ProductStock[]> {
    return this.prisma.productStock.findMany({
      where: { orderId, status: 'RESERVED' }
    });
  }

  async getOrderStock(orderId: string): Promise<ProductStock[]> {
    return this.prisma.productStock.findMany({
      where: { orderId, status: { in: ['RESERVED', 'SOLD'] } }
    });
  }

  async getSoldStockByOrderId(orderId: string): Promise<ProductStock[]> {
    return this.prisma.productStock.findMany({
      where: { orderId, status: 'SOLD' }
    });
  }

  async getStockWithDecryptedValue(stockId: string): Promise<{ id: string; deliveryValue: string; deliveryType: string } | null> {
    const stock = await this.prisma.productStock.findUnique({
      where: { id: stockId },
      select: { id: true, deliveryValue: true, deliveryType: true }
    });

    if (!stock) {
      return null;
    }

    try {
      const decryptedValue = decryptInventoryValue(stock.deliveryValue);
      return {
        id: stock.id,
        deliveryValue: decryptedValue,
        deliveryType: stock.deliveryType
      };
    } catch {
      return null;
    }
  }

  async disableStock(stockIds: string[]): Promise<number> {
    const result = await this.prisma.productStock.updateMany({
      where: {
        id: { in: stockIds },
        status: { in: ['AVAILABLE', 'RESERVED'] }
      },
      data: { status: 'DISABLED' }
    });
    return result.count;
  }

  async getStockForFulfillment(orderItemId: string): Promise<ProductStock[]> {
    const orderItem = await this.prisma.orderItem.findUnique({
      where: { id: orderItemId },
      include: { order: true }
    });

    if (!orderItem || !orderItem.order) {
      return [];
    }

    return this.prisma.productStock.findMany({
      where: {
        orderId: orderItem.order.id,
        status: { in: ['RESERVED', 'SOLD'] }
      }
    });
  }
}