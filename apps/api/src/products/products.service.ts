import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, ProductStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertLocalesExist,
  getDefaultLocaleCode,
  pickTranslation,
} from '../i18n/locale.utils';
import {
  STORAGE_SERVICE,
  StorageService,
} from '../storage/storage.service.interface';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { SettingsService } from '../settings/settings.service';
import { QueryProductsDto } from './dto/query-products.dto';
import { AdminQueryProductsDto } from './dto/admin-query-products.dto';
import { UploadProductImageDto } from './dto/upload-product-image.dto';
import { UpdateProductImageDto } from './dto/update-product-image.dto';

const PRODUCT_WITH_RELATIONS = {
  translations: true,
  images: { include: { translations: true } },
  category: true,
} satisfies Prisma.ProductInclude;

type ProductWithRelations = Prisma.ProductGetPayload<{
  include: typeof PRODUCT_WITH_RELATIONS;
}>;

const DEFAULT_PAGE_SIZE = 24;

// What the public portfolio shows. Sold pieces stay visible (marked by
// `status`) rather than vanishing the moment they sell, and reserved ones
// stay so a piece doesn't flicker out of the gallery mid-checkout. Drafts
// and archived pieces are admin-only.
const PUBLIC_STATUSES: ProductStatus[] = [
  ProductStatus.published,
  ProductStatus.reserved,
  ProductStatus.sold,
];

