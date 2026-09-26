import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Skip API routes (there are none in this app — the backend is NestJS),
  // static files, and Next internals.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
