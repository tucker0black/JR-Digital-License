import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

describe('Prisma database foundation', () => {
  it('includes the production domain models in the generated client', () => {
    const modelNames = Prisma.dmmf.datamodel.models.map((model) => model.name);

    expect(modelNames).toEqual(
      expect.arrayContaining([
        'User',
        'Product',
        'ProductStock',
        'Order',
        'Payment',
        'Wallet',
        'SmmProvider',
        'SupportTicket',
        'AuditLog'
      ])
    );
  });
});
