import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { configureApp } from '../../src/configure-app';

const ADMIN_EMAIL = 'e2e-images-admin@example.com';
const ADMIN_PASSWORD = 'correct-horse-battery-staple';
const PRODUCT_SLUG = 'e2e-images-product';

// A 1x1 transparent PNG, small enough to inline as a fixture.
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

// A different 1x1 PNG (opaque black, vs. the transparent one above) — a
// real image, not just arbitrary bytes with a .png filename, since
// NestJS's FileTypeValidator sniffs actual magic numbers, not just the
// claimed Content-Type. Used to prove a "replace" actually swaps the
// bytes, not just the filename.
const ONE_PIXEL_PNG_V2 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('Product images (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: ReturnType<typeof request.agent>;
  let productId: string;

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

    const product = await prisma.product.create({
      data: {
        slug: PRODUCT_SLUG,
        title: 'Image upload test piece',
        priceCents: 1000n,
        status: 'published',
      },
    });
    productId = product.id;
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { slug: PRODUCT_SLUG } });
    await prisma.admin.deleteMany({ where: { email: ADMIN_EMAIL } });
    await app.close();
  });

  it('rejects an upload without an admin session', async () => {
    await request(app.getHttpServer())
      .post(`/products/${productId}/images`)
      .attach('file', ONE_PIXEL_PNG, 'pixel.png')
      .expect(401);
  });

  it('rejects a non-image file before it reaches storage', async () => {
    await admin
      .post(`/products/${productId}/images`)
      .attach('file', Buffer.from('not an image'), 'notes.txt')
      .expect(400);
  });

  it('uploads to the real object store and the resulting URL actually serves the bytes', async () => {
    const res = await admin
      .post(`/products/${productId}/images`)
      .field('altText', 'A single test pixel')
      .field('isPrimary', 'true')
      .attach('file', ONE_PIXEL_PNG, 'pixel.png')
      .expect(201);

    const body = res.body as {
      images: {
        id: string;
        url: string;
        altText: string;
        isPrimary: boolean;
      }[];
    };
    const uploaded = body.images.find(
      (img) => img.altText === 'A single test pixel',
    );
    expect(uploaded).toBeDefined();
    expect(uploaded?.isPrimary).toBe(true);

    // Proves the upload actually landed in MinIO, not just the DB row —
    // fetches the public URL exactly as a browser would.
    const fetched = await fetch(uploaded!.url);
    expect(fetched.status).toBe(200);
    const bytes = Buffer.from(await fetched.arrayBuffer());
    expect(bytes.equals(ONE_PIXEL_PNG)).toBe(true);

    const dbImage = await prisma.productImage.findUniqueOrThrow({
      where: { id: uploaded!.id },
    });
    expect(dbImage.url).toBe(uploaded!.url);
  });

  it('demotes the previous primary image when a new one is uploaded as primary', async () => {
    await admin
      .post(`/products/${productId}/images`)
      .field('isPrimary', 'true')
      .attach('file', ONE_PIXEL_PNG, 'pixel-2.png')
      .expect(201);

    const images = await prisma.productImage.findMany({
      where: { productId },
    });
    expect(images.filter((img) => img.isPrimary)).toHaveLength(1);
  });

  it('deletes the object from storage and the DB row, and the URL stops serving it', async () => {
    const upload = await admin
      .post(`/products/${productId}/images`)
      .attach('file', ONE_PIXEL_PNG, 'pixel-3.png')
      .expect(201);
    const body = upload.body as { images: { id: string; url: string }[] };
    const image = body.images[body.images.length - 1]!;

    await admin.delete(`/products/${productId}/images/${image.id}`).expect(204);

    await expect(
      prisma.productImage.findUnique({ where: { id: image.id } }),
    ).resolves.toBeNull();

    const fetched = await fetch(image.url);
    expect(fetched.status).toBe(404);
  });

  it('promotes the next image by position when the deleted image was primary', async () => {
    const product = await prisma.product.create({
      data: {
        slug: `${PRODUCT_SLUG}-promotion`,
        title: 'Promotion test piece',
        priceCents: 1000n,
        status: 'published',
      },
    });

    const first = await admin
      .post(`/products/${product.id}/images`)
      .field('isPrimary', 'true')
      .attach('file', ONE_PIXEL_PNG, 'first.png')
      .expect(201);
    const firstImage = (
      first.body as { images: { id: string; isPrimary: boolean }[] }
    ).images[0]!;

    const second = await admin
      .post(`/products/${product.id}/images`)
      .attach('file', ONE_PIXEL_PNG, 'second.png')
      .expect(201);
    const secondImage = (
      second.body as { images: { id: string }[] }
    ).images.find((img) => img.id !== firstImage.id)!;

    await admin
      .delete(`/products/${product.id}/images/${firstImage.id}`)
      .expect(204);

    const remaining = await prisma.productImage.findUniqueOrThrow({
      where: { id: secondImage.id },
    });
    expect(remaining.isPrimary).toBe(true);

    await prisma.product.delete({ where: { id: product.id } });
  });

  it('replaces an image file in place, keeping the same id but serving new bytes', async () => {
    const product = await prisma.product.create({
      data: {
        slug: `${PRODUCT_SLUG}-replace`,
        title: 'Replace test piece',
        priceCents: 1000n,
        status: 'published',
      },
    });

    const upload = await admin
      .post(`/products/${product.id}/images`)
      .field('altText', 'Original alt text')
      .attach('file', ONE_PIXEL_PNG, 'original.png')
      .expect(201);
    const original = (
      upload.body as { images: { id: string; url: string; altText: string }[] }
    ).images[0]!;

    const replaced = await admin
      .put(`/products/${product.id}/images/${original.id}`)
      .attach('file', ONE_PIXEL_PNG_V2, 'replacement.png')
      .expect(200);
    const updatedImage = (
      replaced.body as {
        images: { id: string; url: string; altText: string | null }[];
      }
    ).images.find((img) => img.id === original.id)!;

    // Same row (same id), new URL pointing at the new object, and altText
    // preserved since the replace request didn't override it.
    expect(updatedImage.id).toBe(original.id);
    expect(updatedImage.url).not.toBe(original.url);
    expect(updatedImage.altText).toBe('Original alt text');

    const fetchedNew = await fetch(updatedImage.url);
    expect(fetchedNew.status).toBe(200);
    const newBytes = Buffer.from(await fetchedNew.arrayBuffer());
    expect(newBytes.equals(ONE_PIXEL_PNG_V2)).toBe(true);

    // The old object is actually gone from storage, not just unreferenced.
    const fetchedOld = await fetch(original.url);
    expect(fetchedOld.status).toBe(404);

    await prisma.product.delete({ where: { id: product.id } });
  });

  it('rejects a replace without an admin session', async () => {
    const product = await prisma.product.create({
      data: {
        slug: `${PRODUCT_SLUG}-replace-auth`,
        title: 'Replace auth test piece',
        priceCents: 1000n,
        status: 'published',
      },
    });
    const image = await prisma.productImage.create({
      data: { productId: product.id, url: 'https://example.com/x.png' },
    });

    await request(app.getHttpServer())
      .put(`/products/${product.id}/images/${image.id}`)
      .attach('file', ONE_PIXEL_PNG, 'pixel.png')
      .expect(401);

    await prisma.product.delete({ where: { id: product.id } });
  });

  it('edits alt text per locale, position, and primary without re-uploading', async () => {
    const slug = `${PRODUCT_SLUG}-patch`;
    const product = await prisma.product.create({
      data: {
        slug,
        title: 'Patch test piece',
        priceCents: 1000n,
        status: 'published',
      },
    });
    type ImagesBody = {
      images: { id: string; url: string; altText: string | null }[];
    };

    const first = await admin
      .post(`/products/${product.id}/images`)
      .field('altText', 'A cat')
      .field('isPrimary', 'true')
      .attach('file', ONE_PIXEL_PNG, 'first.png')
      .expect(201);
    const firstImage = (first.body as ImagesBody).images[0]!;

    const second = await admin
      .post(`/products/${product.id}/images`)
      .attach('file', ONE_PIXEL_PNG_V2, 'second.png')
      .expect(201);
    const secondImage = (second.body as ImagesBody).images.find(
      (img) => img.id !== firstImage.id,
    )!;

    // Add Spanish alt text; the English one from the upload stays.
    await admin
      .patch(`/products/${product.id}/images/${firstImage.id}`)
      .send({ translations: [{ localeCode: 'es', altText: 'Un gato' }] })
      .expect(200);

    const altTextIn = async (locale: string) => {
      const res = await request(app.getHttpServer())
        .get(`/products/${slug}`)
        .query({ locale })
        .expect(200);
      return (res.body as ImagesBody).images.find(
        (img) => img.id === firstImage.id,
      )?.altText;
    };
    expect(await altTextIn('es')).toBe('Un gato');
    expect(await altTextIn('en')).toBe('A cat');
    expect(await altTextIn('de')).toBe('A cat'); // no German → default locale

    // Unknown locale → 400 naming it; nothing written.
    const bad = await admin
      .patch(`/products/${product.id}/images/${firstImage.id}`)
      .send({ translations: [{ localeCode: 'xx', altText: '???' }] })
      .expect(400);
    expect((bad.body as { message: string }).message).toContain('xx');

    // Un-flagging the primary is rejected — it would leave none.
    await admin
      .patch(`/products/${product.id}/images/${firstImage.id}`)
      .send({ isPrimary: false })
      .expect(400);

    // Promoting the second image demotes the first, and the file is untouched.
    await admin
      .patch(`/products/${product.id}/images/${secondImage.id}`)
      .send({ isPrimary: true, position: 0 })
      .expect(200);

    const images = await prisma.productImage.findMany({
      where: { productId: product.id },
    });
    const promoted = images.find((img) => img.id === secondImage.id)!;
    expect(images.filter((img) => img.isPrimary)).toHaveLength(1);
    expect(promoted.isPrimary).toBe(true);
    expect(promoted.position).toBe(0);
    expect(promoted.url).toBe(secondImage.url);

    await prisma.product.delete({ where: { id: product.id } });
  });

  it('rejects an image PATCH without an admin session', async () => {
    const product = await prisma.product.create({
      data: {
        slug: `${PRODUCT_SLUG}-patch-auth`,
        title: 'Patch auth test piece',
        priceCents: 1000n,
        status: 'published',
      },
    });
    const image = await prisma.productImage.create({
      data: { productId: product.id, url: 'https://example.com/x.png' },
    });

    await request(app.getHttpServer())
      .patch(`/products/${product.id}/images/${image.id}`)
      .send({ position: 1 })
      .expect(401);

    await prisma.product.delete({ where: { id: product.id } });
  });

  it('returns 404 for an image id that does not belong to the product', async () => {
    const otherProduct = await prisma.product.create({
      data: {
        slug: `${PRODUCT_SLUG}-other`,
        title: 'Other product',
        priceCents: 1000n,
        status: 'published',
      },
    });
    const otherImage = await prisma.productImage.create({
      data: { productId: otherProduct.id, url: 'https://example.com/x.png' },
    });

    await admin
      .delete(`/products/${productId}/images/${otherImage.id}`)
      .expect(404);

    await prisma.product.delete({ where: { id: otherProduct.id } });
  });
});
