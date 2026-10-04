import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { PageTranslationDto } from './page-translation.dto';

export class CreatePageDto {
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase, alphanumeric, hyphen-separated',
  })
  slug!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PageTranslationDto)
  translations!: PageTranslationDto[];
}
