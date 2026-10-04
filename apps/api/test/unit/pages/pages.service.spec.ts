import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { PagesService } from '../../../src/pages/pages.service';

type MockPrisma = {
  page: {
    findMany: Mock;
    findUnique: Mock;
    create: Mock;
    update: Mock;
    delete: Mock;
  };
  pageTranslation: { upsert: Mock; deleteMany: Mock };
  locale: { findFirst: Mock; findMany: Mock };
  $transaction: Mock;
};

function createMockPrisma(): MockPrisma {
  const prisma: MockPrisma = {
    page: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    pageTranslation: { upsert: vi.fn(), deleteMany: vi.fn() },
    locale: { findFirst: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  // Interactive transaction: run the callback against the same mock.
  prisma.$transaction.mockImplementation(
    (fn: (tx: MockPrisma) => Promise<unknown>) => fn(prisma),
  );
  return prisma;
}

function buildPage(
  id: string,
  slug: string,
  translations: { localeCode: string; title: string }[],
) {
  return {
    id,
    slug,
    createdAt: new Date(),
    translations: translations.map((t) => ({
      pageId: id,
      localeCode: t.localeCode,
      title: t.title,
      body: `${t.title} body`,
      updatedAt: new Date(),
    })),
  };
}

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('failed', {
    code,
    clientVersion: 'test',
  });
}

const PAGE_ID = '00000000-0000-0000-0000-000000000001';

describe('PagesService', () => {
  let service: PagesService;
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = createMockPrisma();
    prisma.locale.findFirst.mockResolvedValue({ code: 'en', isDefault: true });
    prisma.locale.findMany.mockImplementation(
      (args: { where: { code: { in: string[] } } }) =>
        Promise.resolve(
          args.where.code.in
            .filter((code) => ['en', 'es', 'de', 'fr'].includes(code))
            .map((code) => ({ code })),
        ),
    );
    service = new PagesService(prisma as unknown as PrismaService);
  });

  describe('findAll', () => {
    it('resolves titles in the requested locale, falling back to the default, sorted by title', async () => {
      prisma.page.findMany.mockResolvedValue([
        buildPage('1', 'terms', [{ localeCode: 'en', title: 'Terms' }]),
        buildPage('2', 'about', [
          { localeCode: 'en', title: 'About me' },
          { localeCode: 'es', title: 'Sobre mí' },
        ]),
      ]);

      const result = await service.findAll('es');

      expect(result.map((p) => p.title)).toEqual(['Sobre mí', 'Terms']);
    });
  });

  describe('findBySlug', () => {
    it('reports the locale actually served when it falls back to the default', async () => {
      prisma.page.findUnique.mockResolvedValue(
        buildPage(PAGE_ID, 'about', [{ localeCode: 'en', title: 'About me' }]),
      );

      const result = await service.findBySlug('about', 'de');

      expect(result).toMatchObject({ localeCode: 'en', title: 'About me' });
    });

    it('throws NotFoundException for an unknown slug', async () => {
      prisma.page.findUnique.mockResolvedValue(null);

      await expect(service.findBySlug('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('requires a translation for the default locale', async () => {
      await expect(
        service.create({
          slug: 'about',
          translations: [{ localeCode: 'es', title: 'Sobre mí', body: '...' }],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.page.create).not.toHaveBeenCalled();
    });

    it('rejects an unknown locale code before writing', async () => {
      await expect(
        service.create({
          slug: 'about',
          translations: [
            { localeCode: 'en', title: 'About', body: '...' },
            { localeCode: 'xx', title: '??', body: '...' },
          ],
        }),
      ).rejects.toThrow(/xx/);
      expect(prisma.page.create).not.toHaveBeenCalled();
    });

    it('maps a duplicate slug to a 409', async () => {
      prisma.page.create.mockRejectedValue(prismaError('P2002'));

      await expect(
        service.create({
          slug: 'about',
          translations: [{ localeCode: 'en', title: 'About', body: '...' }],
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('upserts translations and updates the slug in one transaction', async () => {
      prisma.page.findUnique.mockResolvedValue({ id: PAGE_ID });
      prisma.page.update.mockResolvedValue(
        buildPage(PAGE_ID, 'about-me', [{ localeCode: 'en', title: 'About' }]),
      );

      await service.update(PAGE_ID, {
        slug: 'about-me',
        translations: [{ localeCode: 'es', title: 'Sobre mí', body: '...' }],
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.pageTranslation.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { pageId_localeCode: { pageId: PAGE_ID, localeCode: 'es' } },
        }),
      );
      expect(prisma.page.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { slug: 'about-me' } }),
      );
    });

    it('throws NotFoundException for an unknown page', async () => {
      prisma.page.findUnique.mockResolvedValue(null);

      await expect(service.update(PAGE_ID, { slug: 'x' })).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('maps a duplicate slug to a 409', async () => {
      prisma.page.findUnique.mockResolvedValue({ id: PAGE_ID });
      prisma.page.update.mockRejectedValue(prismaError('P2002'));

      await expect(service.update(PAGE_ID, { slug: 'terms' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('removeTranslation', () => {
    beforeEach(() => {
      prisma.page.findUnique.mockResolvedValue({ id: PAGE_ID });
    });

    it('refuses to remove the default-locale translation', async () => {
      await expect(service.removeTranslation(PAGE_ID, 'en')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.pageTranslation.deleteMany).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when there is no such translation', async () => {
      prisma.pageTranslation.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.removeTranslation(PAGE_ID, 'fr')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('removes a non-default translation', async () => {
      prisma.pageTranslation.deleteMany.mockResolvedValue({ count: 1 });

      await service.removeTranslation(PAGE_ID, 'es');

      expect(prisma.pageTranslation.deleteMany).toHaveBeenCalledWith({
        where: { pageId: PAGE_ID, localeCode: 'es' },
      });
    });
  });
});
