import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { CategoriesService } from '../../../src/categories/categories.service';

type MockPrisma = {
  category: {
    findMany: Mock;
    findUnique: Mock;
    create: Mock;
    update: Mock;
    delete: Mock;
  };
  categoryTranslation: { upsert: Mock };
  locale: { findFirst: Mock };
  $transaction: Mock;
};

function createMockPrisma(): MockPrisma {
  return {
    category: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    categoryTranslation: { upsert: vi.fn() },
    locale: { findFirst: vi.fn() },
    $transaction: vi.fn((arg: unknown[]) => Promise.all(arg)),
  };
}

function buildCategory(
  id: string,
  slug: string,
  translations: { localeCode: string; name: string }[],
  parentId: string | null = null,
) {
  return {
    id,
    slug,
    parentId,
    createdAt: new Date(),
    translations: translations.map((t) => ({
      categoryId: id,
      localeCode: t.localeCode,
      name: t.name,
      description: null,
    })),
  };
}

// Tree used by the hierarchy tests: A -> B -> C.
const TREE: Record<string, { id: string; parentId: string | null }> = {
  a: { id: 'a', parentId: null },
  b: { id: 'b', parentId: 'a' },
  c: { id: 'c', parentId: 'b' },
};

describe('CategoriesService', () => {
  let service: CategoriesService;
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = createMockPrisma();
    prisma.locale.findFirst.mockResolvedValue({ code: 'en', isDefault: true });
    service = new CategoriesService(prisma as unknown as PrismaService);
  });

  function useTree() {
    prisma.category.findUnique.mockImplementation(
      (args: { where: { id?: string } }) =>
        Promise.resolve(args.where.id ? (TREE[args.where.id] ?? null) : null),
    );
  }

  describe('findAll', () => {
    it('resolves names in the requested locale, falling back to the default, sorted by name', async () => {
      prisma.category.findMany.mockResolvedValue([
        buildCategory('1', 'zeta', [{ localeCode: 'en', name: 'Zeta' }]),
        buildCategory('2', 'alpha', [
          { localeCode: 'en', name: 'Alpha' },
          { localeCode: 'es', name: 'Alfa' },
        ]),
      ]);

      const result = await service.findAll('es');

      expect(result.map((c) => c.name)).toEqual(['Alfa', 'Zeta']);
    });
  });

  describe('findBySlug', () => {
    it('throws NotFoundException for an unknown slug', async () => {
      prisma.category.findUnique.mockResolvedValue(null);

      await expect(service.findBySlug('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('requires a translation for the default locale', async () => {
      await expect(
        service.create({
          slug: 'abstract',
          translations: [{ localeCode: 'es', name: 'Abstracto' }],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.category.create).not.toHaveBeenCalled();
    });

    it('rejects a parent that does not exist', async () => {
      prisma.category.findUnique.mockResolvedValue(null);

      await expect(
        service.create({
          slug: 'abstract',
          parentId: '00000000-0000-0000-0000-000000000000',
          translations: [{ localeCode: 'en', name: 'Abstract' }],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('maps a duplicate slug to a 409 instead of a raw database error', async () => {
      prisma.category.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.create({
          slug: 'abstract',
          translations: [{ localeCode: 'en', name: 'Abstract' }],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('creates the category with its translations', async () => {
      prisma.category.create.mockResolvedValue(
        buildCategory('1', 'abstract', [
          { localeCode: 'en', name: 'Abstract' },
        ]),
      );

      const result = await service.create({
        slug: 'abstract',
        translations: [{ localeCode: 'en', name: 'Abstract' }],
      });

      expect(prisma.category.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            slug: 'abstract',
            parentId: null,
            translations: {
              create: [
                { localeCode: 'en', name: 'Abstract', description: undefined },
              ],
            },
          }),
        }),
      );
      expect(result).toEqual({
        id: '1',
        slug: 'abstract',
        parentId: null,
        name: 'Abstract',
        description: null,
      });
    });
  });

  describe('update', () => {
    it('rejects making a category its own parent', async () => {
      useTree();

      await expect(service.update('a', { parentId: 'a' })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.category.update).not.toHaveBeenCalled();
    });

    it('rejects moving a category under one of its own descendants', async () => {
      useTree();

      await expect(service.update('a', { parentId: 'c' })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.category.update).not.toHaveBeenCalled();
    });

    it('allows a valid move and moving back to the top level', async () => {
      useTree();
      prisma.category.update.mockResolvedValue(
        buildCategory('c', 'c', [{ localeCode: 'en', name: 'C' }]),
      );

      await service.update('c', { parentId: 'a' });
      await service.update('c', { parentId: null });

      expect(prisma.category.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { parentId: 'a' } }),
      );
      expect(prisma.category.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { parentId: null } }),
      );
    });

    it('upserts translations', async () => {
      useTree();
      prisma.category.update.mockResolvedValue(
        buildCategory('a', 'a', [{ localeCode: 'en', name: 'A' }]),
      );

      await service.update('a', {
        translations: [{ localeCode: 'de', name: 'Abstrakt' }],
      });

      expect(prisma.categoryTranslation.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            categoryId_localeCode: { categoryId: 'a', localeCode: 'de' },
          },
        }),
      );
    });
  });

  describe('remove', () => {
    it('throws NotFoundException for an unknown id', async () => {
      prisma.category.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deletes the category', async () => {
      useTree();

      await service.remove('a');

      expect(prisma.category.delete).toHaveBeenCalledWith({
        where: { id: 'a' },
      });
    });
  });
});
