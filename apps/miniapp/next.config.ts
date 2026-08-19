import type { NextConfig } from 'next';

const API_TARGET =
  process.env.API_URL?.trim() ||
  process.env.APP_API_URL?.trim() ||
  'http://127.0.0.1:4000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@jr/shared'],
  devIndicators: false,
  // Quick tunnels use an ephemeral hostname. Allow their asset requests in
  // development without coupling the app to one tunnel URL.
  allowedDevOrigins: ['*.trycloudflare.com'],
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${API_TARGET}/api/:path*`
      }
    ];
  }
};

export default nextConfig;
