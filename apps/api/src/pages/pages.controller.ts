import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminAuthGuard } from '../auth/admin-auth.guard';
import { PagesService } from './pages.service';
import { CreatePageDto } from './dto/create-page.dto';
import { UpdatePageDto } from './dto/update-page.dto';

@Controller('pages')
export class PagesController {
  constructor(private readonly pagesService: PagesService) {}

  @Get()
  findAll(@Query('locale') locale?: string) {
    return this.pagesService.findAll(locale);
  }

  @Get(':slug')
  findOne(@Param('slug') slug: string, @Query('locale') locale?: string) {
    return this.pagesService.findBySlug(slug, locale);
  }

  @UseGuards(AdminAuthGuard)
  @Post()
  create(@Body() dto: CreatePageDto) {
    return this.pagesService.create(dto);
  }

  @UseGuards(AdminAuthGuard)
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePageDto) {
    return this.pagesService.update(id, dto);
  }

  @UseGuards(AdminAuthGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.pagesService.remove(id);
  }

  @UseGuards(AdminAuthGuard)
  @Delete(':id/translations/:localeCode')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeTranslation(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('localeCode') localeCode: string,
  ) {
    return this.pagesService.removeTranslation(id, localeCode);
  }
}
