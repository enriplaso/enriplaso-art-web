import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseFilePipeBuilder,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AdminAuthGuard } from '../auth/admin-auth.guard';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductsDto } from './dto/query-products.dto';
import { UploadProductImageDto } from './dto/upload-product-image.dto';
import { UpdateProductImageDto } from './dto/update-product-image.dto';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// Shared by upload and replace — both accept the same file shape.
function imageFileValidator() {
  return new ParseFilePipeBuilder()
    .addFileTypeValidator({ fileType: /^image\/(png|jpe?g|webp)$/ })
    .addMaxSizeValidator({ maxSize: MAX_IMAGE_BYTES })
    .build({ errorHttpStatusCode: HttpStatus.BAD_REQUEST });
}

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  findAll(@Query() query: QueryProductsDto) {
    return this.productsService.findPublic(query);
  }

  @Get(':slug')
  findOne(@Param('slug') slug: string, @Query('locale') locale?: string) {
    return this.productsService.findBySlug(slug, locale);
  }

  @UseGuards(AdminAuthGuard)
  @Post()
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  @UseGuards(AdminAuthGuard)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productsService.update(id, dto);
  }

  // Archives rather than hard-deletes — see ProductsService.archive.
  @UseGuards(AdminAuthGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.archive(id);
  }

  @UseGuards(AdminAuthGuard)
  @Post(':id/images')
  @UseInterceptors(FileInterceptor('file'))
  uploadImage(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile(imageFileValidator()) file: Express.Multer.File,
    @Body() dto: UploadProductImageDto,
  ) {
    return this.productsService.addImage(id, file, dto);
  }

  @UseGuards(AdminAuthGuard)
  @Put(':id/images/:imageId')
  @UseInterceptors(FileInterceptor('file'))
  replaceImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @UploadedFile(imageFileValidator()) file: Express.Multer.File,
  ) {
    return this.productsService.replaceImage(id, imageId, file);
  }

  @UseGuards(AdminAuthGuard)
  @Patch(':id/images/:imageId')
  updateImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @Body() dto: UpdateProductImageDto,
  ) {
    return this.productsService.updateImage(id, imageId, dto);
  }

  @UseGuards(AdminAuthGuard)
  @Delete(':id/images/:imageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ) {
    return this.productsService.removeImage(id, imageId);
  }
}