@Injectable()
export class ProductsService {
  // Storage/DB inconsistencies the code tolerates on purpose (orphaned
  // objects, a failed cleanup) — they don't fail the request, so this log is
  // the only place they show up.
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    private readonly settings: SettingsService,
  ) {}

  // Public: the portfolio, and commerce fields (price, stock) only while
  // the shop is enabled — README's "Feature flag: SHOP_ENABLED".
  findPublic(query: QueryProductsDto) {
    return this.list(query, PUBLIC_STATUSES, this.settings.isShopEnabled());
  }

  // Admin: every status unless filtered, commerce fields always included.
  findForAdmin(query: AdminQueryProductsDto) {
    return this.list(query, query.status ? [query.status] : undefined, true);
  }

  private async list(
    query: QueryProductsDto,
    statuses: ProductStatus[] | undefined,
    includeCommerce: boolean,
  ) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const defaultLocale = await this.getDefaultLocaleCode();
    const locale = query.locale ?? defaultLocale;

    // status/categorySlug/tag only — search is handled separately below,
    // since ranking by fuzzy-match relevance needs raw SQL (Prisma has no
    // pg_trgm operators), which can't share a query with these filters.
    const where: Prisma.ProductWhereInput = {
      ...(statuses && { status: { in: statuses } }),
      ...(query.categorySlug && { category: { slug: query.categorySlug } }),
      ...(query.tag && { tags: { has: query.tag } }),
    };

    if (query.search) {
      return this.findBySearch(where, query.search, page, pageSize, {
        locale,
        defaultLocale,
        includeCommerce,
      });
    }

    const [products, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: PRODUCT_WITH_RELATIONS,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      data: products.map((p) =>
        this.toResponse(p, locale, defaultLocale, includeCommerce),
      ),
      page,
      pageSize,
      total,
    };
  }

  /**
   * Fuzzy/typo-tolerant search (README's "Search" section). Two phases:
   *  1. Prisma finds candidate IDs matching the structural filters
   *     (status/category/tag) — reuses the exact same `where` as the
   *     non-search path, so that filtering logic isn't duplicated in SQL.
   *  2. Raw SQL ranks those candidates by pg_trgm's word_similarity()
   *     across title/medium/style/description, combined with a plain
   *     ILIKE check so exact/substring matches are never missed.
   *
   *     word_similarity() (not plain similarity()/`%`) is deliberate:
   *     plain similarity() compares the *whole* field against the search
   *     term, so it degrades fast once the field is longer than the term
   *     — e.g. similarity('Golden Sunset Hour', 'sunst') ≈ 0.19, below
   *     the 0.3 default threshold, even though "sunst" is clearly a typo
   *     of a word actually in the title. word_similarity() instead finds
   *     the best-matching word-length substring, so the same example
   *     scores ≈ 0.67 — verified against the real database before
   *     picking this, not assumed.
   * The candidate set is small (this catalog's whole scale), so ranking
   * and pagination happen in JS rather than pushing OFFSET/LIMIT into the
   * raw query — simpler, and fine at this size.
   */
  private async findBySearch(
    structuralWhere: Prisma.ProductWhereInput,
    term: string,
    page: number,
    pageSize: number,
    view: { locale: string; defaultLocale: string; includeCommerce: boolean },
  ) {
    const { locale, defaultLocale, includeCommerce } = view;
    const candidates = await this.prisma.product.findMany({
      where: structuralWhere,
      select: { id: true },
    });
    const candidateIds = candidates.map((c) => c.id);

    if (candidateIds.length === 0) {
      return { data: [], page, pageSize, total: 0 };
    }

    const pattern = `%${term}%`;
    const ranked = await this.prisma.$queryRaw<
      { id: string; relevance: number }[]
    >`
      SELECT p.id AS id,
        GREATEST(
          word_similarity(${term}, p.title),
          word_similarity(${term}, coalesce(p.medium, '')),
          word_similarity(${term}, coalesce(p.style, '')),
          word_similarity(${term}, coalesce(pt.description, ''))
        ) AS relevance
      FROM products p
      LEFT JOIN product_translations pt
        ON pt.product_id = p.id AND pt.locale_code = ${locale}
      WHERE p.id::text IN (${Prisma.join(candidateIds)})
        AND (
          p.title ILIKE ${pattern} OR ${term} <% p.title
          OR p.medium ILIKE ${pattern} OR ${term} <% p.medium
          OR p.style ILIKE ${pattern} OR ${term} <% p.style
          OR (pt.description ILIKE ${pattern} OR ${term} <% pt.description)
        )
      ORDER BY relevance DESC
    `;

    const total = ranked.length;
    const start = (page - 1) * pageSize;
    const pageIds = ranked.slice(start, start + pageSize).map((r) => r.id);

    if (pageIds.length === 0) {
      return { data: [], page, pageSize, total };
    }

    const products = await this.prisma.product.findMany({
      where: { id: { in: pageIds } },
      include: PRODUCT_WITH_RELATIONS,
    });

    // findMany's `id: { in: ... }` doesn't preserve order, so re-sort to
    // match the relevance ranking computed above.
    const byId = new Map(products.map((p) => [p.id, p]));
    const ordered = pageIds
      .map((id) => byId.get(id))
      .filter((p): p is ProductWithRelations => p !== undefined);

    return {
      data: ordered.map((p) =>
        this.toResponse(p, locale, defaultLocale, includeCommerce),
      ),
      page,
      pageSize,
      total,
    };
  }

  async findBySlug(slug: string, requestedLocale?: string) {
    const product = await this.prisma.product.findUnique({
      where: { slug },
      include: PRODUCT_WITH_RELATIONS,
    });

    if (!product || !PUBLIC_STATUSES.includes(product.status)) {
      throw new NotFoundException(`Product "${slug}" not found`);
    }

    const defaultLocale = await this.getDefaultLocaleCode();
    return this.toResponse(
      product,
      requestedLocale ?? defaultLocale,
      defaultLocale,
      this.settings.isShopEnabled(),
    );
  }

  /**
   * Any status, for the admin edit form. Unlike the public shape (one
   * resolved description/alt text), this returns every locale's
   * translation — an editor needs to see all of them, including which
   * are missing.
   */
  async findByIdForAdmin(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: PRODUCT_WITH_RELATIONS,
    });
    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }

    const defaultLocale = await this.getDefaultLocaleCode();
    const base = this.toResponse(product, defaultLocale, defaultLocale, true);
    const imageTranslations = new Map(
      product.images.map((img) => [img.id, img.translations]),
    );

    return {
      ...base,
      translations: product.translations.map((t) => ({
        localeCode: t.localeCode,
        description: t.description,
      })),
      images: base.images.map((img) => ({
        ...img,
        translations: (imageTranslations.get(img.id) ?? []).map((t) => ({
          localeCode: t.localeCode,
          altText: t.altText,
        })),
      })),
    };
  }

  async create(dto: CreateProductDto) {
    this.assertUniqueItemQuantity(dto.isUnique, dto.quantityAvailable);
    const { translations, priceCents, ...rest } = dto;
    await assertLocalesExist(
      this.prisma,
      (translations ?? []).map((t) => t.localeCode),
    );

    let product: ProductWithRelations;
    try {
      product = await this.prisma.product.create({
        data: {
          ...rest,
          priceCents: BigInt(priceCents),
          translations: translations?.length
            ? {
                create: translations.map((t) => ({
                  localeCode: t.localeCode,
                  description: t.description,
                })),
              }
            : undefined,
        },
        include: PRODUCT_WITH_RELATIONS,
      });
    } catch (error) {
      this.rethrowProductWriteError(error);
    }

    const defaultLocale = await this.getDefaultLocaleCode();
    return this.toResponse(product, defaultLocale, defaultLocale, true);
  }

  /**
   * Translation upserts and the product update share one transaction, so
   * a rejected update (e.g. a duplicate slug → 409) doesn't leave the
   * translations half-applied.
   */
  async update(id: string, dto: UpdateProductDto) {
    const existing = await this.findByIdOrThrow(id);
    this.assertUniqueItemQuantity(
      dto.isUnique ?? existing.isUnique,
      dto.quantityAvailable ?? existing.quantityAvailable,
    );

    const { translations, priceCents, ...rest } = dto;
    await assertLocalesExist(
      this.prisma,
      (translations ?? []).map((t) => t.localeCode),
    );

    let product: ProductWithRelations;
    try {
      product = await this.prisma.$transaction(async (tx) => {
        for (const t of translations ?? []) {
          await tx.productTranslation.upsert({
            where: {
              productId_localeCode: { productId: id, localeCode: t.localeCode },
            },
            create: {
              productId: id,
              localeCode: t.localeCode,
              description: t.description,
            },
            update: { description: t.description },
          });
        }

        return tx.product.update({
          where: { id },
          data: {
            ...rest,
            ...(priceCents !== undefined && {
              priceCents: BigInt(priceCents),
            }),
          },
          include: PRODUCT_WITH_RELATIONS,
        });
      });
    } catch (error) {
      this.rethrowProductWriteError(error);
    }

    const defaultLocale = await this.getDefaultLocaleCode();
    return this.toResponse(product, defaultLocale, defaultLocale, true);
  }

  /**
   * Uploads to storage before writing the DB row (not the other way
   * round): if the DB write then fails, the result is an orphaned object
   * in the bucket — cheap and invisible. Writing the row first and
   * uploading second would risk the opposite: a product with an image URL
   * that 404s, which is a visible bug. See removeImage for the mirror of
   * this reasoning on delete.
   *
   * The demote-old-primary + create-new-row pair runs in one transaction,
   * since product_images has a partial unique index enforcing at most one
   * `isPrimary` row per product (see art_shop_schema.sql). Two concurrent
   * uploads both marking themselves primary can still race — the
   * transaction doesn't serialize that away, it just makes each attempt
   * atomic — so the loser hits that unique constraint. Without the catch
   * below, that would otherwise surface to the admin as a bare 500.
   */
  async addImage(
    productId: string,
    file: { buffer: Buffer; mimetype: string },
    dto: UploadProductImageDto,
  ) {
    await this.findByIdOrThrow(productId);
    const defaultLocale = await this.getDefaultLocaleCode();

    const url = await this.storage.uploadPublicObject({
      key: this.buildImageKey(productId, file.mimetype),
      body: file.buffer,
      contentType: file.mimetype,
    });

    try {
      await this.prisma.$transaction(async (tx) => {
        if (dto.isPrimary) {
          await tx.productImage.updateMany({
            where: { productId, isPrimary: true },
            data: { isPrimary: false },
          });
        }

        const position =
          dto.position ??
          (await tx.productImage.count({ where: { productId } }));

        await tx.productImage.create({
          data: {
            productId,
            url,
            isPrimary: dto.isPrimary ?? false,
            position,
            ...(dto.altText && {
              translations: {
                create: [{ localeCode: defaultLocale, altText: dto.altText }],
              },
            }),
          },
        });
      });
    } catch (error) {
      await this.discardUploadAndRethrow(error, url);
    }

    const product = await this.prisma.product.findUniqueOrThrow({
      where: { id: productId },
      include: PRODUCT_WITH_RELATIONS,
    });
    return this.toResponse(product, defaultLocale, defaultLocale, true);
  }

  /**
   * Swaps only the file behind an existing image row — id, position,
   * isPrimary, and altText all stay as they are. Distinct from doing an
   * addImage + removeImage, which would create a new row and, if the old
   * image was primary, trigger removeImage's auto-promotion only to have
   * the new upload immediately demote it again.
   *
   * Ordering follows the same fail-safe principle as addImage/removeImage:
   * upload the new object, then update the DB row to point at it, then
   * delete the *old* object last. A mid-failure anywhere in that sequence
   * leaves at worst an orphaned object in storage — never a row pointing
   * at a file that's already gone.
   */
  async replaceImage(
    productId: string,
    imageId: string,
    file: { buffer: Buffer; mimetype: string },
  ) {
    const existing = await this.prisma.productImage.findUnique({
      where: { id: imageId },
    });
    if (!existing || existing.productId !== productId) {
      throw new NotFoundException(
        `Image ${imageId} not found on product ${productId}`,
      );
    }

    const url = await this.storage.uploadPublicObject({
      key: this.buildImageKey(productId, file.mimetype),
      body: file.buffer,
      contentType: file.mimetype,
    });

    try {
      await this.prisma.productImage.update({
        where: { id: imageId },
        data: { url },
      });
    } catch (error) {
      await this.discardUploadAndRethrow(error, url);
    }

    // The swap is already committed, so a failure here mustn't fail the
    // request — the old object is just left behind as an orphan.
    try {
      await this.storage.deleteObjectByUrl(existing.url);
    } catch (error) {
      this.logger.warn(
        { imageId, url: existing.url, err: error },
        'Image replaced, but deleting the old object failed; orphan left in storage',
      );
    }

    const defaultLocale = await this.getDefaultLocaleCode();
    const product = await this.prisma.product.findUniqueOrThrow({
      where: { id: productId },
      include: PRODUCT_WITH_RELATIONS,
    });
    return this.toResponse(product, defaultLocale, defaultLocale, true);
  }

  /**
   * Edits an image's metadata without touching its file: per-locale alt
   * text (upserted — locales left out are kept), position, and promoting
   * it to primary. All writes share one transaction, so a failure part-way
   * (e.g. the primary race) applies none of them.
   */
  async updateImage(
    productId: string,
    imageId: string,
    dto: UpdateProductImageDto,
  ) {
    const image = await this.prisma.productImage.findUnique({
      where: { id: imageId },
    });
    if (!image || image.productId !== productId) {
      throw new NotFoundException(
        `Image ${imageId} not found on product ${productId}`,
      );
    }

    const translations = dto.translations ?? [];
    await assertLocalesExist(
      this.prisma,
      translations.map((t) => t.localeCode),
    );

    try {
      await this.prisma.$transaction(async (tx) => {
        if (dto.isPrimary) {
          await tx.productImage.updateMany({
            where: { productId, isPrimary: true, NOT: { id: imageId } },
            data: { isPrimary: false },
          });
        }

        if (dto.isPrimary || dto.position !== undefined) {
          await tx.productImage.update({
            where: { id: imageId },
            data: {
              ...(dto.isPrimary && { isPrimary: true }),
              ...(dto.position !== undefined && { position: dto.position }),
            },
          });
        }

        for (const t of translations) {
          await tx.productImageTranslation.upsert({
            where: {
              imageId_localeCode: { imageId, localeCode: t.localeCode },
            },
            create: { imageId, localeCode: t.localeCode, altText: t.altText },
            update: { altText: t.altText },
          });
        }
      });
    } catch (error) {
      this.rethrowPrismaError(error);
    }

    const defaultLocale = await this.getDefaultLocaleCode();
    const product = await this.prisma.product.findUniqueOrThrow({
      where: { id: productId },
      include: PRODUCT_WITH_RELATIONS,
    });
    return this.toResponse(product, defaultLocale, defaultLocale, true);
  }

  /**
   * Deletes from storage before the DB row — the reverse order of
   * addImage, for the same reason: if the DB delete then fails, you're
   * left with a dangling row pointing at nothing (visible broken image),
   * versus a DB row deleted but the object still in the bucket (cheap,
   * invisible, and never reachable again since nothing references its URL).
   *
   * If the deleted image was the primary one, the next image by position
   * is promoted in the same transaction as the delete — otherwise the
   * product would silently end up with zero `isPrimary` rows. toResponse
   * already falls back to position order when nothing is flagged primary,
   * so this isn't needed for correct display, but leaving isPrimary unset
   * after a delete would make the flag itself misleading going forward
   * (e.g. the next addImage({isPrimary: true}) would have nothing to demote).
   */
  async removeImage(productId: string, imageId: string) {
    const image = await this.prisma.productImage.findUnique({
      where: { id: imageId },
    });
    if (!image || image.productId !== productId) {
      throw new NotFoundException(
        `Image ${imageId} not found on product ${productId}`,
      );
    }

    await this.storage.deleteObjectByUrl(image.url);

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.productImage.delete({ where: { id: imageId } });

        if (image.isPrimary) {
          const next = await tx.productImage.findFirst({
            where: { productId },
            orderBy: { position: 'asc' },
          });
          if (next) {
            await tx.productImage.update({
              where: { id: next.id },
              data: { isPrimary: true },
            });
          }
        }
      });
    } catch (error) {
      this.logger.error(
        { imageId, url: image.url, err: error },
        'Image object deleted from storage, but deleting its row failed',
      );
      this.rethrowPrismaError(error);
    }
  }

  /**
   * Soft delete: products are mostly one-of-a-kind originals, so this
   * archives rather than removing the row (art_shop_schema.sql already
   * models 'archived' as a first-class product_status).
   */
  async archive(id: string) {
    await this.findByIdOrThrow(id);
    await this.prisma.product.update({
      where: { id },
      data: { status: ProductStatus.archived },
    });
  }

  private async findByIdOrThrow(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    return product;
  }

  private assertUniqueItemQuantity(
    isUnique: boolean | undefined,
    quantityAvailable: number | undefined,
  ) {
    if (isUnique && (quantityAvailable ?? 1) > 1) {
      throw new BadRequestException(
        'A one-of-a-kind product (isUnique=true) cannot have quantityAvailable > 1',
      );
    }
  }

  private getDefaultLocaleCode(): Promise<string> {
    return getDefaultLocaleCode(this.prisma);
  }

  private buildImageKey(productId: string, mimetype: string): string {
    const extension = mimetype.split('/')[1] ?? 'bin';
    return `products/${productId}/${randomUUID()}.${extension}`;
  }

  /**
   * Deletes a just-uploaded object when the DB write that would have
   * referenced it is known not to have happened, then rethrows. Only a
   * PrismaClientKnownRequestError guarantees that (Postgres rejected the
   * statement / the transaction rolled back). Ambiguous failures — a
   * timeout or dropped connection — may have committed anyway, and
   * deleting the object then would leave a row pointing at a missing file,
   * so those keep the orphan instead. A failed cleanup is swallowed so the
   * caller still gets the original error, not a storage error.
   */
  private async discardUploadAndRethrow(
    error: unknown,
    url: string,
  ): Promise<never> {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      try {
        await this.storage.deleteObjectByUrl(url);
      } catch (cleanupError) {
        // Best effort: an orphan is acceptable, masking `error` is not.
        this.logger.warn(
          { url, err: cleanupError },
          'Discarding an upload after a failed DB write failed; orphan left in storage',
        );
      }
    } else {
      this.logger.warn(
        { url, err: error },
        'DB write outcome unknown after upload; keeping the object in case it committed',
      );
    }
    this.rethrowPrismaError(error);
  }

  // Maps the Prisma errors image writes can realistically hit under
  // concurrent admin requests; anything else is rethrown untouched.
  private rethrowPrismaError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // Partial unique index: at most one isPrimary image per product.
      if (error.code === 'P2002') {
        throw new ConflictException(
          'Another image was just set as primary for this product — reload and try again',
        );
      }
      // The row was deleted by another request after our existence check
      // (P2025), or a row a write references was (P2003 — locale codes are
      // validated up front, so a foreign-key failure here means the image
      // or product itself vanished mid-request).
      if (error.code === 'P2025' || error.code === 'P2003') {
        throw new NotFoundException(
          'The image or its product was deleted by another request — reload and try again',
        );
      }
    }
    throw error;
  }

  // Product create/update. Locale codes are validated before writing, so a
  // foreign-key failure (P2003) can only be the categoryId.
  private rethrowProductWriteError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        const target = error.meta?.target;
        const fields = Array.isArray(target) ? target.join(', ') : 'slug/SKU';
        throw new ConflictException(
          `A product with that ${fields} already exists`,
        );
      }
      if (error.code === 'P2003') {
        throw new BadRequestException('Unknown categoryId');
      }
    }
    throw error;
  }

  /**
   * `includeCommerce: false` omits price and stock entirely rather than
   * nulling them — while the shop is disabled they must not be readable
   * from the public API at all, not just hidden by the frontend.
   */
  private toResponse(
    product: ProductWithRelations,
    locale: string,
    defaultLocale: string,
    includeCommerce: boolean,
  ) {
    const translation = pickTranslation(
      product.translations,
      locale,
      defaultLocale,
    );

    const sortedImages = [...product.images].sort(
      (a, b) => a.position - b.position,
    );
    const primaryImage =
      sortedImages.find((img) => img.isPrimary) ?? sortedImages[0];

    return {
      id: product.id,
      sku: product.sku,
      slug: product.slug,
      title: product.title,
      description: translation?.description ?? null,
      medium: product.medium,
      style: product.style,
      yearCreated: product.yearCreated,
      widthCm: product.widthCm,
      heightCm: product.heightCm,
      depthCm: product.depthCm,
      weightKg: product.weightKg,
      ...(includeCommerce && {
        priceCents: product.priceCents.toString(),
        currency: product.currency,
        quantityAvailable: product.quantityAvailable,
      }),
      isUnique: product.isUnique,
      status: product.status,
      tags: product.tags,
      category: product.category
        ? { id: product.category.id, slug: product.category.slug }
        : null,
      images: sortedImages.map((img) => ({
        id: img.id,
        url: img.url,
        altText:
          pickTranslation(img.translations, locale, defaultLocale)?.altText ??
          null,
        isPrimary: img.isPrimary,
      })),
      primaryImageUrl: primaryImage?.url ?? null,
    };
  }
}
