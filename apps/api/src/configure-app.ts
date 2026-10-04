import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';

/**
 * Global app configuration shared between the real server (main.ts) and
 * every e2e test. Building the app via Test.createTestingModule() +
 * createNestApplication() does NOT run main.ts's bootstrap() — anything
 * app-wide (middleware, pipes, CORS) has to live here, not inlined in
 * main.ts, or e2e tests silently run against a differently-configured app
 * than production (as happened with cookie-parser: without it here,
 * request.cookies was always undefined in tests, so AdminAuthGuard always
 * saw "no token", regardless of whether login actually worked).
 */
export function configureApp(app: INestApplication): void {
  // Routes every Nest Logger (and Nest's own startup/exception logging)
  // through pino — see LoggingModule.
  app.useLogger(app.get(Logger));

  // Required for AdminAuthGuard to read the httpOnly auth cookie —
  // Express doesn't parse cookies into req.cookies without this.
  app.use(cookieParser());

  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
}
