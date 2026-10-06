import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin();

// Where product images are served from: the API's STORAGE_PUBLIC_URL_BASE
// (MinIO locally, the R2 bucket's public URL in production). next/image only
// optimizes images from hosts listed here.
const imageBase = new URL(
  process.env.NEXT_PUBLIC_IMAGE_BASE_URL ??
    'http://localhost:9000/art-shop-images',
);

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: imageBase.protocol.replace(':', '') as 'http' | 'https',
        hostname: imageBase.hostname,
        port: imageBase.port,
        pathname: `${imageBase.pathname.replace(/\/$/, '')}/**`,
      },
    ],
    formats: ['image/avif', 'image/webp'],
    // One quality everywhere: every extra quality is another variant the
    // optimizer has to generate (slowly) the first time. Next.js 16 requires
    // listing the qualities used.
    qualities: [75],
  },
};

export default withNextIntl(nextConfig);
