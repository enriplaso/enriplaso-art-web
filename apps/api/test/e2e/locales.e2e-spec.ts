import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { configureApp } from '../../src/configure-app';

const INACTIVE_CODE = 'zz';

describe('Locales (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.locale.upsert({
      where: { code: INACTIVE_CODE },
      update: { isActive: false },
      create: { code: INACTIVE_CODE, name: 'E2E Inactive', isActive: false },
    });
  });

  afterAll(async () => {
    await prisma.locale.deleteMany({ where: { code: INACTIVE_CODE } });
    await app.close();
  });

  it('lists active locales publicly, default first, hiding inactive ones', async () => {
    const res = await request(app.getHttpServer()).get('/locales').expect(200);
    const locales = res.body as {
      code: string;
      name: string;
      isDefault: boolean;
    }[];

    // The seeded set from art_shop_schema.sql.
    expect(locales.map((l) => l.code)).toEqual(
      expect.arrayContaining(['en', 'es', 'de', 'fr']),
    );
    expect(locales[0]).toEqual({
      code: 'en',
      name: 'English',
      isDefault: true,
    });
    expect(locales.filter((l) => l.isDefault)).toHaveLength(1);
    expect(locales.map((l) => l.code)).not.toContain(INACTIVE_CODE);
  });
});
