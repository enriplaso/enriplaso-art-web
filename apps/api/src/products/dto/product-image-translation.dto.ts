import { IsNotEmpty, IsString } from 'class-validator';

export class ProductImageTranslationDto {
  @IsString()
  @IsNotEmpty()
  localeCode!: string;

  @IsString()
  @IsNotEmpty()
  altText!: string;
}
