const SUPPORT_TELEGRAM_URL = process.env.NEXT_PUBLIC_SUPPORT_TELEGRAM_URL?.trim() ?? '';

export function getSupportTelegramUrl(): string | null {
  if (!SUPPORT_TELEGRAM_URL) return null;
  try {
    const url = new URL(SUPPORT_TELEGRAM_URL);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function getOrderSupportUrl(orderNumber: number): string | null {
  const base = getSupportTelegramUrl();
  if (!base) return null;
  try {
    const url = new URL(base);
    const text = `Order: #${orderNumber}`;
    url.searchParams.set('text', text);
    return url.toString();
  } catch {
    return null;
  }
}
