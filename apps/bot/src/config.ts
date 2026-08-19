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
  const apiUrl = environment.NEXT_PUBLIC_API_URL?.trim();
  const apiSecret = environment.BOT_SECRET?.trim();

  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN must be configured before starting the Telegram bot.');
  }

  if (!miniAppUrl) {
    throw new Error('MINIAPP_URL (or APP_URL) must be configured before starting the Telegram bot.');
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
  };
}
