import crypto from 'node:crypto';
import { prisma } from '../infrastructure/prisma.js';
import { hashAdminToken } from '../middleware/admin-auth.js';

const PERMISSIONS = [
  'products:read',
  'products:create',
  'products:update',
  'products:delete',
  'categories:read',
  'categories:create',
  'categories:update',
  'categories:delete',
  'stock:read',
  'stock:manage',
  'orders:read',
  'orders:update',
  'payments:manage',
  'audit:read',
  'smm:read',
  'smm:create',
  'smm:manage',
  'users:read',
  'users:update',
  'wallet:read',
  'wallet:manage',
  'tickets:read',
  'tickets:update',
  'settings:read',
  'settings:update',
  'notifications:read',
  'notifications:manage'
] as const;

const ROLES: { key: string; name: string; description: string; permissions: readonly string[] }[] = [
  { key: 'SUPER_ADMIN', name: 'Super Admin', description: 'Full system access', permissions: PERMISSIONS },
  {
    key: 'ADMIN',
    name: 'Admin',
    description: 'Store management',
    permissions: [
      'products:read', 'products:create', 'products:update', 'products:delete',
      'categories:read', 'categories:create', 'categories:update', 'categories:delete',
      'stock:read', 'stock:manage',
      'orders:read', 'orders:update',
      'payments:manage',
      'audit:read',
      'smm:read', 'smm:create', 'smm:manage',
      'users:read', 'users:update',
      'wallet:read', 'wallet:manage',
      'tickets:read', 'tickets:update',
      'settings:read', 'settings:update',
      'notifications:read', 'notifications:manage'
    ]
  },
  {
    key: 'STAFF',
    name: 'Staff',
    description: 'Read-only store access',
    permissions: [
      'products:read', 'categories:read', 'stock:read', 'orders:read', 'audit:read', 'smm:read',
      'users:read', 'wallet:read', 'tickets:read', 'settings:read', 'notifications:read'
    ]
  },
  {
    key: 'SUPPORT',
    name: 'Support',
    description: 'Order visibility for support',
    permissions: [
      'products:read', 'categories:read', 'stock:read', 'orders:read', 'audit:read',
      'users:read', 'tickets:read', 'tickets:update'
    ]
  }
];

export function generateAdminToken(length = 32): string {
  return crypto.randomBytes(length).toString('base64url');
}

async function main() {
  const telegramIdRaw = process.env.ADMIN_TELEGRAM_ID;
  if (!telegramIdRaw) {
    throw new Error('ADMIN_TELEGRAM_ID environment variable is required (numeric Telegram user ID)');
  }
  const telegramId = BigInt(telegramIdRaw);

  const providedToken = process.env.ADMIN_API_TOKEN?.trim();
  const token = providedToken || generateAdminToken();

  await prisma.$transaction(async (tx) => {
    for (const key of PERMISSIONS) {
      await tx.permission.upsert({
        where: { key },
        create: { key, description: key },
        update: {}
      });
    }

    for (const role of ROLES) {
      await tx.role.upsert({
        where: { key: role.key },
        create: { key: role.key, name: role.name, description: role.description },
        update: { name: role.name, description: role.description }
      });
    }

    for (const role of ROLES) {
      const roleRecord = await tx.role.findUniqueOrThrow({ where: { key: role.key } });
      for (const permKey of role.permissions) {
        const permissionRecord = await tx.permission.findUniqueOrThrow({ where: { key: permKey } });
        await tx.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: roleRecord.id, permissionId: permissionRecord.id } },
          create: { roleId: roleRecord.id, permissionId: permissionRecord.id },
          update: {}
        });
      }
    }

    const superAdminRole = await tx.role.findUniqueOrThrow({ where: { key: 'SUPER_ADMIN' } });

    const admin = await tx.admin.upsert({
      where: { telegramId },
      create: {
        telegramId,
        username: process.env.ADMIN_USERNAME?.trim() || null,
        firstName: process.env.ADMIN_FIRST_NAME?.trim() || 'JR',
        lastName: process.env.ADMIN_LAST_NAME?.trim() || null,
        authTokenHash: hashAdminToken(token),
        status: 'ACTIVE'
      },
      update: {
        username: process.env.ADMIN_USERNAME?.trim() || undefined,
        firstName: process.env.ADMIN_FIRST_NAME?.trim() || 'JR',
        lastName: process.env.ADMIN_LAST_NAME?.trim() || undefined,
        authTokenHash: hashAdminToken(token),
        status: 'ACTIVE'
      }
    });

    await tx.adminRole.upsert({
      where: { adminId_roleId: { adminId: admin.id, roleId: superAdminRole.id } },
      create: { adminId: admin.id, roleId: superAdminRole.id },
      update: {}
    });
  });

  console.log('Seeded roles and permissions.');
  console.log(`Admin ready: telegramId=${telegramId} role=SUPER_ADMIN`);
  console.log('=== ADMIN API TOKEN (store securely, shown once) ===');
  console.log(token);
  console.log('=====================================================');
}

main()
  .then(() => {
    return prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error('Seed failed:', error instanceof Error ? error.message : error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });