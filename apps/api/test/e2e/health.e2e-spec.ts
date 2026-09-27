import { afterEach, beforeEach, describe, it } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

describe('HealthController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/health (GET) — liveness, no dependency checks', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok', info: {}, error: {}, details: {} });
  });

  it('/health/ready (GET) — readiness, checks the database', () => {
    return request(app.getHttpServer())
      .get('/health/ready')
      .expect(200)
      .expect({
        status: 'ok',
        info: { database: { status: 'up' } },
        error: {},
        details: { database: { status: 'up' } },
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
