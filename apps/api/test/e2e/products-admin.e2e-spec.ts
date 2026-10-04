import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { configureApp } from '../../src/configure-app';

const ADMIN_EMAIL = 'e2e-products-admin@example.com';
const ADMIN_PASSWORD = 'correct-horse-battery-staple';
const SLUG_PREFIX = 'e2e-padmin-';

type ProductBody = {
  id: string;
  slug: string;
  status: string;
  priceCents?: string;
  translations?: { localeCode: string; description: string | null }[];
};

describe('Shop flag & admin product endpoints (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: ReturnType<typeof request.agent>;
  const originalShopFlag = process.env.SHOP_ENABLED;

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

    await prisma.product.create({
      data: {
        slug: `${SLUG_PREFIX}published`,
        title: 'Published piece',
        priceCents: 45000n,
        status: 'published',
      },
    });
    await prisma.product.create({
      data: {
        slug: `${SLUG_PREFIX}draft`,
        title: 'Draft piece',
        priceCents: 12000n,
        status: 'draft',
        translations: {
          create: [
            { localeCode: 'en', description: 'English draft.' },
            { localeCode: 'es', description: 'Borrador.' },
          ],
        },
      },
    });
  });

  afterEach(() => {
    process.env.SHOP_ENABLED = originalShopFlag;
  });

  afterAll(async () => {
    await prisma.product.deleteMany({
      where: { slug: { startsWith: SLUG_PREFIX } },
    });
    await prisma.admin.deleteMany({ where: { email: ADMIN_EMAIL } });
    await app.close();
  });

  describe('SHOP_ENABLED', () => {
    it('exposes the flag publicly and hides price while it is off', async () => {
      process.env.SHOP_ENABLED = 'false';

      const settings = await request(app.getHttpServer())
        .get('/settings')
        .expect(200);
      expect(settings.body).toEqual({ shopEnabled: false });

      const detail = await request(app.getHttpServer())
        .get(`/products/${SLUG_PREFIX}published`)
        .expect(200);
      expect(detail.body).not.toHaveProperty('priceCents');
      expect(detail.body).not.toHaveProperty('currency');
      expect(detail.body).not.toHaveProperty('quantityAvailable');

      const list = await request(app.getHttpServer())
        .get('/products')
        .expect(200);
      const ours = (list.body as { data: ProductBody[] }).data.find(
        (p) => p.slug === `${SLUG_PREFIX}published`,
      );
      expect(ours).toBeDefined();
      expect(ours).not.toHaveProperty('priceCents');
    });

    it('shows price once the shop is enabled', async () => {
      process.env.SHOP_ENABLED = 'true';

      const settings = await request(app.getHttpServer())
        .get('/settings')
        .expect(200);
      expect(settings.body).toEqual({ shopEnabled: true });

      const detail = await request(app.getHttpServer())
        .get(`/products/${SLUG_PREFIX}published`)
        .expect(200);
      expect((detail.body as ProductBody).priceCents).toBe('45000');
    });
  });

  describe('GET /admin/products', () => {
    it('requires an admin session', async () => {
      await request(app.getHttpServer()).get('/admin/products').expect(401);
      await request(app.getHttpServer())
        .get('/admin/products/00000000-0000-0000-0000-000000000000')
        .expect(401);
    });

    it('lists drafts with price even while the shop is off, and filters by status', async () => {
      process.env.SHOP_ENABLED = 'false';

      const all = await admin
        .get('/admin/products')
        .query({ pageSize: 100 })
        .expect(200);
      const ours = (all.body as { data: ProductBody[] }).data.filter((p) =>
        p.slug.startsWith(SLUG_PREFIX),
      );
      expect(ours.map((p) => p.status).sort()).toEqual(['draft', 'published']);
      expect(ours.find((p) => p.status === 'draft')?.priceCents).toBe('12000');

      const drafts = await admin
        .get('/admin/products')
        .query({ status: 'draft', pageSize: 100 })
        .expect(200);
      const statuses = (drafts.body as { data: ProductBody[] }).data.map(
        (p) => p.status,
      );
      expect(new Set(statuses)).toEqual(new Set(['draft']));

      await admin
        .get('/admin/products')
        .query({ status: 'not-a-status' })
        .expect(400);
    });

    it('returns one draft with every locale for the edit form', async () => {
      const draft = await prisma.product.findUniqueOrThrow({
        where: { slug: `${SLUG_PREFIX}draft` },
      });

      const res = await admin.get(`/admin/products/${draft.id}`).expect(200);
      const body = res.body as ProductBody;
      expect(body.status).toBe('draft');
      expect(body.translations).toEqual(
        expect.arrayContaining([
          { localeCode: 'en', description: 'English draft.' },
          { localeCode: 'es', description: 'Borrador.' },
        ]),
      );

      // The public endpoint still refuses to show it.
      await request(app.getHttpServer())
        .get(`/products/${SLUG_PREFIX}draft`)
        .expect(404);

      await admin
        .get('/admin/products/00000000-0000-0000-0000-000000000000')
        .expect(404);
      await admin.get('/admin/products/not-a-uuid').expect(400);
    });
  });

  describe('product write errors', () => {
    it('returns 409 for a duplicate slug, 400 for unknown locale or category', async () => {
      const dup = await admin
        .post('/products')
        .send({ slug: `${SLUG_PREFIX}published`, title: 'Dup', priceCents: 1 })
        .expect(409);
      expect((dup.body as { message: string }).message).toBe(
        'A product with that slug already exists',
      );

      const badLocale = await admin
        .post('/products')
        .send({
          slug: `${SLUG_PREFIX}bad-locale`,
          title: 'Bad locale',
          priceCents: 1,
          translations: [{ localeCode: 'xx', description: '???' }],
        })
        .expect(400);
      expect((badLocale.body as { message: string }).message).toContain('xx');

      await admin
        .post('/products')
        .send({
          slug: `${SLUG_PREFIX}bad-category`,
          title: 'Bad category',
          priceCents: 1,
          categoryId: '00000000-0000-0000-0000-000000000000',
        })
        .expect(400);
    });

    it('rolls back translation changes when the update itself is rejected', async () => {
      const draft = await prisma.product.findUniqueOrThrow({
        where: { slug: `${SLUG_PREFIX}draft` },
      });

      await admin
        .patch(`/products/${draft.id}`)
        .send({
          slug: `${SLUG_PREFIX}published`, // taken → 409
          translations: [{ localeCode: 'es', description: 'Cambiado.' }],
        })
        .expect(409);

      const es = await prisma.productTranslation.findUniqueOrThrow({
        where: {
          productId_localeCode: { productId: draft.id, localeCode: 'es' },
        },
      });
      expect(es.description).toBe('Borrador.');
    });
  });
});
