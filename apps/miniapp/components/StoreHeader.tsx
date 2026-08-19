'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BrandLogo } from '@/components/BrandLogo';
import { BackButton } from '@/components/BackButton';
import { useTheme } from '@/components/ThemeProvider';

const NAV_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/store', label: 'Store' },
  { href: '/orders', label: 'Orders' },
  { href: '/wallet', label: 'Wallet' },
  { href: '/support', label: 'Support' }
];

export function StoreHeader() {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();

  return (
    <header
      className="sticky top-0 z-30 border-b border-line bg-page/85 backdrop-blur-md"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-1">
          <BackButton />
          <Link href="/" aria-label="JR Digital license home" className="flex items-center gap-2.5">
            <BrandLogo />
          </Link>
        </div>
        <nav className="hidden items-center gap-1 text-sm font-medium md:flex">
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
                className={`rounded-lg px-3 py-2 transition ${
                  active
                    ? 'bg-primary-soft text-primary'
                    : 'text-soft hover:bg-muted hover:text-primary'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <button
          type="button"
          onClick={toggle}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="rounded-lg p-2 text-soft transition hover:bg-muted hover:text-primary"
        >
          {theme === 'dark' ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
            </svg>
          )}
        </button>
      </div>
    </header>
  );
}
