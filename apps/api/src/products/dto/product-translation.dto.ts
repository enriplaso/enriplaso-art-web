import { IsNotEmpty, IsString } from 'class-validator';

export class ProductTranslationDto {
  @IsString()
  @IsNotEmpty()
  localeCode!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;
}
