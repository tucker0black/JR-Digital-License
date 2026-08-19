import crypto from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../infrastructure/prisma.js';

export function hashAdminToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const REQUEST_ADMIN_KEY = Symbol('jrAuthenticatedAdmin');

export interface AdminUser {
  id: string;
  telegramId: bigint;
  username: string | null;
  firstName: string;
  lastName: string | null;
  roles: string[];
  permissions: string[];
}

export interface AdminAuthConfig {
  requiredRoles?: string[];
  requiredPermissions?: string[];
}

type AdminRequest = FastifyRequest & { [REQUEST_ADMIN_KEY]?: AdminUser };

function assertAdminConfig(admin: AdminUser, config?: AdminAuthConfig, reply?: FastifyReply): void {
  if (config?.requiredRoles && config.requiredRoles.length > 0) {
    const hasRole = config.requiredRoles.some((role) => admin.roles.includes(role));
    if (!hasRole) {
      reply?.status(403).send({ error: 'Insufficient permissions: required role not found' });
      throw new Error('Insufficient permissions: required role not found');
    }
  }

  if (config?.requiredPermissions && config.requiredPermissions.length > 0) {
    const hasPermission = config.requiredPermissions.some((perm) => admin.permissions.includes(perm));
    if (!hasPermission) {
      reply?.status(403).send({ error: 'Insufficient permissions: required permission not found' });
      throw new Error('Insufficient permissions: required permission not found');
    }
  }
}

export async function authenticateAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  config?: AdminAuthConfig
): Promise<AdminUser> {
  const adminRequest = request as AdminRequest;

  // A single admin request may invoke this twice (preHandler + handler).
  // Reuse the authenticated identity resolved for this request.
  if (adminRequest[REQUEST_ADMIN_KEY]) {
    assertAdminConfig(adminRequest[REQUEST_ADMIN_KEY], config, reply);
    return adminRequest[REQUEST_ADMIN_KEY];
  }

  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.status(401).send({ error: 'Missing or invalid admin authorization' });
    throw new Error('Missing or invalid admin authorization');
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    reply.status(401).send({ error: 'Missing or invalid admin authorization' });
    throw new Error('Missing or invalid admin authorization');
  }

  // The presented token must resolve to exactly one admin record.
  // Tokens are never stored or compared in plaintext.
  const admin = await prisma.admin.findUnique({
    where: { authTokenHash: hashAdminToken(token) },
    include: {
      roles: {
        include: {
          role: {
            include: {
              permissions: {
                include: {
                  permission: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!admin || admin.status !== 'ACTIVE') {
    reply.status(403).send({ error: 'Invalid admin token' });
    throw new Error('Invalid admin token');
  }

  const roles = admin.roles.map((ar) => ar.role.key);
  const permissions = admin.roles.flatMap((ar) =>
    ar.role.permissions.map((rp) => rp.permission.key)
  );

  const adminUser: AdminUser = {
    id: admin.id,
    telegramId: admin.telegramId,
    username: admin.username,
    firstName: admin.firstName,
    lastName: admin.lastName,
    roles,
    permissions,
  };

  assertAdminConfig(adminUser, config, reply);

  adminRequest[REQUEST_ADMIN_KEY] = adminUser;
  return adminUser;
}

// Helper to create admin auth middleware with specific requirements
export function requireAdmin(config?: AdminAuthConfig) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await authenticateAdmin(request, reply, config);
  };
}