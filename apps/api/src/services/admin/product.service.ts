import type { PrismaClient, Prisma, ProductType, DeliveryType } from '@prisma/client';
import { ProductStatus } from '@prisma/client';
import { encryptInventoryValue } from '../../utils/encryption.js';

export interface CreateProductInput {
  name: string;
  slug: string;
  description?: string;
  imageUrl?: string;
  categoryId: string;
  type: ProductType;
  deliveryType: DeliveryType;
  price: string | number;
  currency?: string;
  costPrice?: string | number;
  markup?: string | number;
  minimumQuantity?: number;
  maximumQuantity?: number | null;
  hideWhenOutOfStock?: boolean;
  status?: ProductStatus;
  isActive?: boolean;
  isFeatured?: boolean;
  isPopular?: boolean;
  sortOrder?: number;
  instructions?: string;
  keywords?: string[];
  smmServiceIds?: string[];
  isHandDelivery?: boolean;
}

export interface UpdateProductInput {
  name?: string;
  slug?: string;
  description?: string | null;
  imageUrl?: string | null;
  categoryId?: string;
  type?: ProductType;
  deliveryType?: DeliveryType;
  price?: string | number;
  currency?: string;
  costPrice?: string | number | null;
  markup?: string | number | null;
  minimumQuantity?: number;
  maximumQuantity?: number | null;
  hideWhenOutOfStock?: boolean;
  status?: ProductStatus;
  isActive?: boolean;
  isFeatured?: boolean;
  isPopular?: boolean;
  sortOrder?: number;
  instructions?: string | null;
  keywords?: string[];
  smmServiceIds?: string[];
  isHandDelivery?: boolean;
}

export interface ProductFilters {
  search?: string;
  categoryId?: string;
  status?: ProductStatus;
  isActive?: boolean;
  isFeatured?: boolean;
  isPopular?: boolean;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface ProductWithDetails {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  categoryId: string;
  type: string;
  deliveryType: string;
  price: string;
  currency: string;
  costPrice: string | null;
  markup: string | null;
  minimumQuantity: number;
  maximumQuantity: number | null;
  hideWhenOutOfStock: boolean;
  status: string;
  isActive: boolean;
  isFeatured: boolean;
  isPopular: boolean;
  sortOrder: number;
  instructions: string | null;
  keywords: string[];
  isHandDelivery: boolean;
  createdAt: Date;
  updatedAt: Date;
  category: {
    id: string;
    name: string;
    slug: string;
  } | null;
  stockCount: {
    available: number;
    reserved: number;
    sold: number;
    disabled: number;
  };
  smmServices?: Array<{
    id: string;
    providerId: string;
    providerServiceId: string;
    name: string;
    status: string;
    provider: { id: string; name: string };
  }>;
}

const productDetailInclude = {
  category: { select: { id: true, name: true, slug: true } },
  stock: { select: { status: true } },
  smmServices: {
    include: { provider: { select: { id: true, name: true } } },
    orderBy: { name: 'asc' }
  }
} as const;

async function linkSmmServices(
  tx: { smmService: { findMany(args: unknown): Promise<Array<{ id: string; status: string; productId: string | null }>>; updateMany(args: unknown): Promise<unknown> } },
  productId: string,
  serviceIds: string[]
): Promise<void> {
  const uniqueIds = Array.from(new Set(serviceIds));
  if (uniqueIds.length === 0) return;

  const services = await tx.smmService.findMany({
    where: { id: { in: uniqueIds } }
  });

  if (services.length !== uniqueIds.length) {
    throw new Error('One or more SMM services do not exist');
  }

  const invalid = services.filter(
    (s) => s.status !== 'ACTIVE' || (s.productId !== null && s.productId !== productId)
  );
  if (invalid.length > 0) {
    throw new Error('Some SMM services are not available to link (inactive or already linked to another product)');
  }

  await tx.smmService.updateMany({
    where: { id: { in: uniqueIds } },
    data: { productId }
  });
}

export class ProductService {
  constructor(private prisma: PrismaClient) {}

  private assertValidQuantities(input: { minimumQuantity?: number; maximumQuantity?: number | null }): void {
    const { minimumQuantity, maximumQuantity } = input;
    if (minimumQuantity !== undefined && (!Number.isInteger(minimumQuantity) || minimumQuantity < 1)) {
      throw new Error('Minimum quantity must be a positive integer');
    }
    if (maximumQuantity !== undefined && maximumQuantity !== null && (!Number.isInteger(maximumQuantity) || maximumQuantity < 1)) {
      throw new Error('Maximum quantity must be a positive integer');
    }
    if (minimumQuantity !== undefined && maximumQuantity !== undefined && maximumQuantity !== null && minimumQuantity > maximumQuantity) {
      throw new Error('Minimum quantity cannot be greater than maximum quantity.');
    }
  }

