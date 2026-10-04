import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AdminPage,
  Page,
  PageSummary,
} from '@enriplaso-art-web/api-types';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertLocalesExist,
  getDefaultLocaleCode,
  pickTranslation,
} from '../i18n/locale.utils';
import { CreatePageDto } from './dto/create-page.dto';
import { UpdatePageDto } from './dto/update-page.dto';

const WITH_TRANSLATIONS = {
  translations: true,
} satisfies Prisma.PageInclude;

type PageWithTranslations = Prisma.PageGetPayload<{
  include: typeof WITH_TRANSLATIONS;
}>;

@Injectable()
export class PagesService {
  constructor(private readonly prisma: PrismaService) {}

  // Slug + title only, for the site's footer/nav links. A handful of pages,
  // so no pagination.
  async findAll(requestedLocale?: string): Promise<PageSummary[]> {
    const defaultLocale = await getDefaultLocaleCode(this.prisma);
    const locale = requestedLocale ?? defaultLocale;

    const pages = await this.prisma.page.findMany({
      include: WITH_TRANSLATIONS,
    });

    return pages
      .map((page) => {
        const translation = pickTranslation(
          page.translations,
          locale,
          defaultLocale,
        );
        return {
          id: page.id,
          slug: page.slug,
          title: translation?.title ?? null,
        };
      })
      .sort((a, b) =>
        (a.title ?? a.slug).localeCompare(b.title ?? b.slug, locale),
      );
  }

  /**
   * `localeCode` is the locale actually served, which differs from the
   * requested one when it fell back to the default (README NFR5) — the
   * frontend needs it for the page's `lang` attribute.
   */
  async findBySlug(slug: string, requestedLocale?: string): Promise<Page> {
    const page = await this.prisma.page.findUnique({
      where: { slug },
      include: WITH_TRANSLATIONS,
    });
    const defaultLocale = await getDefaultLocaleCode(this.prisma);
    const translation =
      page &&
      pickTranslation(
        page.translations,
        requestedLocale ?? defaultLocale,
        defaultLocale,
      );
    if (!page || !translation) {
      throw new NotFoundException(`Page "${slug}" not found`);
    }

    return {
      id: page.id,
      slug: page.slug,
      localeCode: translation.localeCode,
      title: translation.title,
      body: translation.body,
      updatedAt: translation.updatedAt.toISOString(),
    };
  }

  async findAllForAdmin(): Promise<AdminPage[]> {
    const pages = await this.prisma.page.findMany({
      include: WITH_TRANSLATIONS,
      orderBy: { slug: 'asc' },
    });
    return pages.map((page) => this.toAdminResponse(page));
  }

  // Every locale's translation, so the editor can see which are missing.
  async findByIdForAdmin(id: string): Promise<AdminPage> {
    const page = await this.prisma.page.findUnique({
      where: { id },
      include: WITH_TRANSLATIONS,
    });
    if (!page) {
      throw new NotFoundException(`Page ${id} not found`);
    }
    return this.toAdminResponse(page);
  }

  async create(dto: CreatePageDto): Promise<AdminPage> {
    const defaultLocale = await getDefaultLocaleCode(this.prisma);
    if (!dto.translations.some((t) => t.localeCode === defaultLocale)) {
      throw new BadRequestException(
        `A translation for the default locale ("${defaultLocale}") is required`,
      );
    }
    await assertLocalesExist(
      this.prisma,
      dto.translations.map((t) => t.localeCode),
    );

    try {
      const page = await this.prisma.page.create({
        data: {
          slug: dto.slug,
          translations: {
            create: dto.translations.map((t) => ({
              localeCode: t.localeCode,
              title: t.title,
              body: t.body,
            })),
          },
        },
        include: WITH_TRANSLATIONS,
      });
      return this.toAdminResponse(page);
    } catch (error) {
      this.rethrowPrismaError(error);
    }
  }

  /**
   * Translation upserts and the slug update share one transaction, so a
   * rejected update (a duplicate slug → 409) doesn't leave the translations
   * half-applied. `updated_at` on an edited translation is bumped by the
   * set_updated_at() trigger.
   */
  async update(id: string, dto: UpdatePageDto): Promise<AdminPage> {
    await this.findByIdOrThrow(id);
    const { translations, slug } = dto;
    await assertLocalesExist(
      this.prisma,
      (translations ?? []).map((t) => t.localeCode),
    );

    try {
      const page = await this.prisma.$transaction(async (tx) => {
        for (const t of translations ?? []) {
          await tx.pageTranslation.upsert({
            where: {
              pageId_localeCode: { pageId: id, localeCode: t.localeCode },
            },
            create: {
              pageId: id,
              localeCode: t.localeCode,
              title: t.title,
              body: t.body,
            },
            update: { title: t.title, body: t.body },
          });
        }

        return tx.page.update({
          where: { id },
          data: { ...(slug !== undefined && { slug }) },
          include: WITH_TRANSLATIONS,
        });
      });
      return this.toAdminResponse(page);
    } catch (error) {
      this.rethrowPrismaError(error);
    }
  }

  // Hard delete; its translations go with it (ON DELETE CASCADE).
  async remove(id: string): Promise<void> {
    await this.findByIdOrThrow(id);
    try {
      await this.prisma.page.delete({ where: { id } });
    } catch (error) {
      this.rethrowPrismaError(error);
    }
  }

  // The default-locale translation can't be removed: it's what every other
  // locale falls back to, so without it the page would vanish for them.
  async removeTranslation(id: string, localeCode: string): Promise<void> {
    await this.findByIdOrThrow(id);
    const defaultLocale = await getDefaultLocaleCode(this.prisma);
    if (localeCode === defaultLocale) {
      throw new BadRequestException(
        `The default-locale ("${defaultLocale}") translation cannot be removed`,
      );
    }

    const { count } = await this.prisma.pageTranslation.deleteMany({
      where: { pageId: id, localeCode },
    });
    if (count === 0) {
      throw new NotFoundException(
        `Page ${id} has no "${localeCode}" translation`,
      );
    }
  }

  private async findByIdOrThrow(id: string) {
    const page = await this.prisma.page.findUnique({ where: { id } });
    if (!page) {
      throw new NotFoundException(`Page ${id} not found`);
    }
    return page;
  }

  // Locale codes are validated up front, so the realistic failures are a
  // duplicate slug and the page being deleted by a concurrent request.
  private rethrowPrismaError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw new ConflictException('A page with that slug already exists');
      }
      if (error.code === 'P2025' || error.code === 'P2003') {
        throw new NotFoundException(
          'The page was deleted by another request — reload and try again',
        );
      }
    }
    throw error;
  }

  private toAdminResponse(page: PageWithTranslations): AdminPage {
    return {
      id: page.id,
      slug: page.slug,
      createdAt: page.createdAt.toISOString(),
      translations: [...page.translations]
        .sort((a, b) => a.localeCode.localeCompare(b.localeCode))
        .map((t) => ({
          localeCode: t.localeCode,
          title: t.title,
          body: t.body,
          updatedAt: t.updatedAt.toISOString(),
        })),
    };
  }
}
