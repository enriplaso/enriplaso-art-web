import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

const logger = new Logger('Bootstrap');

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Without this, Nest never listens for SIGTERM/SIGINT, so OnModuleDestroy
  // hooks (e.g. PrismaService disconnecting) never run on a real shutdown —
  // only when something calls app.close() programmatically (as tests do).
  app.enableShutdownHooks();

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

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
}

// unhandledRejection: log only — usually an isolated failed async
// operation, not worth taking the whole server down for.
process.on('unhandledRejection', (reason) => {
  logger.error(
    'Unhandled promise rejection',
    reason instanceof Error ? reason.stack : String(reason),
  );
});

// uncaughtException: the process may be in a corrupted state at this
// point, so log and exit deliberately — a process manager (Docker/PM2/k8s)
// is expected to restart it clean, rather than keep serving requests from
// unknown state.
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', error.stack);
  process.exit(1);
});

void bootstrap();
