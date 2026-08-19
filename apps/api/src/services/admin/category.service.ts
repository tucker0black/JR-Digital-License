import type { PrismaClient } from '@prisma/client';

export interface CreateCategoryInput {
  name: string;
  slug?: string;
  description?: string;
  icon?: string;
  imageUrl?: string;
  isActive?: boolean;
  isArchived?: boolean;
  sortOrder?: number;
}

export interface UpdateCategoryInput {
  name?: string;
  slug?: string;
  description?: string | null;
  icon?: string | null;
  imageUrl?: string | null;
  isActive?: boolean;
  isArchived?: boolean;
  sortOrder?: number;
}

export interface CategoryFilters {
  search?: string;
  isActive?: boolean;
  isArchived?: boolean;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface CategoryWithProducts {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  imageUrl: string | null;
  isActive: boolean;
  isArchived: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  productCount: number;
}

export class CategoryService {
  constructor(private prisma: PrismaClient) {}

  async getCategories(filters: CategoryFilters = {}) {
    const {
      search,
      isActive,
      isArchived,
      page = 1,
      pageSize = 20,
      sortBy = 'sortOrder',
      sortOrder = 'asc'
    } = filters;

    const pageNum = Math.max(1, page);
    const pageSizeNum = Math.min(100, Math.max(1, pageSize));
    const skip = (pageNum - 1) * pageSizeNum;

    const where: Record<string, unknown> = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (isArchived !== undefined) {
      where.isArchived = isArchived;
    }

    const orderBy: Record<string, string> = { [sortBy]: sortOrder };

    const [categories, total] = await Promise.all([
      this.prisma.category.findMany({
        where,
        skip,
        take: 100,
        orderBy,
        include: {
          _count: { select: { products: true } }
        }
      }),
      this.prisma.category.count({ where })
    ]);

    const categoriesWithCount = categories.map(category => ({
      ...category,
      productCount: category._count.products,
      _count: undefined
    }));

    return {
      categories: categoriesWithCount,
      total,
      page: Math.max(1, page),
      pageSize: Math.min(100, Math.max(1, 20))
    };
  }

  async getCategoryById(id: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: {
        _count: { select: { products: true } },
        products: {
          where: { isActive: true, status: 'ACTIVE' },
          select: { id: true, name: true, slug: true, price: true, currency: true, imageUrl: true, status: true },
          take: 10
        }
      }
    });

    if (!category) return null;

    return {
      ...category,
      productCount: category._count.products,
      _count: undefined
    };
  }

  async getCategoryBySlug(slug: string) {
    const category = await this.prisma.category.findUnique({
      where: { slug },
      include: {
        _count: { select: { products: true } },
        products: {
          where: { isActive: true, status: 'ACTIVE' },
          select: { id: true, name: true, slug: true, price: true, currency: true, imageUrl: true, status: true },
          take: 10
        }
      }
    });

    if (!category) return null;

    return {
      ...category,
      productCount: category._count.products,
      _count: undefined
    };
  }

  async createCategory(input: CreateCategoryInput, adminId: string) {
    const slug = input.slug || input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    const existingSlug = await this.prisma.category.findUnique({ where: { slug } });
    if (existingSlug) {
      throw new Error('Category with this slug already exists');
    }

    const category = await this.prisma.$transaction(async (tx) => {
      const category = await tx.category.create({
        data: {
          name: input.name,
          slug,
          description: input.description,
          icon: input.icon,
          imageUrl: input.imageUrl,
          isActive: input.isActive !== false,
          isArchived: input.isArchived || false,
          sortOrder: input.sortOrder || 0
        }
      });

      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'Category',
          entityId: category.id,
          action: 'CREATE',
          newValue: {
            name: category.name,
            slug: category.slug,
            isActive: category.isActive,
            isArchived: category.isArchived
          }
        }
      });

      return tx.category.findUnique({
        where: { id: category.id },
        include: { _count: { select: { products: true } } }
      });
    });

    if (!category) throw new Error('Failed to create category');

    return {
      ...category,
      productCount: category._count.products,
      _count: undefined
    };
  }

  async updateCategory(id: string, input: UpdateCategoryInput, adminId: string) {
    const existingCategory = await this.prisma.category.findUnique({ where: { id } });

    if (!existingCategory) {
      throw new Error('Category not found');
    }

    if (input.slug && input.slug !== existingCategory.slug) {
      const existingSlug = await this.prisma.category.findUnique({ where: { slug: input.slug } });
      if (existingSlug) {
        throw new Error('Category with this slug already exists');
      }
    }

    const category = await this.prisma.$transaction(async (tx) => {
      const oldValues = {
        name: existingCategory.name,
        slug: existingCategory.slug,
        isActive: existingCategory.isActive,
        isArchived: existingCategory.isArchived
      };

      const category = await tx.category.update({
        where: { id },
        data: {
          name: input.name,
          slug: input.slug,
          description: input.description,
          icon: input.icon,
          imageUrl: input.imageUrl,
          isActive: input.isActive,
          isArchived: input.isArchived,
          sortOrder: input.sortOrder
        }
      });

      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'Category',
          entityId: category.id,
          action: 'UPDATE',
          oldValue: oldValues,
          newValue: {
            name: category.name,
            slug: category.slug,
            isActive: category.isActive,
            isArchived: category.isArchived
          }
        }
      });

      return tx.category.findUnique({
        where: { id: category.id },
        include: { _count: { select: { products: true } } }
      });
    });

    if (!category) throw new Error('Failed to update category');

    return {
      ...category,
      productCount: category._count.products,
      _count: undefined
    };
  }

  async deleteCategory(id: string, adminId: string) {
    const existingCategory = await this.prisma.category.findUnique({ where: { id } });

    if (!existingCategory) {
      throw new Error('Category not found');
    }

    const productCount = await this.prisma.product.count({ where: { categoryId: id } });
    if (productCount > 0) {
      throw new Error('Cannot delete category with existing products');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.category.delete({ where: { id } });
      
      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'Category',
          entityId: id,
          action: 'DELETE',
          oldValue: {
            name: existingCategory.name,
            slug: existingCategory.slug
          }
        }
      });
    });
  }

  async activateCategory(id: string, adminId: string) {
    return this.updateCategory(id, { isActive: true, isArchived: false }, adminId);
  }

  async deactivateCategory(id: string, adminId: string) {
    return this.updateCategory(id, { isActive: false }, adminId);
  }

  async archiveCategory(id: string, adminId: string) {
    return this.updateCategory(id, { isArchived: true, isActive: false }, adminId);
  }

  async reorderCategories(categoryOrders: { id: string; sortOrder: number }[], adminId: string) {
    await this.prisma.$transaction(async (tx) => {
      for (const { id, sortOrder } of categoryOrders) {
        await tx.category.update({
          where: { id },
          data: { sortOrder }
        });
      }

      await tx.auditLog.create({
        data: {
          adminId,
          entityType: 'Category',
          action: 'REORDER',
          newValue: { categories: categoryOrders }
        }
      });
    });
  }
}