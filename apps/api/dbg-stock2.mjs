import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const count = await prisma.productStock.count();
console.log('productStock rows:', count);
const sample = await prisma.productStock.findFirst({ select: { id: true, deliveryValue: true, status: true } });
console.log('sample:', JSON.stringify(sample));
await prisma.$disconnect();