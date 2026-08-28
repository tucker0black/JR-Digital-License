interface TelegramWebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

interface TelegramBackButton {
  show: () => void;
  hide: () => void;
  onClick: (callback: () => void) => void;
  offClick: (callback: () => void) => void;
}

interface TelegramWebApp {
  initData?: string;
  initDataUnsafe?: {
    user?: TelegramWebAppUser;
    auth_date?: number;
    hash?: string;
    query_id?: string;
  };
  colorScheme?: 'light' | 'dark';
  ready?: () => void;
  openLink?: (url: string, options?: { try_instant_view?: boolean }) => void;
  openTelegramLink?: (url: string) => void;
  BackButton?: TelegramBackButton;
}

interface Window {
  Telegram?: {
    WebApp?: TelegramWebApp;
  };
}
