import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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

    const where: Prisma.ProductWhereInput = {
      status: ProductStatus.published,
      ...(query.categorySlug && { category: { slug: query.categorySlug } }),
      ...(query.tag && { tags: { has: query.tag } }),
    };

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

  private async getDefaultLocaleCode(): Promise<string> {
    const locale = await this.prisma.locale.findFirst({
      where: { isDefault: true },
    });
    if (!locale) {
      throw new BadRequestException('No default locale is configured');
    }
    return locale.code;
  }

  private toResponse(
    product: ProductWithRelations,
    locale: string,
    defaultLocale: string,
  ) {
    const translation =
      product.translations.find((t) => t.localeCode === locale) ??
      product.translations.find((t) => t.localeCode === defaultLocale);

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
