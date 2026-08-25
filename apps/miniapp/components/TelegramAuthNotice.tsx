'use client';

import { useTelegramAuth } from '@/components/TelegramProvider';
import { useTranslation } from '@/lib/i18n';

export function TelegramAuthNotice() {
  const { status } = useTelegramAuth();
  const { t } = useTranslation();

  return (
    <div className="flex min-h-[280px] items-center justify-center rounded-2xl card-cosmic px-6 text-center">
      <div>
        <p className="text-lg font-semibold text-ink">
          {status === 'loading' ? t('auth.preparing') : t('auth.unavailable')}
        </p>
        <p className="mt-2 text-sm text-soft">
          {status === 'loading'
            ? t('auth.pleaseWait')
            : t('auth.reopen')}
        </p>
      </div>
    </div>
  );
}
