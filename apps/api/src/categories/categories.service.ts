import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Category } from '@enriplaso-art-web/api-types';
import { PrismaService } from '../prisma/prisma.service';
import { getDefaultLocaleCode, pickTranslation } from '../i18n/locale.utils';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CategoryTranslationDto } from './dto/category-translation.dto';

const WITH_TRANSLATIONS = {
  translations: true,
} satisfies Prisma.CategoryInclude;

type CategoryWithTranslations = Prisma.CategoryGetPayload<{
  include: typeof WITH_TRANSLATIONS;
}>;

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  // Flat list with parentId — the frontend builds the tree. The catalog is
  // small (<200 pieces, a handful of categories), so no pagination.
  async findAll(requestedLocale?: string): Promise<Category[]> {
    const defaultLocale = await getDefaultLocaleCode(this.prisma);
    const locale = requestedLocale ?? defaultLocale;

    const categories = await this.prisma.category.findMany({
      include: WITH_TRANSLATIONS,
    });

    return categories
      .map((category) => this.toResponse(category, locale, defaultLocale))
      .sort((a, b) =>
        (a.name ?? a.slug).localeCompare(b.name ?? b.slug, locale),
      );
  }

  async findBySlug(slug: string, requestedLocale?: string): Promise<Category> {
    const category = await this.prisma.category.findUnique({
      where: { slug },
      include: WITH_TRANSLATIONS,
    });
    if (!category) {
      throw new NotFoundException(`Category "${slug}" not found`);
    }

    const defaultLocale = await getDefaultLocaleCode(this.prisma);
    return this.toResponse(
      category,
      requestedLocale ?? defaultLocale,
      defaultLocale,
    );
  }

  async create(dto: CreateCategoryDto): Promise<Category> {
    const defaultLocale = await getDefaultLocaleCode(this.prisma);
    this.assertHasDefaultTranslation(dto.translations, defaultLocale);

    if (dto.parentId) {
      await this.findByIdOrThrow(dto.parentId, 'Parent category');
    }

    try {
      const category = await this.prisma.category.create({
        data: {
          slug: dto.slug,
          parentId: dto.parentId ?? null,
          translations: {
            create: dto.translations.map((t) => ({
              localeCode: t.localeCode,
              name: t.name,
              description: t.description,
            })),
          },
        },
        include: WITH_TRANSLATIONS,
      });
      return this.toResponse(category, defaultLocale, defaultLocale);
    } catch (error) {
      this.rethrowPrismaError(error);
    }
  }

  async update(id: string, dto: UpdateCategoryDto): Promise<Category> {
    await this.findByIdOrThrow(id);

    if (dto.parentId) {
      await this.findByIdOrThrow(dto.parentId, 'Parent category');
      await this.assertNoCycle(id, dto.parentId);
    }

    try {
      if (dto.translations?.length) {
        await this.prisma.$transaction(
          dto.translations.map((t) =>
            this.prisma.categoryTranslation.upsert({
              where: {
                categoryId_localeCode: {
                  categoryId: id,
                  localeCode: t.localeCode,
                },
              },
              create: {
                categoryId: id,
                localeCode: t.localeCode,
                name: t.name,
                description: t.description,
              },
              update: { name: t.name, description: t.description },
            }),
          ),
        );
      }

      const category = await this.prisma.category.update({
        where: { id },
        data: {
          ...(dto.slug !== undefined && { slug: dto.slug }),
          ...(dto.parentId !== undefined && { parentId: dto.parentId }),
        },
        include: WITH_TRANSLATIONS,
      });

      const defaultLocale = await getDefaultLocaleCode(this.prisma);
      return this.toResponse(category, defaultLocale, defaultLocale);
    } catch (error) {
      this.rethrowPrismaError(error);
    }
  }

  // Hard delete: unlike products, a category has no archived state, and the
  // schema already handles the fallout — its products and child categories
  // are set to no category / top level (ON DELETE SET NULL), and its
  // translations are removed (ON DELETE CASCADE).
  async remove(id: string): Promise<void> {
    await this.findByIdOrThrow(id);
    await this.prisma.category.delete({ where: { id } });
  }

  private async findByIdOrThrow(id: string, label = 'Category') {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) {
      throw new NotFoundException(`${label} ${id} not found`);
    }
    return category;
  }

  private assertHasDefaultTranslation(
    translations: CategoryTranslationDto[],
    defaultLocale: string,
  ) {
    if (!translations.some((t) => t.localeCode === defaultLocale)) {
      throw new BadRequestException(
        `A translation for the default locale ("${defaultLocale}") is required`,
      );
    }
  }

  // Walks up from the proposed parent to the root; if it passes through the
  // category being moved, the move would create a loop in the hierarchy.
  private async assertNoCycle(id: string, newParentId: string) {
    let current: string | null = newParentId;
    while (current) {
      if (current === id) {
        throw new BadRequestException(
          'A category cannot be moved under itself or one of its descendants',
        );
      }
      const parent: { parentId: string | null } | null =
        await this.prisma.category.findUnique({
          where: { id: current },
          select: { parentId: true },
        });
      current = parent?.parentId ?? null;
    }
  }

  private rethrowPrismaError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw new ConflictException('A category with that slug already exists');
      }
      if (error.code === 'P2003') {
        throw new BadRequestException('Unknown locale code in translations');
      }
    }
    throw error;
  }

  private toResponse(
    category: CategoryWithTranslations,
    locale: string,
    defaultLocale: string,
  ): Category {
    const translation = pickTranslation(
      category.translations,
      locale,
      defaultLocale,
    );

    return {
      id: category.id,
      slug: category.slug,
      parentId: category.parentId,
      name: translation?.name ?? null,
      description: translation?.description ?? null,
    };
  }
}
