import { botCommands, createBot } from './bot.js';
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

async function start(): Promise<void> {
  const config = loadBotConfig();
  const bot = createBot(config.token, config.miniAppUrl, config.apiUrl, config.apiSecret);

  process.once('SIGINT', () => bot.stop());
  process.once('SIGTERM', () => bot.stop());

  await bot.api.setMyCommands(botCommands);
  await configureMenuButton(bot, config.miniAppUrl);
  await bot.start({
    allowed_updates: ['message', 'callback_query'],
    onStart: (botInfo) => console.info(`Telegram bot started as @${botInfo.username}`)
  });
}

void start().catch((error: unknown) => {
  console.error('Telegram bot failed to start.', error);
  process.exitCode = 1;
});
