import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductStatus } from '@prisma/client';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { ProductsService } from '../../../src/products/products.service';
import { CreateProductDto } from '../../../src/products/dto/create-product.dto';
import { UpdateProductDto } from '../../../src/products/dto/update-product.dto';

type MockPrisma = {
  product: {
    findMany: Mock;
    count: Mock;
    findUnique: Mock;
    findUniqueOrThrow: Mock;
    create: Mock;
    update: Mock;
  };
  productImage: {
    findUnique: Mock;
    findFirst: Mock;
    create: Mock;
    update: Mock;
    updateMany: Mock;
    delete: Mock;
    count: Mock;
  };
  productTranslation: {
    upsert: Mock;
  };
  locale: {
    findFirst: Mock;
  };
  $transaction: Mock;
  $queryRaw: Mock;
};

type MockStorage = {
  uploadPublicObject: Mock;
  deleteObjectByUrl: Mock;
};

function createMockPrisma(): MockPrisma {
  const prisma = {
    product: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    productImage: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    productTranslation: {
      upsert: vi.fn(),
    },
    locale: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  } satisfies MockPrisma;

  // Supports both the array form ($transaction([...])) and the interactive
  // callback form ($transaction(async (tx) => ...)) — addImage uses the
  // latter, findPublished's search path uses the former. The callback gets
  // the mock itself as `tx`, so assertions against prisma.productImage.*
  // see the writes made inside the transaction.
  prisma.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: typeof prisma) => unknown)(prisma)
      : Promise.all(arg as unknown[]),
  );

  return prisma;
}