  private assertValidPrice(price: string | number | null | undefined, required = false): void {
    if (price === undefined || price === null || price === '') {
      if (required) {
        throw new Error('Price must be a positive number');
      }
      return;
    }
    const numeric = Number(price);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      throw new Error('Price must be a positive number');
    }
  }

  async getProducts(filters: ProductFilters = {}) {
    const {
      search,
      categoryId,
      status,
      isActive,
      isFeatured,
      isPopular,
      page = 1,
      pageSize = 20,
      sortBy = 'sortOrder',
      sortOrder = 'asc'
    } = filters;

    const pageNum = Math.max(1, page);
    const pageSizeNum = Math.min(100, Math.max(1, pageSize));
    const skip = (pageNum - 1) * pageSizeNum;

    const where: Prisma.ProductWhereInput = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (categoryId) {
      where.categoryId = categoryId;
    }

    if (status) {
      where.status = status;
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (isFeatured !== undefined) {
      where.isFeatured = isFeatured;
    }

    if (isPopular !== undefined) {
      where.isPopular = isPopular;
    }

    const orderBy: Prisma.ProductOrderByWithRelationInput = {
      [sortBy]: sortOrder
    };

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: pageSizeNum,
        orderBy,
        include: {
          category: { select: { id: true, name: true, slug: true } },
          stock: { select: { status: true } }
        }
      }),
      this.prisma.product.count({ where })
    ]);

    const productsWithStock = products.map(product => {
      const stockCounts = product.stock.reduce((acc, s) => {
        acc[s.status.toLowerCase()] = (acc[s.status.toLowerCase()] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      return {
        ...product,
        price: product.price.toString(),
        costPrice: product.costPrice?.toString() ?? null,
        markup: product.markup?.toString() ?? null,
        category: product.category,
        stockCount: {
          available: stockCounts.available || 0,
          reserved: stockCounts.reserved || 0,
          sold: stockCounts.sold || 0,
          disabled: stockCounts.disabled || 0
        },
        stock: undefined
      };
    });

    return {
      products: productsWithStock,
      total,
      page: pageNum,
      pageSize: pageSizeNum
    };
  }

  async getProductById(id: string): Promise<ProductWithDetails | null> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: productDetailInclude
    });

    if (!product) return null;

    const stockCounts = product.stock.reduce((acc, s) => {
      acc[s.status.toLowerCase()] = (acc[s.status.toLowerCase()] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      ...product,
      price: product.price.toString(),
      costPrice: product.costPrice?.toString() ?? null,
      markup: product.markup?.toString() ?? null,
      category: product.category,
      stockCount: {
        available: stockCounts.available || 0,
        reserved: stockCounts.reserved || 0,
        sold: stockCounts.sold || 0,
        disabled: stockCounts.disabled || 0
      }
    };
  }

  async getProductBySlug(slug: string): Promise<ProductWithDetails | null> {
    const product = await this.prisma.product.findUnique({
      where: { slug },
      include: productDetailInclude
    });

    if (!product) return null;

    const stockCounts = product.stock.reduce((acc, s) => {
      acc[s.status.toLowerCase()] = (acc[s.status.toLowerCase()] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      ...product,
      price: product.price.toString(),
      costPrice: product.costPrice?.toString() ?? null,
      markup: product.markup?.toString() ?? null,
      category: product.category,
      stockCount: {
        available: stockCounts.available || 0,
        reserved: stockCounts.reserved || 0,
        sold: stockCounts.sold || 0,
        disabled: stockCounts.disabled || 0
      }
    };
  }

  async createProduct(input: CreateProductInput, adminId: string): Promise<ProductWithDetails> {
    this.assertValidPrice(input.price, true);
    this.assertValidQuantities(input);

    const slug = input.slug || input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    // Check if slug already exists
    const existingSlug = await this.prisma.product.findUnique({ where: { slug } });
    if (existingSlug) {
      throw new Error('Product with this slug already exists');
    }

    // Verify category exists
    const category = await this.prisma.category.findUnique({ where: { id: input.categoryId } });
    if (!category) {
      throw new Error('Category not found');
    }

    const product = await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          name: input.name,
          slug,
          description: input.description,
          imageUrl: input.imageUrl,
          categoryId: input.categoryId,
          type: input.type,
          deliveryType: input.deliveryType,
          price: input.price,
          currency: input.currency || 'USD',
          costPrice: input.costPrice,
          markup: input.markup,
          minimumQuantity: input.minimumQuantity || 1,
          maximumQuantity: input.maximumQuantity ?? null,
          hideWhenOutOfStock: input.hideWhenOutOfStock || false,
          status: input.status || ProductStatus.DRAFT,
          isActive: input.isActive !== false,
          isFeatured: input.isFeatured || false,
          isPopular: input.isPopular || false,
          sortOrder: input.sortOrder || 0,
          instructions: input.instructions,
          keywords: input.keywords || [],
          isHandDelivery: input.isHandDelivery || false
        }
      });

      // Link SMM services to the new product
      if (input.smmServiceIds) {
        await linkSmmServices(tx, product.id, input.smmServiceIds);
      }

      // Create audit log
      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'Product',
          entityId: product.id,
          action: 'CREATE',
          newValue: {
            name: product.name,
            slug: product.slug,
            price: product.price.toString(),
            status: product.status,
            isActive: product.isActive,
            isHandDelivery: product.isHandDelivery,
            smmServiceIds: input.smmServiceIds || []
          }
        }
      });

      return tx.product.findUnique({
        where: { id: product.id },
        include: productDetailInclude
      });
    });

    if (!product) throw new Error('Failed to create product');

    const stockCounts = product.stock.reduce((acc, s) => {
      acc[s.status.toLowerCase()] = (acc[s.status.toLowerCase()] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      ...product,
      price: product.price.toString(),
      costPrice: product.costPrice?.toString() ?? null,
      markup: product.markup?.toString() ?? null,
      category: product.category,
      stockCount: {
        available: stockCounts.available || 0,
        reserved: stockCounts.reserved || 0,
        sold: stockCounts.sold || 0,
        disabled: stockCounts.disabled || 0
      }
    };
  }

  async updateProduct(id: string, input: UpdateProductInput, adminId: string): Promise<ProductWithDetails> {
    this.assertValidPrice(input.price);
    this.assertValidQuantities(input);

    const existingProduct = await this.prisma.product.findUnique({
      where: { id },
      include: { stock: { select: { status: true } } }
    });

    if (!existingProduct) {
      throw new Error('Product not found');
    }

    // Check if slug is being changed and if it conflicts
    if (input.slug && input.slug !== existingProduct.slug) {
      const existingSlug = await this.prisma.product.findUnique({ where: { slug: input.slug } });
      if (existingSlug) {
        throw new Error('Product with this slug already exists');
      }
    }

    // Verify category if being changed
    if (input.categoryId) {
      const category = await this.prisma.category.findUnique({ where: { id: input.categoryId } });
      if (!category) {
        throw new Error('Category not found');
      }
    }

    const product = await this.prisma.$transaction(async (tx) => {
      const oldValues = {
        name: existingProduct.name,
        slug: existingProduct.slug,
        price: existingProduct.price.toString(),
        maximumQuantity: existingProduct.maximumQuantity,
        status: existingProduct.status,
        isActive: existingProduct.isActive,
        isFeatured: existingProduct.isFeatured,
        isPopular: existingProduct.isPopular
      };

      const product = await tx.product.update({
        where: { id },
        data: {
          name: input.name,
          slug: input.slug,
          description: input.description,
          imageUrl: input.imageUrl,
          categoryId: input.categoryId,
          type: input.type,
          deliveryType: input.deliveryType,
          price: input.price,
          currency: input.currency,
          costPrice: input.costPrice,
          markup: input.markup,
          minimumQuantity: input.minimumQuantity,
          maximumQuantity: input.maximumQuantity,
          hideWhenOutOfStock: input.hideWhenOutOfStock,
          status: input.status,
          isActive: input.isActive,
          isFeatured: input.isFeatured,
          isPopular: input.isPopular,
          sortOrder: input.sortOrder,
          instructions: input.instructions,
          keywords: input.keywords,
          isHandDelivery: input.isHandDelivery
        }
      });

      // Replace the product's SMM service links with the selected set
      // (only when the admin explicitly sent smmServiceIds).
      if (input.smmServiceIds !== undefined) {
        await tx.smmService.updateMany({
          where: { productId: id },
          data: { productId: null }
        });
        if (input.smmServiceIds.length > 0) {
          await linkSmmServices(tx, id, input.smmServiceIds);
        }
      }

      // Create audit log
      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'Product',
          entityId: product.id,
          action: 'UPDATE',
          oldValue: oldValues,
          newValue: {
            name: product.name,
            slug: product.slug,
            price: product.price.toString(),
            maximumQuantity: product.maximumQuantity,
            status: product.status,
            isActive: product.isActive,
            isFeatured: product.isFeatured,
            isPopular: product.isPopular,
            isHandDelivery: product.isHandDelivery,
            smmServiceIds: input.smmServiceIds
          }
        }
      });

      return tx.product.findUnique({
        where: { id: product.id },
        include: productDetailInclude
      });
    });

    if (!product) throw new Error('Failed to update product');

    const stockCounts = product.stock.reduce((acc, s) => {
      acc[s.status.toLowerCase()] = (acc[s.status.toLowerCase()] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      ...product,
      price: product.price.toString(),
      costPrice: product.costPrice?.toString() ?? null,
      markup: product.markup?.toString() ?? null,
      category: product.category,
      stockCount: {
        available: stockCounts.available || 0,
        reserved: stockCounts.reserved || 0,
        sold: stockCounts.sold || 0,
        disabled: stockCounts.disabled || 0
      }
    };
  }

  async deleteProduct(id: string, adminId: string): Promise<void> {
    const existingProduct = await this.prisma.product.findUnique({
      where: { id }
    });

    if (!existingProduct) {
      throw new Error('Product not found');
    }

    // Historical orders, inventory, variants, licenses and SMM links must
    // never be destroyed. A product can only be hard-deleted when it has no
    // dependencies at all; otherwise the admin must disable or archive it.
    const [orderItemCount, stockCount, variantCount, licenseCount, smmServiceCount] = await Promise.all([
      this.prisma.orderItem.count({ where: { productId: id } }),
      this.prisma.productStock.count({ where: { productId: id } }),
      this.prisma.productVariant.count({ where: { productId: id } }),
      this.prisma.license.count({ where: { productId: id } }),
      this.prisma.smmService.count({ where: { productId: id } })
    ]);

    if (orderItemCount > 0) {
      throw new Error('This product has historical orders and cannot be deleted. Disable or archive it instead.');
    }

    if (stockCount > 0) {
      throw new Error(
        `This product has ${stockCount} inventory item${stockCount === 1 ? '' : 's'} and cannot be deleted. Disable or archive it instead.`
      );
    }

    if (variantCount > 0) {
      throw new Error('This product has variants and cannot be deleted. Disable or archive it instead.');
    }

    if (licenseCount > 0) {
      throw new Error('This product has license records and cannot be deleted. Disable or archive it instead.');
    }

    if (smmServiceCount > 0) {
      throw new Error('This product is linked to an SMM service and cannot be deleted. Disable or archive it instead.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.product.delete({ where: { id } });
      
      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'Product',
          entityId: id,
          action: 'DELETE',
          oldValue: {
            name: existingProduct.name,
            slug: existingProduct.slug
          }
        }
      });
    });
  }

  async duplicateProduct(id: string, adminId: string): Promise<ProductWithDetails> {
    const existing = await this.prisma.product.findUnique({
      where: { id },
      include: { stock: { select: { status: true } } }
    });

    if (!existing) {
      throw new Error('Product not found');
    }

    const copySlug = `${existing.slug}-copy`;
    let slug = copySlug;
    let counter = 1;
    while (await this.prisma.product.findUnique({ where: { slug } })) {
      slug = `${copySlug}-${counter}`;
      counter += 1;
    }

    const product = await this.prisma.$transaction(async (tx) => {
      const copy = await tx.product.create({
        data: {
          name: `${existing.name} (Copy)`,
          slug,
          description: existing.description,
          imageUrl: existing.imageUrl,
          categoryId: existing.categoryId,
          type: existing.type,
          deliveryType: existing.deliveryType,
          price: existing.price,
          currency: existing.currency,
          costPrice: existing.costPrice,
          markup: existing.markup,
          minimumQuantity: existing.minimumQuantity,
          maximumQuantity: existing.maximumQuantity,
          hideWhenOutOfStock: existing.hideWhenOutOfStock,
          status: ProductStatus.DRAFT,
          isActive: false,
          isFeatured: false,
          isPopular: false,
          sortOrder: 0,
          instructions: existing.instructions,
          keywords: existing.keywords,
          isHandDelivery: existing.isHandDelivery
        }
      });

      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'Product',
          entityId: copy.id,
          action: 'DUPLICATE',
          oldValue: { sourceProductId: id },
          newValue: {
            name: copy.name,
            slug: copy.slug,
            price: copy.price.toString(),
            status: copy.status
          }
        }
      });

      return tx.product.findUnique({
        where: { id: copy.id },
        include: {
          category: { select: { id: true, name: true, slug: true } },
          stock: { select: { status: true } }
        }
      });
    });

    if (!product) throw new Error('Failed to duplicate product');

    const stockCounts = product.stock.reduce((acc, s) => {
      acc[s.status.toLowerCase()] = (acc[s.status.toLowerCase()] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      ...product,
      price: product.price.toString(),
      costPrice: product.costPrice?.toString() ?? null,
      markup: product.markup?.toString() ?? null,
      category: product.category,
      stockCount: {
        available: stockCounts.available || 0,
        reserved: stockCounts.reserved || 0,
        sold: stockCounts.sold || 0,
        disabled: stockCounts.disabled || 0
      }
    };
  }

  async bulkUpdateProducts(ids: string[], action: 'ACTIVATE' | 'DEACTIVATE' | 'ARCHIVE' | 'CHANGE_CATEGORY', categoryId: string | undefined, adminId: string) {
    if (ids.length === 0 || ids.length > 100) {
      throw new Error('Select between 1 and 100 products');
    }

    if (action === 'CHANGE_CATEGORY') {
      if (!categoryId) {
        throw new Error('categoryId is required for CHANGE_CATEGORY');
      }
      const category = await this.prisma.category.findUnique({ where: { id: categoryId } });
      if (!category) {
        throw new Error('Category not found');
      }
    }

    const existing = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, slug: true }
    });

    if (existing.length !== ids.length) {
      throw new Error('One or more products were not found');
    }

    return this.prisma.$transaction(async (tx) => {
      let updatedCount = 0;

      for (const product of existing) {
        const update: Prisma.ProductUpdateInput = {};
        const newValue: { status?: string; isActive?: boolean; categoryId?: string } = {};

        switch (action) {
          case 'ACTIVATE':
            update.status = ProductStatus.ACTIVE;
            update.isActive = true;
            newValue.status = ProductStatus.ACTIVE;
            newValue.isActive = true;
            break;
          case 'DEACTIVATE':
            update.status = ProductStatus.DISABLED;
            update.isActive = false;
            newValue.status = ProductStatus.DISABLED;
            newValue.isActive = false;
            break;
          case 'ARCHIVE':
            update.status = ProductStatus.ARCHIVED;
            update.isActive = false;
            newValue.status = ProductStatus.ARCHIVED;
            newValue.isActive = false;
            break;
          case 'CHANGE_CATEGORY': {
            const targetCategoryId = categoryId as string;
            update.category = { connect: { id: targetCategoryId } };
            newValue.categoryId = targetCategoryId;
            break;
          }
        }

        await tx.product.update({
          where: { id: product.id },
          data: update
        });
        updatedCount += 1;

        await tx.auditLog.create({
          data: {
            adminId,
            entityType: 'Product',
            entityId: product.id,
            action: `BULK_${action}`,
            oldValue: { name: product.name },
            newValue
          }
        });
      }

      return { success: true, updatedCount };
    });
  }

  async activateProduct(id: string, adminId: string): Promise<ProductWithDetails> {
    return this.updateProduct(id, { status: ProductStatus.ACTIVE, isActive: true }, adminId);
  }

  async deactivateProduct(id: string, adminId: string): Promise<ProductWithDetails> {
    return this.updateProduct(id, { status: ProductStatus.DISABLED, isActive: false }, adminId);
  }

  async addStock(productId: string, deliveryType: DeliveryType, values: string[], adminId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new Error('Product not found');
    }

    const encryptedValues = values.map(v => ({
      productId,
      deliveryType,
      deliveryValue: encryptInventoryValue(v),
      status: 'AVAILABLE' as const
    }));

    await this.prisma.$transaction(async (tx) => {
      await tx.productStock.createMany({ data: encryptedValues });
      
      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'ProductStock',
          entityId: productId,
          action: 'ADD_STOCK',
          newValue: { count: values.length, deliveryType }
        }
      });
    });
  }
}
