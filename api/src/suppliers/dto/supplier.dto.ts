import {
  IsString,
  IsOptional,
  IsEmail,
  IsIn,
  MinLength,
  MaxLength,
} from 'class-validator';

export class CreateSupplierDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @MaxLength(30)
  @IsOptional()
  phone?: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  city?: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  county?: string;

  @IsString()
  @MaxLength(200)
  @IsOptional()
  addressLine1?: string;

  @IsString()
  @MaxLength(20)
  @IsOptional()
  postalCode?: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  contactPerson?: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  paymentTerms?: string;
}

export class UpdateSupplierDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @IsOptional()
  name?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @MaxLength(30)
  @IsOptional()
  phone?: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  city?: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  county?: string;

  @IsString()
  @MaxLength(200)
  @IsOptional()
  addressLine1?: string;

  @IsString()
  @MaxLength(20)
  @IsOptional()
  postalCode?: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  contactPerson?: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  paymentTerms?: string;

  @IsString()
  @IsIn(['active', 'inactive', 'blocked'])
  @IsOptional()
  status?: 'active' | 'inactive' | 'blocked';
}
