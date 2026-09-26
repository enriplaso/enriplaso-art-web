import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  images: {
    // Cloudflare R2 bucket domain goes here once provisioned
    // (see README's "Image hosting/CDN" open question).
    remotePatterns: [],
  },
};

export default withNextIntl(nextConfig);
