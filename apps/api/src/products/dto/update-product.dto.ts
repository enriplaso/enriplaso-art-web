import { PartialType } from '@nestjs/swagger';
import { ProductStatus } from '@prisma/client';
import { IsIn, IsOptional } from 'class-validator';
import { CreateProductDto } from './create-product.dto';

// `reserved` is left out on purpose: it's set and cleared only by checkout
// (FR8/FR9), together with reserved_until. An admin setting it by hand would
// create a reservation with no expiry that nothing ever releases.
// `sold` is allowed for pieces sold outside the site.
const ADMIN_SETTABLE_STATUSES: ProductStatus[] = [
  ProductStatus.draft,
  ProductStatus.published,
  ProductStatus.sold,
  ProductStatus.archived,
];

export class UpdateProductDto extends PartialType(CreateProductDto) {
  // New products always start as drafts (the column default); publishing is
  // an explicit PATCH { status: 'published' }.
  @IsOptional()
  @IsIn(ADMIN_SETTABLE_STATUSES, {
    message: `status must be one of: ${ADMIN_SETTABLE_STATUSES.join(', ')}`,
  })
  status?: ProductStatus;
}
