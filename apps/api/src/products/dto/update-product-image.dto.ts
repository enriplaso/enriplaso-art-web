import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { ProductImageTranslationDto } from './product-image-translation.dto';

export class UpdateProductImageDto {
  // Upserted per locale; locales left out are untouched, not deleted.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductImageTranslationDto)
  translations?: ProductImageTranslationDto[];

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  // Only `true` is accepted: un-flagging the primary would leave the
  // product with none. To change it, make a different image primary.
  @IsOptional()
  @IsIn([true], {
    message:
      'isPrimary can only be set to true — make another image primary instead',
  })
  isPrimary?: true;
}
