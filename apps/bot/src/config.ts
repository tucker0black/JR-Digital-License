export type BotConfig = Readonly<{
  token: string;
  miniAppUrl: string;
  apiUrl: string;
  apiSecret: string;
}>;

type Environment = NodeJS.ProcessEnv;

export function loadBotConfig(environment: Environment = process.env): BotConfig {
  const token = environment.TELEGRAM_BOT_TOKEN?.trim();
  const miniAppUrl = environment.MINIAPP_URL?.trim() || environment.APP_URL?.trim();
  const apiSecret = environment.BOT_SECRET?.trim();

  // The internal-API base must be explicit in production: a silent localhost
  // fallback inside a container makes Balance/Orders/language calls fail with
  // connection errors that only surface as "temporarily unavailable" to users.
  const isProduction = environment.NODE_ENV === 'production';
  const apiUrl = environment.NEXT_PUBLIC_API_URL?.trim();
  if (!apiUrl) {
    if (isProduction) {
      throw new Error(
        'NEXT_PUBLIC_API_URL must be configured in production so the bot can reach the JR Digital license API.'
      );
    }
    console.warn('NEXT_PUBLIC_API_URL is not set — falling back to http://localhost:4000 for local development.');
  }

  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN must be configured before starting the Telegram bot.');
  }

  if (!miniAppUrl) {
    throw new Error('MINIAPP_URL (or APP_URL) must be configured before starting the Telegram bot.');
  }

  if (!apiSecret && isProduction) {
    throw new Error(
      'BOT_SECRET must match the API service value in production; /api/internal/bot/* rejects requests without it.'
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(miniAppUrl);
  } catch {
    throw new Error('MINIAPP_URL (or APP_URL) must be a valid absolute URL.');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('MINIAPP_URL (or APP_URL) must use HTTP or HTTPS.');
  }

  return {
    token,
    miniAppUrl: parsedUrl.toString(),
    apiUrl: apiUrl ?? 'http://localhost:4000',
    apiSecret: apiSecret ?? ''
  };}
