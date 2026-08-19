import { describe, expect, it, vi } from 'vitest';
import { ProductStatus } from '@prisma/client';
import { ProductService } from './product.service.js';

function productRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'product-1',
    name: 'Gemini 18 Month',
    slug: 'gemini-18-month',
    description: 'desc',
    imageUrl: null,
    categoryId: 'cat-1',
    type: 'DIGITAL_LINK',
    deliveryType: 'DIGITAL_LINK',
    price: { toString: () => '2.60' },
    currency: 'USD',
    costPrice: { toString: () => '1.30' },
    markup: null,
    minimumQuantity: 1,
    maximumQuantity: 1,
    hideWhenOutOfStock: false,
    status: 'ACTIVE',
    isActive: true,
    isFeatured: false,
    isPopular: false,
    sortOrder: 0,
    instructions: null,
    keywords: [],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    category: { id: 'cat-1', name: 'Digital Accounts', slug: 'digital-accounts' },
    stock: [],
    ...overrides
  };
}

function makePrismaMock(tx: Record<string, unknown>) {
  return {
    product: {
      findUnique: vi.fn(),
      delete: vi.fn().mockResolvedValue({ id: 'product-1' })
    },
    category: {
      findUnique: vi.fn().mockResolvedValue({ id: 'cat-1', name: 'Digital Accounts' })
    },
    orderItem: { count: vi.fn().mockResolvedValue(0) },
    productStock: { count: vi.fn().mockResolvedValue(0) },
    productVariant: { count: vi.fn().mockResolvedValue(0) },
    license: { count: vi.fn().mockResolvedValue(0) },
    smmService: { count: vi.fn().mockResolvedValue(0) },
    $transaction: vi.fn().mockImplementation(async (callback: (t: unknown) => unknown) => callback(tx))
  };
}

const createInput = {
  name: 'Gemini 24 Month',
  slug: 'gemini-24-month',
  categoryId: 'cat-1',
  type: 'DIGITAL_LINK' as const,
  deliveryType: 'DIGITAL_LINK' as const,
  price: '4.50',
  currency: 'USD',
  minimumQuantity: 1,
  maximumQuantity: 1,
  status: ProductStatus.ACTIVE
};

