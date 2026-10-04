import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { AdminAuthGuard } from '../auth/admin-auth.guard';
import { PagesService } from './pages.service';

// Same /admin prefix as AdminProductsController, so a page slugged "admin"
// stays reachable at GET /pages/:slug.
@Controller('admin/pages')
@UseGuards(AdminAuthGuard)
export class AdminPagesController {
  constructor(private readonly pagesService: PagesService) {}

  @Get()
  findAll() {
    return this.pagesService.findAllForAdmin();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.pagesService.findByIdForAdmin(id);
  }
}
