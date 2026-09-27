import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { configureApp } from '../../src/configure-app';

const SLUG_PREFIX = 'e2e-search-';

describe('Products search (e2e)', () => {
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

    // Matches via title (mixed case, proving case-insensitivity).
    await prisma.product.create({
      data: {
        slug: `${SLUG_PREFIX}title-match`,
        title: 'Portrait of a CAT',
        priceCents: 1000n,
        status: 'published',
      },
    });

    // Matches via description only.
    await prisma.product.create({
      data: {
        slug: `${SLUG_PREFIX}description-match`,
        title: 'Untitled No. 4',
        priceCents: 1000n,
        status: 'published',
        translations: {
          create: [
            { localeCode: 'en', description: 'A sleeping cat by the window.' },
          ],
        },
      },
    });

    // Matches via medium only.
    await prisma.product.create({
      data: {
        slug: `${SLUG_PREFIX}medium-match`,
        title: 'Untitled No. 7',
        medium: 'Catalyzed resin',
        priceCents: 1000n,
        status: 'published',
      },
    });

    // Matches via style only.
    await prisma.product.create({
      data: {
        slug: `${SLUG_PREFIX}style-match`,
        title: 'Untitled No. 9',
        style: 'Neo-Catalan',
        priceCents: 1000n,
        status: 'published',
      },
    });

    // No match at all.
    await prisma.product.create({
      data: {
        slug: `${SLUG_PREFIX}no-match`,
        title: 'Mountain Landscape',
        priceCents: 1000n,
        status: 'published',
        translations: {
          create: [
            { localeCode: 'en', description: 'Snow-capped peaks at dawn.' },
          ],
        },
      },
    });

    // Matches, but not published — must not appear in results.
    await prisma.product.create({
      data: {
        slug: `${SLUG_PREFIX}draft-match`,
        title: 'Draft Cat Sketch',
        priceCents: 1000n,
        status: 'draft',
      },
    });

    // Typo-tolerance fixtures — verified against the real database before
    // writing this test (see the word_similarity() comment in
    // products.service.ts): searching a misspelling finds these via
    // word_similarity, not via the plain ILIKE substring check, since
    // neither string contains the other.
    await prisma.product.create({
      data: {
        slug: `${SLUG_PREFIX}typo-medium`,
        title: 'Untitled No. 12',
        medium: 'Watercolor',
        priceCents: 1000n,
        status: 'published',
      },
    });

    // A typo'd word buried in a longer title — this is exactly the case
    // plain similarity() handles poorly (whole-string comparison degrades
    // as the title grows) but word_similarity() handles correctly (it
    // finds the best-matching word-length substring instead).
    await prisma.product.create({
      data: {
        slug: `${SLUG_PREFIX}typo-title`,
        title: 'Golden Sunset Hour',
        priceCents: 1000n,
        status: 'published',
      },
    });
  });

  afterAll(async () => {
    await prisma.product.deleteMany({
      where: { slug: { startsWith: SLUG_PREFIX } },
    });
    await app.close();
  });

  it('matches title, medium, style, and description, case-insensitively, only for published products', async () => {
    const res = await request(app.getHttpServer())
      .get('/products')
      .query({ search: 'cat' })
      .expect(200);

    const slugs = (res.body as { data: { slug: string }[] }).data
      .map((p) => p.slug)
      .filter((slug) => slug.startsWith(SLUG_PREFIX));

    expect(slugs).toEqual(
      expect.arrayContaining([
        `${SLUG_PREFIX}title-match`,
        `${SLUG_PREFIX}description-match`,
        `${SLUG_PREFIX}medium-match`,
        `${SLUG_PREFIX}style-match`,
      ]),
    );
    expect(slugs).not.toContain(`${SLUG_PREFIX}no-match`);
    expect(slugs).not.toContain(`${SLUG_PREFIX}draft-match`);
  });

  it('tolerates a British/American spelling variant with no shared substring', async () => {
    const res = await request(app.getHttpServer())
      .get('/products')
      .query({ search: 'watercolour' }) // fixture has "Watercolor" — no substring overlap
      .expect(200);

    const slugs = (res.body as { data: { slug: string }[] }).data.map(
      (p) => p.slug,
    );
    expect(slugs).toContain(`${SLUG_PREFIX}typo-medium`);
  });

  it('finds a misspelled word inside a longer title', async () => {
    const res = await request(app.getHttpServer())
      .get('/products')
      .query({ search: 'sunst' }) // fixture title is "Golden Sunset Hour"
      .expect(200);

    const slugs = (res.body as { data: { slug: string }[] }).data.map(
      (p) => p.slug,
    );
    expect(slugs).toContain(`${SLUG_PREFIX}typo-title`);
  });

  it('returns no results for a term nothing matches', async () => {
    const res = await request(app.getHttpServer())
      .get('/products')
      .query({ search: `${SLUG_PREFIX}-nonexistent-term-xyz` })
      .expect(200);

    expect((res.body as { data: unknown[] }).data).toEqual([]);
  });
});