function createMockStorage(): MockStorage {
  return {
    uploadPublicObject: vi.fn(),
    deleteObjectByUrl: vi.fn(),
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
  let storage: MockStorage;

  beforeEach(() => {
    prisma = createMockPrisma();
    storage = createMockStorage();
    prisma.locale.findFirst.mockResolvedValue(DEFAULT_LOCALE);
    service = new ProductsService(prisma as unknown as PrismaService, storage);
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

    describe('search', () => {
      it('returns no results without querying the ranking SQL when nothing matches the structural filters', async () => {
        prisma.product.findMany.mockResolvedValue([]);

        const result = await service.findPublished({ search: 'cat' });

        expect(result).toEqual({ data: [], page: 1, pageSize: 24, total: 0 });
        expect(prisma.$queryRaw).not.toHaveBeenCalled();
      });

      it('finds candidates via the same structural filters as the non-search path', async () => {
        prisma.product.findMany
          .mockResolvedValueOnce([{ id: 'p1' }]) // candidate lookup
          .mockResolvedValueOnce([buildProduct()]); // final page fetch
        prisma.$queryRaw.mockResolvedValue([{ id: 'p1', relevance: 0.9 }]);

        await service.findPublished({
          search: 'cat',
          categorySlug: 'abstract',
        });

        expect(prisma.product.findMany).toHaveBeenNthCalledWith(1, {
          where: {
            status: ProductStatus.published,
            category: { slug: 'abstract' },
          },
          select: { id: true },
        });
      });

      it('orders the response to match the SQL relevance ranking, not the DB fetch order', async () => {
        prisma.product.findMany
          .mockResolvedValueOnce([{ id: 'p1' }, { id: 'p2' }])
          .mockResolvedValueOnce([
            buildProduct({ id: 'p2', slug: 'less-relevant' }),
            buildProduct({ id: 'p1', slug: 'more-relevant' }),
          ]);
        prisma.$queryRaw.mockResolvedValue([
          { id: 'p1', relevance: 0.9 },
          { id: 'p2', relevance: 0.4 },
        ]);

        const result = await service.findPublished({ search: 'cat' });

        expect(result.data.map((p) => p.slug)).toEqual([
          'more-relevant',
          'less-relevant',
        ]);
        expect(result.total).toBe(2);
      });

      it('paginates the ranked results in memory', async () => {
        const ids = ['p1', 'p2', 'p3'];
        prisma.product.findMany
          .mockResolvedValueOnce(ids.map((id) => ({ id })))
          .mockResolvedValueOnce([
            buildProduct({ id: 'p2', slug: 'page-2-item' }),
          ]);
        prisma.$queryRaw.mockResolvedValue(
          ids.map((id, i) => ({ id, relevance: 1 - i * 0.1 })),
        );

        const result = await service.findPublished({
          search: 'cat',
          page: 2,
          pageSize: 1,
        });

        expect(result.total).toBe(3);
        expect(result.data.map((p) => p.slug)).toEqual(['page-2-item']);
      });
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

  describe('addImage', () => {
    const file = { buffer: Buffer.from('fake-bytes'), mimetype: 'image/png' };

    it('throws NotFoundException if the product does not exist', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(service.addImage('missing', file, {})).rejects.toThrow(
        NotFoundException,
      );
      expect(storage.uploadPublicObject).not.toHaveBeenCalled();
    });

    it('uploads to storage before writing the DB row, keyed under the product id', async () => {
      prisma.product.findUnique.mockResolvedValue(buildProduct());
      storage.uploadPublicObject.mockResolvedValue('https://cdn/x/key.png');
      prisma.productImage.count.mockResolvedValue(0);
      prisma.product.findUniqueOrThrow.mockResolvedValue(buildProduct());

      await service.addImage('p1', file, { altText: 'A cat painting' });

      expect(storage.uploadPublicObject).toHaveBeenCalledWith(
        expect.objectContaining({
          key: expect.stringMatching(/^products\/p1\/.+\.png$/),
          body: file.buffer,
          contentType: 'image/png',
        }),
      );
      const uploadOrder =
        storage.uploadPublicObject.mock.invocationCallOrder[0]!;
      const createOrder =
        prisma.productImage.create.mock.invocationCallOrder[0]!;
      expect(uploadOrder).toBeLessThan(createOrder);
      expect(prisma.productImage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            productId: 'p1',
            url: 'https://cdn/x/key.png',
            altText: 'A cat painting',
            isPrimary: false,
            position: 0,
          }),
        }),
      );
    });

    it('unsets the previous primary image when the new one is marked primary', async () => {
      prisma.product.findUnique.mockResolvedValue(buildProduct());
      storage.uploadPublicObject.mockResolvedValue('https://cdn/x/key.png');
      prisma.productImage.count.mockResolvedValue(1);
      prisma.product.findUniqueOrThrow.mockResolvedValue(buildProduct());

      await service.addImage('p1', file, { isPrimary: true });

      expect(prisma.productImage.updateMany).toHaveBeenCalledWith({
        where: { productId: 'p1', isPrimary: true },
        data: { isPrimary: false },
      });
    });

    it('maps a concurrent-primary race (unique constraint) to a 409, not a bare 500', async () => {
      prisma.product.findUnique.mockResolvedValue(buildProduct());
      storage.uploadPublicObject.mockResolvedValue('https://cdn/x/key.png');
      prisma.productImage.create.mockImplementation(() => {
        throw new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed on the fields: (`product_id`)',
          { code: 'P2002', clientVersion: '5.22.0' },
        );
      });

      await expect(
        service.addImage('p1', file, { isPrimary: true }),
      ).rejects.toThrow(ConflictException);
      // The write definitely didn't happen, so the upload is cleaned up.
      expect(storage.deleteObjectByUrl).toHaveBeenCalledWith(
        'https://cdn/x/key.png',
      );
    });

    it('keeps the upload when the DB failure is ambiguous (may have committed)', async () => {
      prisma.product.findUnique.mockResolvedValue(buildProduct());
      storage.uploadPublicObject.mockResolvedValue('https://cdn/x/key.png');
      prisma.productImage.count.mockResolvedValue(0);
      prisma.productImage.create.mockRejectedValue(
        new Error('Connection terminated unexpectedly'),
      );

      await expect(service.addImage('p1', file, {})).rejects.toThrow(
        'Connection terminated unexpectedly',
      );
      expect(storage.deleteObjectByUrl).not.toHaveBeenCalled();
    });

    it('still surfaces the original error when the cleanup itself fails', async () => {
      prisma.product.findUnique.mockResolvedValue(buildProduct());
      storage.uploadPublicObject.mockResolvedValue('https://cdn/x/key.png');
      storage.deleteObjectByUrl.mockRejectedValue(new Error('storage down'));
      prisma.productImage.create.mockImplementation(() => {
        throw new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed on the fields: (`product_id`)',
          { code: 'P2002', clientVersion: '5.22.0' },
        );
      });

      await expect(
        service.addImage('p1', file, { isPrimary: true }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('replaceImage', () => {
    const file = { buffer: Buffer.from('new-bytes'), mimetype: 'image/webp' };
    const existingImage = {
      id: 'img1',
      productId: 'p1',
      url: 'https://cdn/x/old.png',
      altText: 'Old alt text',
      isPrimary: false,
      position: 2,
    };

    it('throws NotFoundException when the image does not exist', async () => {
      prisma.productImage.findUnique.mockResolvedValue(null);

      await expect(service.replaceImage('p1', 'img1', file)).rejects.toThrow(
        NotFoundException,
      );
      expect(storage.uploadPublicObject).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the image belongs to a different product', async () => {
      prisma.productImage.findUnique.mockResolvedValue({
        ...existingImage,
        productId: 'other-product',
      });

      await expect(service.replaceImage('p1', 'img1', file)).rejects.toThrow(
        NotFoundException,
      );
      expect(storage.uploadPublicObject).not.toHaveBeenCalled();
    });

    it('uploads the new file, updates the row, then deletes the old object last', async () => {
      prisma.productImage.findUnique.mockResolvedValue(existingImage);
      storage.uploadPublicObject.mockResolvedValue('https://cdn/x/new.webp');
      prisma.product.findUniqueOrThrow.mockResolvedValue(buildProduct());

      await service.replaceImage('p1', 'img1', file);

      expect(storage.uploadPublicObject).toHaveBeenCalledWith(
        expect.objectContaining({
          key: expect.stringMatching(/^products\/p1\/.+\.webp$/),
          body: file.buffer,
          contentType: 'image/webp',
        }),
      );
      const uploadOrder =
        storage.uploadPublicObject.mock.invocationCallOrder[0]!;
      const updateOrder =
        prisma.productImage.update.mock.invocationCallOrder[0]!;
      const oldDeleteOrder =
        storage.deleteObjectByUrl.mock.invocationCallOrder[0]!;
      expect(uploadOrder).toBeLessThan(updateOrder);
      expect(updateOrder).toBeLessThan(oldDeleteOrder);
      expect(storage.deleteObjectByUrl).toHaveBeenCalledWith(
        'https://cdn/x/old.png',
      );
    });

    it('updates only the url — never altText, isPrimary, or position', async () => {
      prisma.productImage.findUnique.mockResolvedValue(existingImage);
      storage.uploadPublicObject.mockResolvedValue('https://cdn/x/new.webp');
      prisma.product.findUniqueOrThrow.mockResolvedValue(buildProduct());

      await service.replaceImage('p1', 'img1', file);

      expect(prisma.productImage.update).toHaveBeenCalledWith({
        where: { id: 'img1' },
        data: { url: 'https://cdn/x/new.webp' },
      });
      expect(prisma.productImage.updateMany).not.toHaveBeenCalled();
    });

    it('maps the row being deleted concurrently (P2025) to a 404, discarding only the new upload', async () => {
      prisma.productImage.findUnique.mockResolvedValue(existingImage);
      storage.uploadPublicObject.mockResolvedValue('https://cdn/x/new.webp');
      prisma.productImage.update.mockImplementation(() => {
        throw new Prisma.PrismaClientKnownRequestError(
          'Record to update not found.',
          { code: 'P2025', clientVersion: '5.22.0' },
        );
      });

      await expect(service.replaceImage('p1', 'img1', file)).rejects.toThrow(
        NotFoundException,
      );
      expect(storage.deleteObjectByUrl).toHaveBeenCalledTimes(1);
      expect(storage.deleteObjectByUrl).toHaveBeenCalledWith(
        'https://cdn/x/new.webp',
      );
    });

    it('keeps both objects when the DB failure is ambiguous (may have committed)', async () => {
      prisma.productImage.findUnique.mockResolvedValue(existingImage);
      storage.uploadPublicObject.mockResolvedValue('https://cdn/x/new.webp');
      prisma.productImage.update.mockRejectedValue(
        new Error('Connection terminated unexpectedly'),
      );

      await expect(service.replaceImage('p1', 'img1', file)).rejects.toThrow(
        'Connection terminated unexpectedly',
      );
      expect(storage.deleteObjectByUrl).not.toHaveBeenCalled();
    });
  });

  describe('removeImage', () => {
    it('throws NotFoundException when the image does not exist', async () => {
      prisma.productImage.findUnique.mockResolvedValue(null);

      await expect(service.removeImage('p1', 'img1')).rejects.toThrow(
        NotFoundException,
      );
      expect(storage.deleteObjectByUrl).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the image belongs to a different product', async () => {
      prisma.productImage.findUnique.mockResolvedValue({
        id: 'img1',
        productId: 'other-product',
        url: 'https://cdn/x/key.png',
      });

      await expect(service.removeImage('p1', 'img1')).rejects.toThrow(
        NotFoundException,
      );
      expect(storage.deleteObjectByUrl).not.toHaveBeenCalled();
    });

    it('deletes from storage before deleting the DB row', async () => {
      prisma.productImage.findUnique.mockResolvedValue({
        id: 'img1',
        productId: 'p1',
        url: 'https://cdn/x/key.png',
      });

      await service.removeImage('p1', 'img1');

      const deleteStorageOrder =
        storage.deleteObjectByUrl.mock.invocationCallOrder[0]!;
      const deleteDbOrder =
        prisma.productImage.delete.mock.invocationCallOrder[0]!;
      expect(storage.deleteObjectByUrl).toHaveBeenCalledWith(
        'https://cdn/x/key.png',
      );
      expect(deleteStorageOrder).toBeLessThan(deleteDbOrder);
      expect(prisma.productImage.delete).toHaveBeenCalledWith({
        where: { id: 'img1' },
      });
    });

    it('does not look for a replacement primary when the deleted image was not primary', async () => {
      prisma.productImage.findUnique.mockResolvedValue({
        id: 'img1',
        productId: 'p1',
        url: 'https://cdn/x/key.png',
        isPrimary: false,
      });

      await service.removeImage('p1', 'img1');

      expect(prisma.productImage.findFirst).not.toHaveBeenCalled();
      expect(prisma.productImage.update).not.toHaveBeenCalled();
    });

    it('promotes the next image by position when the deleted image was primary', async () => {
      prisma.productImage.findUnique.mockResolvedValue({
        id: 'img1',
        productId: 'p1',
        url: 'https://cdn/x/key.png',
        isPrimary: true,
      });
      prisma.productImage.findFirst.mockResolvedValue({
        id: 'img2',
        productId: 'p1',
        position: 1,
      });

      await service.removeImage('p1', 'img1');

      expect(prisma.productImage.findFirst).toHaveBeenCalledWith({
        where: { productId: 'p1' },
        orderBy: { position: 'asc' },
      });
      expect(prisma.productImage.update).toHaveBeenCalledWith({
        where: { id: 'img2' },
        data: { isPrimary: true },
      });
    });

    it('leaves the product with no primary image when the deleted one was primary and no images remain', async () => {
      prisma.productImage.findUnique.mockResolvedValue({
        id: 'img1',
        productId: 'p1',
        url: 'https://cdn/x/key.png',
        isPrimary: true,
      });
      prisma.productImage.findFirst.mockResolvedValue(null);

      await service.removeImage('p1', 'img1');

      expect(prisma.productImage.update).not.toHaveBeenCalled();
    });

    it('maps a concurrent delete of the same image (P2025) to a 404', async () => {
      prisma.productImage.findUnique.mockResolvedValue({
        id: 'img1',
        productId: 'p1',
        url: 'https://cdn/x/key.png',
        isPrimary: false,
      });
      prisma.productImage.delete.mockImplementation(() => {
        throw new Prisma.PrismaClientKnownRequestError(
          'Record to delete does not exist.',
          { code: 'P2025', clientVersion: '5.22.0' },
        );
      });

      await expect(service.removeImage('p1', 'img1')).rejects.toThrow(
        NotFoundException,
      );
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
