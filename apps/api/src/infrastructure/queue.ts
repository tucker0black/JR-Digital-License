import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export function createRedisConnection(redisUrl = process.env.REDIS_URL): Redis {
  if (!redisUrl) {
    throw new Error('REDIS_URL is required when a Redis-backed queue is started.');
  }

  return new Redis(redisUrl, { maxRetriesPerRequest: null });
}

export function createFoundationQueue(connection: Redis): Queue {
  return new Queue('jr-foundation', { connection });
}
