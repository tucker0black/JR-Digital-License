import type { PrismaClient } from '@prisma/client';
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

export interface AdminBootstrapEnv {
  ADMIN_TELEGRAM_ID?: string;
  ADMIN_API_TOKEN?: string;
  ADMIN_USERNAME?: string;
  ADMIN_FIRST_NAME?: string;
  ADMIN_LAST_NAME?: string;
}

export type AdminBootstrapResult =
  | { status: 'synced'; telegramId: bigint; created: boolean }
  | { status: 'skipped'; reason: 'MISSING_ADMIN_TELEGRAM_ID' | 'MISSING_ADMIN_API_TOKEN' | 'INVALID_ADMIN_TELEGRAM_ID' };

/**
 * Idempotently synchronize the SUPER_ADMIN bootstrap record from the
 * configured environment. Both the manual seed script and API startup use
 * this single implementation so a rotated ADMIN_API_TOKEN always matches
 * Admin.authTokenHash after the next deploy/restart.
 *
 * Secrets are never returned or logged here: only identifiers and flags.
 * Synchronization runs ONLY when both ADMIN_TELEGRAM_ID and ADMIN_API_TOKEN
 * are configured; a random token is intentionally never generated at boot.
 */
export async function ensureAdminBootstrap(
  prisma: PrismaClient,
  env: AdminBootstrapEnv = process.env
): Promise<AdminBootstrapResult> {
  const telegramIdRaw = env.ADMIN_TELEGRAM_ID?.trim();
  const providedToken = env.ADMIN_API_TOKEN?.trim();

  if (!telegramIdRaw) {
    return { status: 'skipped', reason: 'MISSING_ADMIN_TELEGRAM_ID' };
  }
  if (!providedToken) {
    return { status: 'skipped', reason: 'MISSING_ADMIN_API_TOKEN' };
  }

  let telegramId: bigint;
  try {
    telegramId = BigInt(telegramIdRaw);
  } catch {
    return { status: 'skipped', reason: 'INVALID_ADMIN_TELEGRAM_ID' };
  }

  return prisma.$transaction(async (tx): Promise<AdminBootstrapResult> => {
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
        username: env.ADMIN_USERNAME?.trim() || null,
        firstName: env.ADMIN_FIRST_NAME?.trim() || 'JR',
        lastName: env.ADMIN_LAST_NAME?.trim() || null,
        authTokenHash: hashAdminToken(providedToken),
        status: 'ACTIVE'
      },
      update: {
        username: env.ADMIN_USERNAME?.trim() || undefined,
        firstName: env.ADMIN_FIRST_NAME?.trim() || 'JR',
        lastName: env.ADMIN_LAST_NAME?.trim() || undefined,
        authTokenHash: hashAdminToken(providedToken),
        status: 'ACTIVE'
      }
    });

    await tx.adminRole.upsert({
      where: { adminId_roleId: { adminId: admin.id, roleId: superAdminRole.id } },
      create: { adminId: admin.id, roleId: superAdminRole.id },
      update: {}
    });

    return { status: 'synced', telegramId, created: false };
  });
}
