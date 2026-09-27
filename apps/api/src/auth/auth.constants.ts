import { CookieOptions } from 'express';

export const ACCESS_TOKEN_COOKIE = 'access_token';
export const ACCESS_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Short-lived, separate cookie for the "password correct, awaiting TOTP
// code" state — never sufficient on its own to access a protected route
// (AdminAuthGuard explicitly rejects any token carrying PENDING_2FA_PURPOSE,
// as defense-in-depth beyond just using a different cookie name).
export const PENDING_2FA_TOKEN_COOKIE = 'pending_2fa_token';
export const PENDING_2FA_TOKEN_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
export const PENDING_2FA_TOKEN_EXPIRES_IN = '5m';
export const PENDING_2FA_PURPOSE = 'pending_2fa';

export const BACKUP_CODE_COUNT = 10;

// Account-level lockout across both the password and 2FA-code steps —
// protects the one admin account regardless of source IP, which IP-based
// rate limiting (nginx or @nestjs/throttler) cannot do on its own.
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export function getAuthCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    // Secure requires HTTPS — off for local http:// dev, on in production.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  };
}
