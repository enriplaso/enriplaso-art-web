import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminAuthGuard } from '../auth/admin-auth.guard';
import { ProductsService } from './products.service';
import { AdminQueryProductsDto } from './dto/admin-query-products.dto';

// A separate /admin prefix rather than e.g. GET /products/admin, which
// would collide with GET /products/:slug for a product slugged "admin".
@Controller('admin/products')
@UseGuards(AdminAuthGuard)
export class AdminProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  findAll(@Query() query: AdminQueryProductsDto) {
    return this.productsService.findForAdmin(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.findByIdForAdmin(id);
  }
}
