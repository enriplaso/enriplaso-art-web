import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductStatus } from '@prisma/client';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { ProductsService } from '../../../src/products/products.service';
import { CreateProductDto } from '../../../src/products/dto/create-product.dto';
import { UpdateProductDto } from '../../../src/products/dto/update-product.dto';

type MockPrisma = {
  product: {
    findMany: Mock;
    count: Mock;
    findUnique: Mock;
    create: Mock;
    update: Mock;
  };
  productTranslation: {
    upsert: Mock;
  };
  locale: {
    findFirst: Mock;
  };
  $transaction: Mock;
};

function createMockPrisma(): MockPrisma {
  return {
    product: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    productTranslation: {
      upsert: vi.fn(),
    },
    locale: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn((arg: unknown[]) => Promise.all(arg)),
  };
}

const DEFAULT_LOCALE = {
  code: 'en',
  name: 'English',
  isDefault: true,
  isActive: true,
  createdAt: new Date(),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildProduct(overrides: Record<string, any> = {}) {
  return {
    id: 'p1',
    sku: null,
    slug: 'sunset-oil',
    title: 'Sunset in Oil',
    medium: null,
    style: null,
    yearCreated: null,
    widthCm: null,
    heightCm: null,
    depthCm: null,
    weightKg: null,
    priceCents: 45000n,
    currency: 'EUR',
    categoryId: null,
    tags: [],
    isUnique: true,
    quantityAvailable: 1,
    status: ProductStatus.published,
    reservedUntil: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    translations: [
      {
        productId: 'p1',
        localeCode: 'en',
        description: 'An English description.',
      },
    ],
    images: [
      {
        id: 'img1',
        productId: 'p1',
        url: 'https://x/1.jpg',
        altText: null,
        position: 0,
        isPrimary: true,
        createdAt: new Date(),
      },
    ],
    category: null,
    ...overrides,
  };
}

describe('ProductsService', () => {
  let service: ProductsService;
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = createMockPrisma();
    prisma.locale.findFirst.mockResolvedValue(DEFAULT_LOCALE);
    service = new ProductsService(prisma as unknown as PrismaService);
  });

  describe('findPublished', () => {
    it('filters by status=published and applies default pagination', async () => {
      prisma.product.findMany.mockResolvedValue([buildProduct()]);
      prisma.product.count.mockResolvedValue(1);

      const result = await service.findPublished({});

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: ProductStatus.published },
          skip: 0,
          take: 24,
        }),
      );
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(24);
      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]?.priceCents).toBe('45000');
    });

    it('filters by categorySlug and tag, and applies given pagination', async () => {
      prisma.product.findMany.mockResolvedValue([]);
      prisma.product.count.mockResolvedValue(0);

      await service.findPublished({
        categorySlug: 'abstract',
        tag: 'blue',
        page: 2,
        pageSize: 10,
      });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: ProductStatus.published,
            category: { slug: 'abstract' },
            tags: { has: 'blue' },
          },
          skip: 10,
          take: 10,
        }),
      );
    });

    it('falls back to the default locale when the requested locale has no translation', async () => {
      prisma.product.findMany.mockResolvedValue([buildProduct()]);
      prisma.product.count.mockResolvedValue(1);

      const result = await service.findPublished({ locale: 'es' });

      expect(result.data).toHaveLength(1);
      expect(result.data[0]?.description).toBe('An English description.');
    });

    it('throws if no default locale is configured', async () => {
      prisma.locale.findFirst.mockResolvedValue(null);

      await expect(service.findPublished({})).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('findBySlug', () => {
    it('returns the mapped product when published', async () => {
      prisma.product.findUnique.mockResolvedValue(buildProduct());

      const result = await service.findBySlug('sunset-oil');

      expect(result.slug).toBe('sunset-oil');
      expect(result.primaryImageUrl).toBe('https://x/1.jpg');
    });

    it('throws NotFoundException when the product does not exist', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(service.findBySlug('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the product is not published', async () => {
      prisma.product.findUnique.mockResolvedValue(
        buildProduct({ status: ProductStatus.draft }),
      );

      await expect(service.findBySlug('sunset-oil')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('picks the first image (by position) as primary when none is flagged isPrimary', async () => {
      prisma.product.findUnique.mockResolvedValue(
        buildProduct({
          images: [
            {
              id: 'a',
              url: 'https://x/a.jpg',
              altText: null,
              position: 0,
              isPrimary: false,
              productId: 'p1',
              createdAt: new Date(),
            },
            {
              id: 'b',
              url: 'https://x/b.jpg',
              altText: null,
              position: 1,
              isPrimary: false,
              productId: 'p1',
              createdAt: new Date(),
            },
          ],
        }),
      );

      const result = await service.findBySlug('sunset-oil');

      expect(result.primaryImageUrl).toBe('https://x/a.jpg');
    });
  });

  describe('create', () => {
    it('rejects a one-of-a-kind product with quantityAvailable > 1 before hitting the database', async () => {
      const dto: CreateProductDto = {
        slug: 'x',
        title: 'X',
        priceCents: 100,
        isUnique: true,
        quantityAvailable: 2,
      };

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
      expect(prisma.product.create).not.toHaveBeenCalled();
    });

    it('converts priceCents to BigInt and nests translations on create', async () => {
      prisma.product.create.mockResolvedValue(buildProduct());

      const dto: CreateProductDto = {
        slug: 'sunset-oil',
        title: 'Sunset in Oil',
        priceCents: 45000,
        translations: [
          { localeCode: 'en', description: 'An English description.' },
        ],
      };

      await service.create(dto);

      expect(prisma.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            priceCents: 45000n,
            translations: {
              create: [
                { localeCode: 'en', description: 'An English description.' },
              ],
            },
          }),
        }),
      );
    });

    it('omits the translations key entirely when none are provided', async () => {
      prisma.product.create.mockResolvedValue(
        buildProduct({ translations: [] }),
      );

      const dto: CreateProductDto = { slug: 'x', title: 'X', priceCents: 100 };
      await service.create(dto);

      const callArg = prisma.product.create.mock.calls[0]?.[0] as {
        data: { translations?: unknown };
      };
      expect(callArg.data.translations).toBeUndefined();
    });
  });

  describe('update', () => {
    it('throws NotFoundException if the product does not exist', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(service.update('missing', {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('validates isUnique/quantityAvailable using existing values merged with the DTO', async () => {
      prisma.product.findUnique.mockResolvedValue(
        buildProduct({ isUnique: true, quantityAvailable: 1 }),
      );

      const dto: UpdateProductDto = { quantityAvailable: 5 };
      await expect(service.update('p1', dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.product.update).not.toHaveBeenCalled();
    });

    it('upserts translations and updates the product', async () => {
      prisma.product.findUnique.mockResolvedValue(buildProduct());
      prisma.product.update.mockResolvedValue(
        buildProduct({ priceCents: 5000n }),
      );

      const dto: UpdateProductDto = {
        priceCents: 5000,
        translations: [{ localeCode: 'en', description: 'Updated.' }],
      };
      await service.update('p1', dto);

      expect(prisma.productTranslation.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            productId_localeCode: { productId: 'p1', localeCode: 'en' },
          },
          update: { description: 'Updated.' },
        }),
      );
      expect(prisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'p1' },
          data: expect.objectContaining({ priceCents: 5000n }),
        }),
      );
    });

    it('does not touch priceCents when it is not provided', async () => {
      prisma.product.findUnique.mockResolvedValue(buildProduct());
      prisma.product.update.mockResolvedValue(buildProduct());

      await service.update('p1', { title: 'New title' });

      const callArg = prisma.product.update.mock.calls[0]?.[0] as {
        data: { priceCents?: unknown; title?: unknown };
      };
      expect(callArg.data.priceCents).toBeUndefined();
      expect(callArg.data.title).toBe('New title');
    });
  });

  describe('archive', () => {
    it('throws NotFoundException if the product does not exist', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(service.archive('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('sets status to archived', async () => {
      prisma.product.findUnique.mockResolvedValue(buildProduct());
      prisma.product.update.mockResolvedValue(
        buildProduct({ status: ProductStatus.archived }),
      );

      await service.archive('p1');

      expect(prisma.product.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { status: ProductStatus.archived },
      });
    });
  });
});