describe('ProductService validation', () => {
  it('createProduct rejects minimumQuantity > maximumQuantity', async () => {
    const tx = {
      product: { create: vi.fn(), findUnique: vi.fn() },
      auditLog: { create: vi.fn() }
    };
    const prisma = makePrismaMock(tx);
    const service = new ProductService(prisma as never);

    await expect(
      service.createProduct({ ...createInput, minimumQuantity: 100, maximumQuantity: 1 }, 'admin-1')
    ).rejects.toThrow('Minimum quantity cannot be greater than maximum quantity.');
  });

  it('createProduct rejects non-positive price', async () => {
    const tx = {
      product: { create: vi.fn(), findUnique: vi.fn() },
      auditLog: { create: vi.fn() }
    };
    const prisma = makePrismaMock(tx);
    const service = new ProductService(prisma as never);

    await expect(service.createProduct({ ...createInput, price: '0' }, 'admin-1')).rejects.toThrow(
      'Price must be a positive number'
    );
    await expect(service.createProduct({ ...createInput, price: '' }, 'admin-1')).rejects.toThrow(
      'Price must be a positive number'
    );
  });

  it('createProduct rejects zero or negative quantities', async () => {
    const tx = {
      product: { create: vi.fn(), findUnique: vi.fn() },
      auditLog: { create: vi.fn() }
    };
    const prisma = makePrismaMock(tx);
    const service = new ProductService(prisma as never);

    await expect(service.createProduct({ ...createInput, minimumQuantity: 0 }, 'admin-1')).rejects.toThrow(
      'Minimum quantity must be a positive integer'
    );
  });

  it('updateProduct rejects minimumQuantity > maximumQuantity', async () => {
    const tx = {
      product: { update: vi.fn(), findUnique: vi.fn() },
      auditLog: { create: vi.fn() }
    };
    const prisma = makePrismaMock(tx);
    prisma.product.findUnique.mockResolvedValue(productRecord());
    const service = new ProductService(prisma as never);

    await expect(
      service.updateProduct('product-1', { name: 'Magnific', minimumQuantity: 100, maximumQuantity: 1 }, 'admin-1')
    ).rejects.toThrow('Minimum quantity cannot be greater than maximum quantity.');
  });

  it('updateProduct rejects non-positive price', async () => {
    const tx = {
      product: { update: vi.fn(), findUnique: vi.fn() },
      auditLog: { create: vi.fn() }
    };
    const prisma = makePrismaMock(tx);
    prisma.product.findUnique.mockResolvedValue(productRecord());
    const service = new ProductService(prisma as never);

    await expect(service.updateProduct('product-1', { name: 'X', price: '-1' }, 'admin-1')).rejects.toThrow(
      'Price must be a positive number'
    );
  });

  it('updateProduct persists all provided fields and writes an audit entry', async () => {
    const updated = productRecord({
      name: 'Gemini 24 Month',
      slug: 'gemini-24-month',
      price: { toString: () => '3.00' },
      minimumQuantity: 2,
      maximumQuantity: 5,
      status: 'ACTIVE',
      isFeatured: true
    });
    const tx = {
      product: {
        update: vi.fn().mockResolvedValue(updated),
        findUnique: vi.fn().mockResolvedValue(updated)
      },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) }
    };
    const prisma = makePrismaMock(tx);
    prisma.product.findUnique
      .mockResolvedValueOnce(productRecord())
      .mockResolvedValueOnce(null);
    const service = new ProductService(prisma as never);

    const result = await service.updateProduct(
      'product-1',
      {
        name: 'Gemini 24 Month',
        slug: 'gemini-24-month',
        categoryId: 'cat-1',
        price: '3.00',
        minimumQuantity: 2,
        maximumQuantity: 5,
        status: ProductStatus.ACTIVE,
        isFeatured: true
      },
      'admin-1'
    );

    expect(tx.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'product-1' },
        data: expect.objectContaining({
          name: 'Gemini 24 Month',
          price: '3.00',
          minimumQuantity: 2,
          maximumQuantity: 5
        })
      })
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ adminId: 'admin-1', entityType: 'Product', action: 'UPDATE' })
      })
    );
    expect(result.price).toBe('3.00');
  });

  it('createProduct persists valid quantities', async () => {
    const created = productRecord({ minimumQuantity: 5, maximumQuantity: 10, price: { toString: () => '4.50' } });
    const tx = {
      product: {
        create: vi.fn().mockResolvedValue(created),
        findUnique: vi.fn().mockResolvedValue(created)
      },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) }
    };
    const prisma = makePrismaMock(tx);
    prisma.product.findUnique.mockResolvedValue(null);
    const service = new ProductService(prisma as never);

    await service.createProduct({ ...createInput, minimumQuantity: 5, maximumQuantity: 10 }, 'admin-1');

    expect(tx.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ minimumQuantity: 5, maximumQuantity: 10, price: '4.50' })
      })
    );
  });

  it('createProduct stores null when maximum quantity is unconfigured', async () => {
    const created = productRecord({ maximumQuantity: null });
    const tx = {
      product: {
        create: vi.fn().mockResolvedValue(created),
        findUnique: vi.fn().mockResolvedValue(created)
      },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) }
    };
    const prisma = makePrismaMock(tx);
    prisma.product.findUnique.mockResolvedValue(null);
    const service = new ProductService(prisma as never);

    await service.createProduct({ ...createInput, maximumQuantity: null }, 'admin-1');

    expect(tx.product.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ maximumQuantity: null }) })
    );
  });

  it('updateProduct allows clearing the configured maximum quantity', async () => {
    const updated = productRecord({ maximumQuantity: null });
    const tx = {
      product: {
        update: vi.fn().mockResolvedValue(updated),
        findUnique: vi.fn().mockResolvedValue(updated)
      },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) }
    };
    const prisma = makePrismaMock(tx);
    prisma.product.findUnique.mockResolvedValueOnce(productRecord()).mockResolvedValueOnce(null);
    const service = new ProductService(prisma as never);

    await service.updateProduct('product-1', { maximumQuantity: null }, 'admin-1');

    expect(tx.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ maximumQuantity: null }) })
    );
  });
});

