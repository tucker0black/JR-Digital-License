'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { clearLegacyTelegramInitDataCookie } from '@/lib/api';

export type TelegramRuntimeStatus = 'loading' | 'ready' | 'unavailable';

const TelegramAuthContext = createContext<{ status: TelegramRuntimeStatus }>({ status: 'loading' });

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function isLocalDevelopmentBrowser(): boolean {
  return LOCAL_HOSTNAMES.has(window.location.hostname) && process.env.NEXT_PUBLIC_DEV_AUTH_ENABLED === 'true';
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function waitForTelegramWebApp(): Promise<NonNullable<Window['Telegram']>['WebApp'] | undefined> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const webApp = window.Telegram?.WebApp;
    if (webApp) return webApp;
    await wait(100);
  }
  return undefined;
}

function logSafeTelegramRuntime(webApp: TelegramWebApp | undefined): void {
  if (process.env.NODE_ENV === 'production') return;
  const user = webApp?.initDataUnsafe?.user;
  console.info('[telegram] runtime', {
    hasTelegram: Boolean(window.Telegram),
    hasWebApp: Boolean(webApp),
    hasInitData: Boolean(webApp?.initData),
    telegramId: user?.id ?? null,
    firstName: user?.first_name ?? null,
    lastName: user?.last_name ?? null,
    username: user?.username ?? null
  });
}

export function TelegramProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<TelegramRuntimeStatus>('loading');

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      clearLegacyTelegramInitDataCookie();

      if (isLocalDevelopmentBrowser() && !window.Telegram) {
        if (!cancelled) setStatus('ready');
        return;
      }

      const webApp = await waitForTelegramWebApp();
      if (cancelled) return;

      if (!webApp?.initData) {
        logSafeTelegramRuntime(webApp);
        setStatus('unavailable');
        return;
      }

      webApp.ready?.();
      logSafeTelegramRuntime(webApp);
      setStatus('ready');
    };

    void initialize();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <TelegramAuthContext.Provider value={{ status }}>
      {children}
    </TelegramAuthContext.Provider>
  );
}

export function useTelegramAuth(): { status: TelegramRuntimeStatus } {
  return useContext(TelegramAuthContext);
}
