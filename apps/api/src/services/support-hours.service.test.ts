import { afterEach, describe, expect, it, vi } from 'vitest';
import { SupportAvailabilityService } from './support-hours.service.js';

describe('SupportAvailabilityService', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.SUPPORT_OPEN_TIME;
    delete process.env.SUPPORT_CLOSE_TIME;
    delete process.env.SUPPORT_TIMEZONE_OFFSET_MINUTES;
  });

  it('is open at 09:00 UTC+7 with default hours', () => {
    const service = new SupportAvailabilityService();
    expect(service.isOpen(new Date('2026-08-20T02:00:00Z'))).toBe(true);
  });

  it('is closed at 02:00 UTC+7 with default hours', () => {
    const service = new SupportAvailabilityService();
    expect(service.isOpen(new Date('2026-08-20T19:00:00Z'))).toBe(false);
  });

  it('is closed before opening time', () => {
    const service = new SupportAvailabilityService();
    expect(service.isOpen(new Date('2026-08-20T00:30:00Z'))).toBe(false);
  });

  it('honors configured open/close times and timezone', () => {
    process.env.SUPPORT_OPEN_TIME = '09:00';
    process.env.SUPPORT_CLOSE_TIME = '17:00';
    process.env.SUPPORT_TIMEZONE_OFFSET_MINUTES = '0';

    const service = new SupportAvailabilityService();
    expect(service.isOpen(new Date('2026-08-20T10:00:00Z'))).toBe(true);
    expect(service.isOpen(new Date('2026-08-20T18:00:00Z'))).toBe(false);
  });

  it('returns the availability contract', () => {
    const service = new SupportAvailabilityService();
    const availability = service.getAvailability(new Date('2026-08-20T02:00:00Z'));

    expect(availability).toMatchObject({
      isOpen: true,
      openTime: '08:00',
      closeTime: '20:00',
      timezoneLabel: 'UTC+07:00'
    });
    expect(availability.serverTime).toBe('2026-08-20T02:00:00.000Z');
  });

  it('builds a blocked message that explains the hours', () => {
    const service = new SupportAvailabilityService();
    expect(service.buildBlockedMessage()).toContain('08:00');
    expect(service.buildBlockedMessage()).toContain('20:00');
    expect(service.buildBlockedMessage()).toContain('one message');
  });
});