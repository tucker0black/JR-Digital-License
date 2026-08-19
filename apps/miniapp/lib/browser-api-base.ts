const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Keep browser requests on the Mini App origin when the API is local. A
 * localhost URL embedded in a public Telegram WebView points at the user's
 * device, not the machine running the API.
 */
export function resolveBrowserApiBase(configuredValue?: string): string {
  if (typeof window === 'undefined') return '';

  const configured = configuredValue?.trim();
  if (!configured) return '';

  try {
    const configuredUrl = new URL(configured, window.location.origin);
    if (configuredUrl.origin === window.location.origin) return '';

    if (
      LOCAL_HOSTNAMES.has(configuredUrl.hostname) ||
      LOCAL_HOSTNAMES.has(window.location.hostname)
    ) {
      return '';
    }

    return configured.replace(/\/$/, '');
  } catch {
    return '';
  }
}
