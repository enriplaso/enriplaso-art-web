import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ProductsController } from '../../../src/products/products.controller';
import { ProductsService } from '../../../src/products/products.service';
import { AdminAuthGuard } from '../../../src/auth/admin-auth.guard';

interface MockProductsService {
  findPublic: Mock;
  findBySlug: Mock;
  create: Mock;
  update: Mock;
  archive: Mock;
}

describe('ProductsController', () => {
  let controller: ProductsController;
  let service: MockProductsService;

  beforeEach(async () => {
    service = {
      findPublic: vi.fn(),
      findBySlug: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      archive: vi.fn(),
    };

    // This suite tests controller-to-service delegation, not auth — the
    // guard's own behavior is covered by admin-auth.guard.spec.ts, and its
    // enforcement on these routes is covered by the e2e suite.
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [{ provide: ProductsService, useValue: service }],
    })
      .overrideGuard(AdminAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(ProductsController);
  });

  it('findAll delegates to service.findPublic with the query', async () => {
    const query = { categorySlug: 'abstract' };
    service.findPublic.mockResolvedValue({
      data: [],
      page: 1,
      pageSize: 24,
      total: 0,
    });

    const result = await controller.findAll(query);

    expect(service.findPublic).toHaveBeenCalledWith(query);
    expect(result.total).toBe(0);
  });

  it('findOne delegates to service.findBySlug with slug and locale', async () => {
    service.findBySlug.mockResolvedValue({ slug: 'sunset-oil' });

    const result = await controller.findOne('sunset-oil', 'es');

    expect(service.findBySlug).toHaveBeenCalledWith('sunset-oil', 'es');
    expect(result.slug).toBe('sunset-oil');
  });

  it('create delegates to service.create with the dto', async () => {
    const dto = { slug: 'x', title: 'X', priceCents: 100 };
    service.create.mockResolvedValue({ id: '1', ...dto });

    const result = await controller.create(dto);

    expect(service.create).toHaveBeenCalledWith(dto);
    expect(result.id).toBe('1');
  });

  it('update delegates to service.update with id and dto', async () => {
    const dto = { title: 'New title' };
    service.update.mockResolvedValue({ id: 'p1', ...dto });

    const result = await controller.update('p1', dto);

    expect(service.update).toHaveBeenCalledWith('p1', dto);
    expect(result.title).toBe('New title');
  });

  it('remove delegates to service.archive with id', async () => {
    service.archive.mockResolvedValue(undefined);

    await controller.remove('p1');

    expect(service.archive).toHaveBeenCalledWith('p1');
  });
});
