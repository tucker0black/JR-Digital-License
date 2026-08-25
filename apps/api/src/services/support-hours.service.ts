import type { SupportAvailability } from '@jr/shared';

const DEFAULT_OPEN_TIME = '08:00';
const DEFAULT_CLOSE_TIME = '20:00';
// Default timezone is UTC+7 (Indochina Time). Configure via
// SUPPORT_TIMEZONE_OFFSET_MINUTES for a different offset.
const DEFAULT_TIMEZONE_OFFSET_MINUTES = 420;

export class SupportAvailabilityService {
  get openTime(): string {
    return process.env.SUPPORT_OPEN_TIME ?? DEFAULT_OPEN_TIME;
  }

  get closeTime(): string {
    return process.env.SUPPORT_CLOSE_TIME ?? DEFAULT_CLOSE_TIME;
  }

  get timezoneOffsetMinutes(): number {
    const raw = Number(process.env.SUPPORT_TIMEZONE_OFFSET_MINUTES ?? DEFAULT_TIMEZONE_OFFSET_MINUTES);
    return Number.isFinite(raw) ? raw : DEFAULT_TIMEZONE_OFFSET_MINUTES;
  }

  get timezoneLabel(): string {
    const offset = this.timezoneOffsetMinutes;
    const sign = offset >= 0 ? '+' : '-';
    const abs = Math.abs(offset);
    const hours = Math.floor(abs / 60);
    const minutes = abs % 60;
    return `UTC${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  isOpen(now: Date = new Date()): boolean {
    const { openMinutes, closeMinutes, currentMinutes } = this.boundaries(now);
    return currentMinutes >= openMinutes && currentMinutes < closeMinutes;
  }

  getAvailability(now: Date = new Date()): SupportAvailability {
    return {
      isOpen: this.isOpen(now),
      openTime: this.openTime,
      closeTime: this.closeTime,
      timezoneLabel: this.timezoneLabel,
      serverTime: now.toISOString()
    };
  }

  buildBlockedMessage(): string {
    return `Support is currently offline (${this.openTime}–${this.closeTime} ${this.timezoneLabel}). You can send one message and our team will reply when support opens.`;
  }

  private boundaries(now: Date): { openMinutes: number; closeMinutes: number; currentMinutes: number } {
    const parse = (value: string): number => {
      const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
      if (!match) return 0;
      return Number(match[1]) * 60 + Number(match[2]);
    };

    const openMinutes = parse(this.openTime);
    const closeMinutes = parse(this.closeTime);
    // Convert the server's local time into the configured support timezone.
    const currentMinutes = (now.getUTCHours() * 60 + now.getUTCMinutes() + this.timezoneOffsetMinutes) % 1440;

    return { openMinutes, closeMinutes, currentMinutes };
  }
}