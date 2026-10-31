import {
  IsString,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsIn,
  MinLength,
  MaxLength,
  Max,
  Min,
} from 'class-validator';

export type ProductTaxTreatment = 'legacy' | 'standard' | 'zero_rated' | 'exempt' | 'out_of_scope';

export class CreateProductDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  sku: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2048)
  imageUrl?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  category?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  unit?: string;

  @IsNumber()
  @Min(0)
  sellingPrice: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  costPrice?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  stockQuantity?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  reorderLevel?: number;

  @IsIn(['legacy', 'standard', 'zero_rated', 'exempt', 'out_of_scope'])
  @IsOptional()
  taxTreatment?: ProductTaxTreatment;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  taxRate?: number;

  @IsBoolean()
  @IsOptional()
  isService?: boolean;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateProductDto {
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(50)
  sku?: string;

  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2048)
  imageUrl?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  category?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  unit?: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  sellingPrice?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  costPrice?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  stockQuantity?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  reorderLevel?: number;

  @IsIn(['legacy', 'standard', 'zero_rated', 'exempt', 'out_of_scope'])
  @IsOptional()
  taxTreatment?: ProductTaxTreatment;

  @IsNumber()
  @IsOptional()
  @Min(0)
  taxRate?: number;

  @IsBoolean()
  @IsOptional()
  isService?: boolean;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