describe('ProductService deleteProduct safe-delete guard', () => {
  it('throws Product not found for missing products', async () => {
    const tx = {};
    const prisma = makePrismaMock(tx);
    prisma.product.findUnique.mockResolvedValue(null);
    const service = new ProductService(prisma as never);

    await expect(service.deleteProduct('missing', 'admin-1')).rejects.toThrow('Product not found');
  });

  it('blocks deletion when historical orders exist', async () => {
    const tx = { product: { delete: vi.fn() }, auditLog: { create: vi.fn() } };
    const prisma = makePrismaMock(tx);
    prisma.product.findUnique.mockResolvedValue(productRecord());
    prisma.orderItem.count.mockResolvedValue(2);
    const service = new ProductService(prisma as never);

    await expect(service.deleteProduct('product-1', 'admin-1')).rejects.toThrow(
      'This product has historical orders and cannot be deleted. Disable or archive it instead.'
    );
    expect(tx.product.delete).not.toHaveBeenCalled();
  });

  it('blocks deletion when any stock exists (available/reserved/sold/disabled)', async () => {
    for (const count of [1, 7]) {
      const tx = { product: { delete: vi.fn() }, auditLog: { create: vi.fn() } };
      const prisma = makePrismaMock(tx);
      prisma.product.findUnique.mockResolvedValue(productRecord());
      prisma.productStock.count.mockResolvedValue(count);
      const service = new ProductService(prisma as never);

      await expect(service.deleteProduct('product-1', 'admin-1')).rejects.toThrow(
        `This product has ${count} inventory item${count === 1 ? '' : 's'} and cannot be deleted. Disable or archive it instead.`
      );
      expect(tx.product.delete).not.toHaveBeenCalled();
    }
  });

  it('blocks deletion when variants exist', async () => {
    const tx = { product: { delete: vi.fn() }, auditLog: { create: vi.fn() } };
    const prisma = makePrismaMock(tx);
    prisma.product.findUnique.mockResolvedValue(productRecord());
    prisma.productVariant.count.mockResolvedValue(1);
    const service = new ProductService(prisma as never);

    await expect(service.deleteProduct('product-1', 'admin-1')).rejects.toThrow(
      'This product has variants and cannot be deleted. Disable or archive it instead.'
    );
  });

  it('blocks deletion when license records exist', async () => {
    const tx = { product: { delete: vi.fn() }, auditLog: { create: vi.fn() } };
    const prisma = makePrismaMock(tx);
    prisma.product.findUnique.mockResolvedValue(productRecord());
    prisma.license.count.mockResolvedValue(1);
    const service = new ProductService(prisma as never);

    await expect(service.deleteProduct('product-1', 'admin-1')).rejects.toThrow(
      'This product has license records and cannot be deleted. Disable or archive it instead.'
    );
  });

  it('blocks deletion when linked to an SMM service', async () => {
    const tx = { product: { delete: vi.fn() }, auditLog: { create: vi.fn() } };
    const prisma = makePrismaMock(tx);
    prisma.product.findUnique.mockResolvedValue(productRecord());
    prisma.smmService.count.mockResolvedValue(1);
    const service = new ProductService(prisma as never);

    await expect(service.deleteProduct('product-1', 'admin-1')).rejects.toThrow(
      'This product is linked to an SMM service and cannot be deleted. Disable or archive it instead.'
    );
  });

  it('hard-deletes a clean product (no dependencies) and writes an audit entry', async () => {
    const tx = {
      product: { delete: vi.fn().mockResolvedValue({ id: 'product-1' }) },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) }
    };
    const prisma = makePrismaMock(tx);
    prisma.product.findUnique.mockResolvedValue(productRecord());
    const service = new ProductService(prisma as never);

    await service.deleteProduct('product-1', 'admin-1');

    expect(tx.product.delete).toHaveBeenCalledWith({ where: { id: 'product-1' } });
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          adminId: 'admin-1',
          entityType: 'Product',
          entityId: 'product-1',
          action: 'DELETE'
        })
      })
    );
  });
});
