'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

const NAV_HISTORY_KEY = 'jr_in_app_navigation';

function hasUsableHistory(): boolean {
  if (typeof window === 'undefined') return false;
  return sessionStorage.getItem(NAV_HISTORY_KEY) === '1' && window.history.length > 1;
}

export function BackButton() {
  const pathname = usePathname();
  const router = useRouter();
  const [showFallback, setShowFallback] = useState(false);

  const isHome = pathname === '/';

  const goBack = useCallback(() => {
    if (hasUsableHistory()) {
      router.back();
    } else {
      router.replace('/');
    }
  }, [router]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const originalPushState = window.history.pushState;
    window.history.pushState = function (...args: Parameters<History['pushState']>) {
      sessionStorage.setItem(NAV_HISTORY_KEY, '1');
      return originalPushState.apply(this, args);
    };

    return () => {
      window.history.pushState = originalPushState;
    };
  }, []);

  useEffect(() => {
    const backButton = window.Telegram?.WebApp?.BackButton;

    if (!backButton) {
      setShowFallback(!isHome);
      return;
    }

    setShowFallback(false);

    if (isHome) {
      backButton.hide();
    } else {
      backButton.show();
    }
    backButton.onClick(goBack);

    return () => {
      backButton.offClick(goBack);
      backButton.hide();
    };
  }, [isHome, goBack]);

  if (!showFallback) return null;

  return (
    <button
      type="button"
      onClick={goBack}
      aria-label="Go back"
      className="rounded-lg p-2 text-soft transition hover:bg-muted hover:text-primary"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M19 12H5" />
        <path d="M12 19l-7-7 7-7" />
      </svg>
    </button>
  );
}