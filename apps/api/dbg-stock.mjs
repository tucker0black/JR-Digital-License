import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({ log: ['error', 'warn'] });
const productId = '07925351-8d0e-4832-b7a0-3720c67aa820';
try {
  const p = await prisma.product.findUnique({ where: { id: productId } });
  console.log('product found:', !!p);
  const created = await prisma.productStock.createManyAndReturn({
    data: [{ productId, variantId: null, deliveryValue: 'encrypted-test', deliveryType: 'DIGITAL_LINK', status: 'AVAILABLE' }]
  });
  console.log('created:', created.length);
} catch (e) {
  console.log('ERROR:', e.message);
}
await prisma.$disconnect();