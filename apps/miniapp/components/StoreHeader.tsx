'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BrandLogo } from '@/components/BrandLogo';
import { BackButton } from '@/components/BackButton';
import { LanguageSelector } from '@/components/LanguageSelector';
import { NotificationBell } from '@/components/NotificationBell';
import { useTheme } from '@/components/ThemeProvider';
import { useTranslation } from '@/lib/i18n';

const NAV_LINKS = [
  { href: '/', key: 'nav.home' },
  { href: '/store', key: 'nav.store' },
  { href: '/orders', key: 'nav.orders' },
  { href: '/wallet', key: 'nav.wallet' },
  { href: '/support', key: 'nav.support' },
];

export function StoreHeader() {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const { t } = useTranslation();

  return (
    <header
      className="sticky top-0 z-30 border-b border-line/30"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="glass-strong">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-1.5">
            <BackButton />
            <Link href="/" aria-label={`JR Digital license — ${t('nav.home')}`} className="flex min-w-0 items-center gap-2.5">
              {/* Brand name is always visible on every screen size; it scales
                  down fluidly and only ellipsizes in the extreme case where a
                  320px viewport genuinely cannot fit it next to the controls. */}
              <BrandLogo />
            </Link>
          </div>
          <nav className="hidden items-center gap-0.5 text-sm font-medium md:flex">
            {NAV_LINKS.map((link) => {
              const active =
                link.href === '/'
                  ? pathname === '/'
                  : link.href === '/store'
                    ? pathname === '/store' || pathname.startsWith('/store/')
                    : pathname === link.href || pathname.startsWith(`${link.href}/`);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`rounded-xl px-3 py-2 transition-luxury ${
                    active
                      ? 'bg-primary/10 text-primary'
                      : 'text-soft hover:bg-muted/50 hover:text-ink'
                  }`}
                >
                  {t(link.key)}
                </Link>
              );
            })}
          </nav>
          <div className="flex shrink-0 items-center gap-0.5">
            <NotificationBell />
            <LanguageSelector />
            <button
              type="button"
              onClick={toggle}
              aria-label={theme === 'dark' ? t('theme.toLight') : t('theme.toDark')}
              className="rounded-xl p-2 text-soft transition-luxury hover:bg-muted/50 hover:text-ink"
            >
              {theme === 'dark' ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}