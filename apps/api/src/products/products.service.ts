import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getDefaultLocaleCode, pickTranslation } from '../i18n/locale.utils';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductsDto } from './dto/query-products.dto';

const PRODUCT_WITH_RELATIONS = {
  translations: true,
  images: true,
  category: true,
} satisfies Prisma.ProductInclude;

type ProductWithRelations = Prisma.ProductGetPayload<{
  include: typeof PRODUCT_WITH_RELATIONS;
}>;

const DEFAULT_PAGE_SIZE = 24;

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findPublished(query: QueryProductsDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const defaultLocale = await this.getDefaultLocaleCode();
    const locale = query.locale ?? defaultLocale;

    // status/categorySlug/tag only — search is handled separately below,
    // since ranking by fuzzy-match relevance needs raw SQL (Prisma has no
    // pg_trgm operators), which can't share a query with these filters.
    const where: Prisma.ProductWhereInput = {
      status: ProductStatus.published,
      ...(query.categorySlug && { category: { slug: query.categorySlug } }),
      ...(query.tag && { tags: { has: query.tag } }),
    };

    if (query.search) {
      return this.findPublishedBySearch(
        where,
        query.search,
        locale,
        defaultLocale,
        page,
        pageSize,
      );
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
      data: products.map((p) => this.toResponse(p, locale, defaultLocale)),
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
  private async findPublishedBySearch(
    structuralWhere: Prisma.ProductWhereInput,
    term: string,
    locale: string,
    defaultLocale: string,
    page: number,
    pageSize: number,
  ) {
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
      data: ordered.map((p) => this.toResponse(p, locale, defaultLocale)),
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

    if (!product || product.status !== ProductStatus.published) {
      throw new NotFoundException(`Product "${slug}" not found`);
    }

    const defaultLocale = await this.getDefaultLocaleCode();
    return this.toResponse(
      product,
      requestedLocale ?? defaultLocale,
      defaultLocale,
    );
  }

  async create(dto: CreateProductDto) {
    this.assertUniqueItemQuantity(dto.isUnique, dto.quantityAvailable);
    const { translations, priceCents, ...rest } = dto;

    const product = await this.prisma.product.create({
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

    const defaultLocale = await this.getDefaultLocaleCode();
    return this.toResponse(product, defaultLocale, defaultLocale);
  }

  async update(id: string, dto: UpdateProductDto) {
    const existing = await this.findByIdOrThrow(id);
    this.assertUniqueItemQuantity(
      dto.isUnique ?? existing.isUnique,
      dto.quantityAvailable ?? existing.quantityAvailable,
    );

    const { translations, priceCents, ...rest } = dto;

    if (translations?.length) {
      await this.prisma.$transaction(
        translations.map((t) =>
          this.prisma.productTranslation.upsert({
            where: {
              productId_localeCode: {
                productId: id,
                localeCode: t.localeCode,
              },
            },
            create: {
              productId: id,
              localeCode: t.localeCode,
              description: t.description,
            },
            update: { description: t.description },
          }),
        ),
      );
    }

    const product = await this.prisma.product.update({
      where: { id },
      data: {
        ...rest,
        ...(priceCents !== undefined && { priceCents: BigInt(priceCents) }),
      },
      include: PRODUCT_WITH_RELATIONS,
    });

    const defaultLocale = await this.getDefaultLocaleCode();
    return this.toResponse(product, defaultLocale, defaultLocale);
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

  private toResponse(
    product: ProductWithRelations,
    locale: string,
    defaultLocale: string,
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
      priceCents: product.priceCents.toString(),
      currency: product.currency,
      isUnique: product.isUnique,
      quantityAvailable: product.quantityAvailable,
      status: product.status,
      tags: product.tags,
      category: product.category
        ? { id: product.category.id, slug: product.category.slug }
        : null,
      images: sortedImages.map((img) => ({
        id: img.id,
        url: img.url,
        altText: img.altText,
        isPrimary: img.isPrimary,
      })),
      primaryImageUrl: primaryImage?.url ?? null,
    };
  }
}
