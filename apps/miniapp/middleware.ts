import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const ADMIN_TOKEN_COOKIE = 'jr_admin_token';

function isPlausibleToken(token: string | undefined): boolean {
  if (!token) return false;
  if (token.length < 8 || token.length > 512) return false;
  for (const char of token) {
    const code = char.charCodeAt(0);
    if (code < 33 || code === 127) return false;
  }
  return true;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith('/admin') || pathname === '/admin/login') {
    return NextResponse.next();
  }

  const token = request.cookies.get(ADMIN_TOKEN_COOKIE)?.value;
  if (!isPlausibleToken(token)) {
    const loginUrl = new URL('/admin/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*']
};
