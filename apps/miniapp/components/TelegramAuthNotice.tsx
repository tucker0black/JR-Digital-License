'use client';

import { useTelegramAuth } from '@/components/TelegramProvider';

export function TelegramAuthNotice() {
  const { status } = useTelegramAuth();

  return (
    <div className="flex min-h-[280px] items-center justify-center rounded-2xl border border-line bg-card px-6 text-center">
      <div>
        <p className="text-lg font-semibold text-ink">
          {status === 'loading' ? 'Preparing Telegram authentication...' : 'Telegram authentication unavailable'}
        </p>
        <p className="mt-2 text-sm text-soft">
          {status === 'loading'
            ? 'Please wait while your Telegram account is verified.'
            : 'Reopen JR Digital license from the Telegram bot and try again.'}
        </p>
      </div>
    </div>
  );
}
