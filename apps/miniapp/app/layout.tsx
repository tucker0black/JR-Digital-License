import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';
import { TelegramProvider } from '@/components/TelegramProvider';
import { ThemeProvider } from '@/components/ThemeProvider';
import { BottomNav } from '@/components/BottomNav';

export const metadata: Metadata = {
  title: 'JR Digital license',
  description: 'Digital products and services in Telegram'
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
          <TelegramProvider>
            {children}
            <BottomNav />
          </TelegramProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
