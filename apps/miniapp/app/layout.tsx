import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import './globals.css';
import { TelegramProvider } from '@/components/TelegramProvider';
import { ThemeProvider } from '@/components/ThemeProvider';
import { I18nProvider } from '@/lib/i18n';
import { BottomNav } from '@/components/BottomNav';
import { ToastHost } from '@/components/Toast';

export const metadata: Metadata = {
  title: 'JR Digital license',
  description: 'Digital products and services in Telegram',
  icons: {
    icon: '/jr-logo.webp',
    shortcut: '/jr-logo.webp',
    apple: '/jr-logo.webp',
  },
};

// viewport-fit=cover is required for env(safe-area-inset-*) to resolve
// inside the Telegram WebView on notched devices.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover'
};

const themeScript = `
(function () {
  try {
    var saved = localStorage.getItem('jr-theme');
    if (saved !== 'light') {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      </head>
      <body>
        <ThemeProvider>
          <I18nProvider>
            <TelegramProvider>
              {children}
              <ToastHost />
              <BottomNav />
            </TelegramProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
