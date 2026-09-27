import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { configureApp } from '../../src/configure-app';
import { MAX_FAILED_LOGIN_ATTEMPTS } from '../../src/auth/auth.constants';

const TEST_ADMIN_EMAIL = 'e2e-test-admin@example.com';
const TEST_ADMIN_PASSWORD = 'correct-horse-battery-staple';
const TWO_FA_ADMIN_EMAIL = 'e2e-2fa-admin@example.com';
const LOCKOUT_ADMIN_EMAIL = 'e2e-lockout-admin@example.com';

async function createTestApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);

    const passwordHash = await bcrypt.hash(TEST_ADMIN_PASSWORD, 4);
    await prisma.admin.upsert({
      where: { email: TEST_ADMIN_EMAIL },
      update: { passwordHash },
      create: { email: TEST_ADMIN_EMAIL, passwordHash },
    });
  });

  afterEach(async () => {
    await prisma.product.deleteMany({ where: { slug: 'e2e-auth-test-piece' } });
  });

  afterAll(async () => {
    await prisma.admin.deleteMany({
      where: {
        email: {
          in: [TEST_ADMIN_EMAIL, TWO_FA_ADMIN_EMAIL, LOCKOUT_ADMIN_EMAIL],
        },
      },
    });
    await app.close();
  });

  it('rejects an unauthenticated write to a protected route', () => {
    return request(app.getHttpServer())
      .post('/products')
      .send({ slug: 'e2e-auth-test-piece', title: 'X', priceCents: 100 })
      .expect(401);
  });

  it('rejects login with the wrong password', () => {
    return request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: TEST_ADMIN_EMAIL, password: 'wrong-password' })
      .expect(401);
  });

  it('logs in, accesses a protected route, then logout revokes access', async () => {
    const agent = request.agent(app.getHttpServer());

    await agent
      .post('/auth/login')
      .send({ email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD })
      .expect(201)
      .expect((res) => {
        if (res.body.admin.email !== TEST_ADMIN_EMAIL) {
          throw new Error('Login response did not return the admin');
        }
      });

    await agent
      .get('/auth/me')
      .expect(200)
      .expect((res) => {
        if (res.body.email !== TEST_ADMIN_EMAIL) {
          throw new Error('/auth/me did not return the logged-in admin');
        }
      });

    await agent
      .post('/products')
      .send({
        slug: 'e2e-auth-test-piece',
        title: 'Created in e2e test',
        priceCents: 5000,
      })
      .expect(201);

    await agent.post('/auth/logout').expect(201);

    await agent
      .post('/products')
      .send({ slug: 'e2e-auth-test-piece', title: 'X', priceCents: 100 })
      .expect(401);
  });

  describe('two-factor authentication', () => {
    beforeAll(async () => {
      const passwordHash = await bcrypt.hash(TEST_ADMIN_PASSWORD, 4);
      await prisma.admin.upsert({
        where: { email: TWO_FA_ADMIN_EMAIL },
        update: { passwordHash },
        create: { email: TWO_FA_ADMIN_EMAIL, passwordHash },
      });
    });

    it('enables 2FA, then requires it on the next login, and rejects a reused backup code', async () => {
      const agent = request.agent(app.getHttpServer());

      // Log in before 2FA is enabled — should get a full session directly.
      await agent
        .post('/auth/login')
        .send({ email: TWO_FA_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD })
        .expect(201)
        .expect((res) => {
          if (res.body.requiresTwoFactor) {
            throw new Error('did not expect 2FA to be required yet');
          }
        });

      const setupRes = await agent.post('/auth/2fa/setup').expect(201);
      const { secret } = setupRes.body as { secret: string };

      const confirmRes = await agent
        .post('/auth/2fa/confirm')
        .send({ code: authenticator.generate(secret) })
        .expect(201);
      const { backupCodes } = confirmRes.body as { backupCodes: string[] };
      const firstBackupCode = backupCodes[0];
      if (!firstBackupCode) {
        throw new Error('expected at least one backup code');
      }

      await agent.post('/auth/logout').expect(201);

      // Fresh login now must pause at the pending-2FA stage.
      const loginRes = await agent
        .post('/auth/login')
        .send({ email: TWO_FA_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD })
        .expect(201);
      if (!loginRes.body.requiresTwoFactor) {
        throw new Error('expected 2FA to now be required');
      }

      // The pending cookie alone must not grant access to a protected route.
      await agent.get('/auth/me').expect(401);

      // Wrong code is rejected.
      await agent.post('/auth/2fa/verify').send({ code: '000000' }).expect(401);

      // Correct TOTP code completes the login.
      await agent
        .post('/auth/2fa/verify')
        .send({ code: authenticator.generate(secret) })
        .expect(201)
        .expect((res) => {
          if (res.body.usedBackupCode !== false) {
            throw new Error('did not expect a backup code to be used');
          }
        });

      await agent.get('/auth/me').expect(200);
      await agent.post('/auth/logout').expect(201);

      // A backup code works as an alternative to the TOTP code...
      await agent
        .post('/auth/login')
        .send({ email: TWO_FA_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD })
        .expect(201);
      await agent
        .post('/auth/2fa/verify')
        .send({ code: firstBackupCode })
        .expect(201)
        .expect((res) => {
          if (res.body.usedBackupCode !== true) {
            throw new Error('expected the backup code path to be used');
          }
        });

      // ...but only once.
      await agent.post('/auth/logout').expect(201);
      await agent
        .post('/auth/login')
        .send({ email: TWO_FA_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD })
        .expect(201);
      await agent
        .post('/auth/2fa/verify')
        .send({ code: firstBackupCode })
        .expect(401);

      // Clean up: disable 2FA (need a valid session — use the second
      // backup code) so this admin doesn't linger in a 2FA-enabled state.
      const secondBackupCode = backupCodes[1];
      if (!secondBackupCode) {
        throw new Error('expected a second backup code');
      }
      await agent
        .post('/auth/2fa/verify')
        .send({ code: secondBackupCode })
        .expect(201);
      await agent.post('/auth/2fa/disable').expect(201);
    });
  });

  describe('account lockout', () => {
    // A fresh app instance (fresh in-memory throttler state) — this test
    // makes MAX_FAILED_LOGIN_ATTEMPTS + 2 requests to /auth/login on its
    // own, which combined with the rest of this file's login calls could
    // otherwise trip the unrelated IP-based throttle (10/min) sharing the
    // outer app instance, and be misattributed to the wrong mechanism.
    let lockoutApp: INestApplication;

    beforeAll(async () => {
      lockoutApp = await createTestApp();

      const passwordHash = await bcrypt.hash(TEST_ADMIN_PASSWORD, 4);
      await prisma.admin.upsert({
        where: { email: LOCKOUT_ADMIN_EMAIL },
        update: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
        create: { email: LOCKOUT_ADMIN_EMAIL, passwordHash },
      });
    });

    afterAll(async () => {
      await lockoutApp.close();
    });

    it('locks the account after MAX_FAILED_LOGIN_ATTEMPTS wrong passwords, even for the correct password', async () => {
      for (let i = 0; i < MAX_FAILED_LOGIN_ATTEMPTS; i++) {
        await request(lockoutApp.getHttpServer())
          .post('/auth/login')
          .send({ email: LOCKOUT_ADMIN_EMAIL, password: 'wrong' })
          .expect(401);
      }

      await request(lockoutApp.getHttpServer())
        .post('/auth/login')
        .send({ email: LOCKOUT_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD })
        .expect(429);
    });

    it('unlocks again once the lock has expired', async () => {
      // Simulate time passing rather than waiting out the real 15-minute
      // lockout duration.
      await prisma.admin.update({
        where: { email: LOCKOUT_ADMIN_EMAIL },
        data: { lockedUntil: new Date(Date.now() - 1000) },
      });

      await request(lockoutApp.getHttpServer())
        .post('/auth/login')
        .send({ email: LOCKOUT_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD })
        .expect(201);

      const admin = await prisma.admin.findUniqueOrThrow({
        where: { email: LOCKOUT_ADMIN_EMAIL },
      });
      if (admin.failedLoginAttempts !== 0 || admin.lockedUntil !== null) {
        throw new Error('expected the lockout state to be reset');
      }
    });
  });
});
