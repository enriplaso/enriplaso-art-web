import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { configureApp } from '../../src/configure-app';

const ADMIN_EMAIL = 'e2e-pages-admin@example.com';
const ADMIN_PASSWORD = 'correct-horse-battery-staple';
const SLUG_PREFIX = 'e2e-page-';

type AdminPage = {
  id: string;
  slug: string;
  translations: { localeCode: string; title: string; updatedAt: string }[];
};

describe('Pages (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.admin.upsert({
      where: { email: ADMIN_EMAIL },
      update: {},
      create: {
        email: ADMIN_EMAIL,
        passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 4),
      },
    });

    admin = request.agent(app.getHttpServer());
    await admin
      .post('/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(201);
  });

  afterAll(async () => {
    await prisma.page.deleteMany({
      where: { slug: { startsWith: SLUG_PREFIX } },
    });
    await prisma.admin.deleteMany({ where: { email: ADMIN_EMAIL } });
    await app.close();
  });

  it('rejects writes and admin reads without an admin session', async () => {
    const anon = request(app.getHttpServer());
    await anon
      .post('/pages')
      .send({
        slug: `${SLUG_PREFIX}anon`,
        translations: [{ localeCode: 'en', title: 'Anon', body: '...' }],
      })
      .expect(401);
    await anon.get('/admin/pages').expect(401);
  });

  it('creates, serves with fallback, edits atomically, and deletes', async () => {
    const created = await admin
      .post('/pages')
      .send({
        slug: `${SLUG_PREFIX}about`,
        translations: [
          { localeCode: 'en', title: 'About me', body: '# Hello' },
          { localeCode: 'es', title: 'Sobre mí', body: '# Hola' },
        ],
      })
      .expect(201);
    const page = created.body as AdminPage;

    // Spanish where it exists; German falls back to English and says so.
    const es = await request(app.getHttpServer())
      .get(`/pages/${SLUG_PREFIX}about?locale=es`)
      .expect(200);
    expect(es.body).toMatchObject({ localeCode: 'es', title: 'Sobre mí' });

    const de = await request(app.getHttpServer())
      .get(`/pages/${SLUG_PREFIX}about?locale=de`)
      .expect(200);
    expect(de.body).toMatchObject({ localeCode: 'en', title: 'About me' });

    const list = await request(app.getHttpServer())
      .get('/pages?locale=es')
      .expect(200);
    expect(list.body).toContainEqual({
      id: page.id,
      slug: `${SLUG_PREFIX}about`,
      title: 'Sobre mí',
    });

    // Missing default-locale translation → 400; unknown locale → 400.
    await admin
      .post('/pages')
      .send({
        slug: `${SLUG_PREFIX}no-english`,
        translations: [{ localeCode: 'es', title: 'Solo', body: '...' }],
      })
      .expect(400);
    await admin
      .post('/pages')
      .send({
        slug: `${SLUG_PREFIX}bad-locale`,
        translations: [
          { localeCode: 'en', title: 'Ok', body: '...' },
          { localeCode: 'xx', title: '??', body: '...' },
        ],
      })
      .expect(400);

    // A rejected update (duplicate slug → 409) leaves its translation
    // changes uncommitted.
    await admin
      .post('/pages')
      .send({
        slug: `${SLUG_PREFIX}terms`,
        translations: [{ localeCode: 'en', title: 'Terms', body: '...' }],
      })
      .expect(201);
    await admin
      .patch(`/pages/${page.id}`)
      .send({
        slug: `${SLUG_PREFIX}terms`,
        translations: [{ localeCode: 'fr', title: 'À propos', body: '...' }],
      })
      .expect(409);
    const afterConflict = await admin
      .get(`/admin/pages/${page.id}`)
      .expect(200);
    expect(
      (afterConflict.body as AdminPage).translations.map((t) => t.localeCode),
    ).toEqual(['en', 'es']);

    // A successful edit bumps the translation's updatedAt (DB trigger).
    const before = (afterConflict.body as AdminPage).translations.find(
      (t) => t.localeCode === 'en',
    )!.updatedAt;
    const edited = await admin
      .patch(`/pages/${page.id}`)
      .send({
        translations: [{ localeCode: 'en', title: 'About', body: '# Hi' }],
      })
      .expect(200);
    const after = (edited.body as AdminPage).translations.find(
      (t) => t.localeCode === 'en',
    )!;
    expect(after.title).toBe('About');
    expect(new Date(after.updatedAt).getTime()).toBeGreaterThan(
      new Date(before).getTime(),
    );

    // The default-locale translation can't be removed; others can.
    await admin.delete(`/pages/${page.id}/translations/en`).expect(400);
    await admin.delete(`/pages/${page.id}/translations/es`).expect(204);
    await admin.delete(`/pages/${page.id}/translations/es`).expect(404);

    await admin.delete(`/pages/${page.id}`).expect(204);
    await request(app.getHttpServer())
      .get(`/pages/${SLUG_PREFIX}about`)
      .expect(404);
  });
});
