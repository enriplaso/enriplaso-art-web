import { ProductStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { QueryProductsDto } from './query-products.dto';

export class AdminQueryProductsDto extends QueryProductsDto {
  // Omitted = every status, drafts and archived included.
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;
}
