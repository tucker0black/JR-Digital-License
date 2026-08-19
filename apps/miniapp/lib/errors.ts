export function humanizeError(context: string, err: unknown): string {
  const message = err instanceof Error && err.message ? err.message : 'Unknown error';
  if (message === 'Failed to fetch' || message === 'fetch failed' || /^network/i.test(message)) {
    return `${context} — network error. Please check your connection and try again.`;
  }
  return `${context}: ${message}`;
}