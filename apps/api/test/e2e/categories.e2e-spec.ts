import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { configureApp } from '../../src/configure-app';

const ADMIN_EMAIL = 'e2e-categories-admin@example.com';
const ADMIN_PASSWORD = 'correct-horse-battery-staple';
const SLUG_PREFIX = 'e2e-cat-';
const PRODUCT_SLUG = 'e2e-cat-product';

describe('Categories (e2e)', () => {
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
    await prisma.product.deleteMany({ where: { slug: PRODUCT_SLUG } });
    await prisma.category.deleteMany({
      where: { slug: { startsWith: SLUG_PREFIX } },
    });
    await prisma.admin.deleteMany({ where: { email: ADMIN_EMAIL } });
    await app.close();
  });

  it('rejects writes without an admin session', () => {
    return request(app.getHttpServer())
      .post('/categories')
      .send({
        slug: `${SLUG_PREFIX}anon`,
        translations: [{ localeCode: 'en', name: 'Anon' }],
      })
      .expect(401);
  });

  it('creates, reads, rejects bad moves, and deletes without taking products with it', async () => {
    const parent = await admin
      .post('/categories')
      .send({
        slug: `${SLUG_PREFIX}paintings`,
        translations: [
          { localeCode: 'en', name: 'Paintings' },
          { localeCode: 'es', name: 'Pinturas' },
        ],
      })
      .expect(201);
    const parentId = (parent.body as { id: string }).id;

    const child = await admin
      .post('/categories')
      .send({
        slug: `${SLUG_PREFIX}abstract`,
        parentId,
        translations: [{ localeCode: 'en', name: 'Abstract' }],
      })
      .expect(201);
    const childId = (child.body as { id: string }).id;

    // Public read: Spanish where it exists, English fallback where it doesn't.
    const list = await request(app.getHttpServer())
      .get('/categories?locale=es')
      .expect(200);
    const ours = (
      list.body as { slug: string; name: string; parentId: string | null }[]
    ).filter((c) => c.slug.startsWith(SLUG_PREFIX));
    expect(ours).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: `${SLUG_PREFIX}paintings`,
          name: 'Pinturas',
          parentId: null,
        }),
        expect.objectContaining({
          slug: `${SLUG_PREFIX}abstract`,
          name: 'Abstract',
          parentId,
        }),
      ]),
    );

    await request(app.getHttpServer())
      .get(`/categories/${SLUG_PREFIX}paintings`)
      .expect(200);

    // Duplicate slug → 409, not a raw database error.
    await admin
      .post('/categories')
      .send({
        slug: `${SLUG_PREFIX}paintings`,
        translations: [{ localeCode: 'en', name: 'Again' }],
      })
      .expect(409);

    // Missing default-locale translation → 400.
    await admin
      .post('/categories')
      .send({
        slug: `${SLUG_PREFIX}no-english`,
        translations: [{ localeCode: 'es', name: 'Solo español' }],
      })
      .expect(400);

    // Moving the parent under its own child would create a loop → 400.
    await admin
      .patch(`/categories/${parentId}`)
      .send({ parentId: childId })
      .expect(400);

    // A malformed id is rejected before it ever reaches the database.
    await admin.patch('/categories/not-a-uuid').send({}).expect(400);

    // A product in the child category survives the category being deleted,
    // and is simply left without a category (ON DELETE SET NULL).
    await admin
      .post('/products')
      .send({
        slug: PRODUCT_SLUG,
        title: 'Categorised piece',
        priceCents: 1000,
        categoryId: childId,
      })
      .expect(201);

    await admin.delete(`/categories/${childId}`).expect(204);

    const product = await prisma.product.findUniqueOrThrow({
      where: { slug: PRODUCT_SLUG },
    });
    expect(product.categoryId).toBeNull();

    await request(app.getHttpServer())
      .get(`/categories/${SLUG_PREFIX}abstract`)
      .expect(404);
  });
});
