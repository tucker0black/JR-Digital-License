import { describe, expect, it } from 'vitest';
import { appName, createProductRequestSchema, healthResponseSchema, productSchema } from './index.js';

describe('shared foundation', () => {
  it('exposes the official application name', () => {
    expect(appName).toBe('JR Digital license');
  });

  it('validates the health response contract', () => {
    expect(
      healthResponseSchema.safeParse({
        status: 'ok',
        service: 'api',
        timestamp: '2026-01-01T00:00:00.000Z'
      }).success
    ).toBe(true);
  });

  it('allows an unconfigured product maximum quantity', () => {
    expect(productSchema.shape.maximumQuantity.safeParse(null).success).toBe(true);
    expect(createProductRequestSchema.shape.maximumQuantity.safeParse(null).success).toBe(true);
  });
});
