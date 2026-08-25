import crypto from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { User } from '@prisma/client';
import { prisma } from '../infrastructure/prisma.js';
import { SecurityService } from '../services/security.service.js';

const securityService = new SecurityService(prisma);

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

export interface ValidatedInitData {
  user: TelegramUser;
  auth_date: number;
  hash: string;
}

function validateTelegramInitData(initData: string, botToken: string): ValidatedInitData | null {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  params.delete('hash');

  if (!hash) {
    return null;
  }

  // Dev-signed initData (created by /api/dev/auth) carries a dev=1 marker.
  // It must only ever authenticate when development auth is explicitly enabled,
  // so a dev identity can never be accepted as a real Telegram customer.
  if (params.get('dev') === '1' && process.env.DEV_AUTH_ENABLED !== 'true') {
    return null;
  }

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const providedHash = Buffer.from(hash, 'hex');
  const expectedHash = Buffer.from(calculatedHash, 'hex');
  if (providedHash.length !== expectedHash.length || !crypto.timingSafeEqual(providedHash, expectedHash)) {
    return null;
  }

  const authDate = Number(params.get('auth_date'));
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(authDate) || authDate <= 0 || authDate > now + 60 || now - authDate > 86400) {
    return null;
  }

  const userParam = params.get('user');
  if (!userParam) {
    return null;
  }

  let user: TelegramUser;
  try {
    user = JSON.parse(userParam);
  } catch {
    return null;
  }

  return { user, auth_date: authDate, hash };
}

export async function authenticateTelegramUser(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<{ user: TelegramUser; dbUser: User; created: boolean }> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    reply.status(500).send({ error: 'Bot token not configured' });
    throw new Error('Bot token not configured');
  }

  const initData = request.headers['x-telegram-init-data'] as string;
  if (!initData) {
    reply.status(401).send({ error: 'Missing Telegram init data' });
    throw new Error('Missing Telegram init data');
  }

  const validated = validateTelegramInitData(initData, botToken);
  if (!validated) {
    await securityService.record({
      eventType: 'AUTH_INVALID_INIT_DATA',
      ip: request.ip
    });
    reply.status(401).send({ error: 'Invalid Telegram init data' });
    throw new Error('Invalid Telegram init data');
  }

  const telegramId = BigInt(validated.user.id);

  let dbUser = await prisma.user.findUnique({
    where: { telegramId }
  });

  let created = false;

  if (!dbUser) {
    dbUser = await prisma.user.create({
      data: {
        telegramId,
        username: validated.user.username ?? null,
        firstName: validated.user.first_name,
        lastName: validated.user.last_name ?? null,
        photoUrl: validated.user.photo_url ?? null,
        languageCode: validated.user.language_code ?? null,
        status: 'ACTIVE',
        lastSeenAt: new Date()
      }
    });
    created = true;
  } else if (dbUser.status !== 'ACTIVE') {
    await securityService.record({
      eventType: 'AUTH_SUSPENDED_ACCOUNT',
      ip: request.ip,
      userId: dbUser.id,
      metadata: { status: dbUser.status }
    });
    reply.status(403).send({ error: 'Account suspended' });
    throw new Error('Account suspended');
  } else {
    const refreshedUser = await prisma.user.update({
      where: { id: dbUser.id },
      data: {
        username: validated.user.username ?? dbUser.username,
        firstName: validated.user.first_name,
        lastName: validated.user.last_name ?? dbUser.lastName,
        photoUrl: validated.user.photo_url ?? dbUser.photoUrl,
        languageCode: validated.user.language_code ?? dbUser.languageCode,
        lastSeenAt: new Date()
      }
    });
    if (refreshedUser) {
      dbUser = refreshedUser;
    }
  }

  return { user: validated.user, dbUser, created };
}

export function optionalAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  done: () => void
): void {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    done();
    return;
  }

  const initData = request.headers['x-telegram-init-data'] as string;
  if (!initData) {
    done();
    return;
  }

  const validated = validateTelegramInitData(initData, botToken);
  if (!validated) {
    done();
    return;
  }

  (request as FastifyRequest & { telegramUser?: TelegramUser }).telegramUser = validated.user;
  done();
}
