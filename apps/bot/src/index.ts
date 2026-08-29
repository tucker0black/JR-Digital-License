import { botCommands, botCommandsKm, createBot } from './bot.js';
import { loadBotConfig } from './config.js';

const MENU_BUTTON_TEXT = '🛍 Open Mini App';

async function configureMenuButton(bot: ReturnType<typeof createBot>, miniAppUrl: string): Promise<void> {
  try {
    await bot.api.setChatMenuButton({
      menu_button: {
        type: 'web_app',
        text: MENU_BUTTON_TEXT,
        web_app: { url: miniAppUrl }
      }
    });
    console.info('Telegram menu button configured to open the Mini App.');
  } catch (error) {
    console.warn('Failed to configure the Telegram menu button.', error);
  }
}

const RESTART_RETRY_MS = 30_000;

async function start(): Promise<void> {
  const config = loadBotConfig();
  const bot = createBot(config.token, config.miniAppUrl, config.apiUrl, config.apiSecret);

  process.once('SIGINT', () => bot.stop());
  process.once('SIGTERM', () => bot.stop());

  await bot.api.setMyCommands(botCommands);
  // Khmer command descriptions for Telegram clients set to Khmer.
  try {
    await bot.api.setMyCommands(botCommandsKm, { language_code: 'km' });
  } catch (error) {
    console.warn('Failed to register Khmer command descriptions.', error);
  }
  await configureMenuButton(bot, config.miniAppUrl);

  // A second polling instance anywhere (an forgotten `pnpm dev` on another
  // machine, a stale deployment) makes Telegram answer getUpdates with 409.
  // Instead of crash-looping, stay alive and retry so this service takes over
  // polling automatically as soon as the competing instance stops.
  for (;;) {
    try {
      await bot.start({
        allowed_updates: ['message', 'callback_query'],
        onStart: (botInfo) => console.info(`Telegram bot started as @${botInfo.username}`)
      });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/409|Conflict|terminated by other getUpdates/i.test(message)) {
        throw error;
      }
      console.warn(
        'getUpdates conflict: another bot instance is polling with this token. ' +
          'Retrying in 30s — stop the duplicate instance to let this service take over.'
      );
      await new Promise((resolve) => setTimeout(resolve, RESTART_RETRY_MS));
    }
  }
}

void start().catch((error: unknown) => {
  console.error('Telegram bot failed to start.', error);
  process.exitCode = 1;
});
