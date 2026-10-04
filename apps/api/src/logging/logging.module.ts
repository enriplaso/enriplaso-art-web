import { randomUUID } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { LoggerModule } from 'nestjs-pino';

// An incoming X-Request-Id (e.g. from a proxy or the Next.js server) is
// reused so one request can be followed across services — but only if it
// looks like an id, since it's client-controlled and ends up in every log
// line for that request.
const REQUEST_ID_PATTERN = /^[\w-]{1,64}$/;

const SENSITIVE_KEYS = [
  'password',
  'passwordHash',
  'token',
  'pendingToken',
  'totpSecret',
  'backupCodes',
];

/**
 * Structured logging via pino (README's "Logging" section). Every
 * `new Logger(...)` from @nestjs/common is routed through it once
 * configureApp() calls app.useLogger(), and log calls made while handling a
 * request automatically carry that request's id.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const env = config.get<string>('NODE_ENV');
        const level =
          config.get<string>('LOG_LEVEL') ??
          (env === 'test' ? 'silent' : env === 'production' ? 'info' : 'debug');

        return {
          pinoHttp: {
            level,
            // Human-readable in development; raw JSON lines in production,
            // which is what log collectors (and `jq`) expect.
            transport:
              env === 'production' || level === 'silent'
                ? undefined
                : {
                    target: 'pino-pretty',
                    options: { singleLine: true, ignore: 'pid,hostname' },
                  },

            genReqId: (req: IncomingMessage, res: ServerResponse) => {
              const incoming = req.headers['x-request-id'];
              const id =
                typeof incoming === 'string' &&
                REQUEST_ID_PATTERN.test(incoming)
                  ? incoming
                  : randomUUID();
              res.setHeader('X-Request-Id', id);
              return id;
            },

            // Health checks are polled every few seconds by the load
            // balancer and would drown out everything else.
            autoLogging: {
              ignore: (req: IncomingMessage) =>
                req.url?.startsWith('/health') ?? false,
            },

            customLogLevel: (
              _req: IncomingMessage,
              res: ServerResponse,
              err?: Error,
            ) => {
              if (err || res.statusCode >= 500) return 'error';
              if (res.statusCode >= 400) return 'warn';
              return 'info';
            },
            customSuccessMessage: (req: IncomingMessage, res: ServerResponse) =>
              `${req.method} ${req.url} ${res.statusCode}`,
            customErrorMessage: (req: IncomingMessage, res: ServerResponse) =>
              `${req.method} ${req.url} ${res.statusCode}`,

            // Which admin made the request — together with method + URL,
            // this is the audit trail for admin writes. Read at response
            // time, after AdminAuthGuard has set req.admin.
            customProps: (req: IncomingMessage) => {
              const adminId = (req as Request).admin?.sub;
              return adminId ? { adminId } : {};
            },

            // A deliberately small request shape: no headers (cookies and
            // tokens live there) and never the body (passwords, 2FA codes).
            serializers: {
              req: (req: {
                id: string;
                method: string;
                url: string;
                remoteAddress?: string;
              }) => ({
                id: req.id,
                method: req.method,
                url: req.url,
                remoteAddress: req.remoteAddress,
              }),
              res: (res: { statusCode: number }) => ({
                statusCode: res.statusCode,
              }),
            },

            // Defense in depth, in case a header or credential-shaped field
            // is ever logged explicitly.
            redact: {
              paths: [
                'req.headers.cookie',
                'req.headers.authorization',
                'res.headers["set-cookie"]',
                // pino's `*` matches exactly one level, not any depth, so
                // each key is listed at the top level (where Nest's
                // `logger.warn({ ... }, msg)` puts it) and one level down
                // (e.g. `{ admin: { passwordHash } }`).
                ...SENSITIVE_KEYS.flatMap((key) => [key, `*.${key}`]),
              ],
              censor: '[redacted]',
            },
          },
        };
      },
    }),
  ],
})
export class LoggingModule {}
