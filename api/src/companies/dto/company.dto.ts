import {
  IsString,
  IsOptional,
  IsBoolean,
  MinLength,
  MaxLength,
  Matches,
  IsEmail,
  IsIn,
  IsNumber,
  IsObject,
  ValidateNested,
  Min,
  Max,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CompanyTaxPolicyDto {
  @IsIn(['legacy', 'configured'])
  mode!: 'legacy' | 'configured';

  @IsBoolean()
  vatRegistered!: boolean;

  @IsNumber()
  @Min(0.01)
  @Max(100)
  @ValidateIf((_object, value) => value !== undefined)
  standardRate?: number;
}

export class CreateCompanyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsString()
  @MaxLength(50)
  @IsOptional()
  registrationNumber?: string;

  @IsString()
  @MaxLength(50)
  @IsOptional()
  vatNumber?: string;

  @IsString()
  @Matches(/^[A-Za-z]{3}$/, { message: 'currency must be a 3-letter code' })
  @IsOptional()
  currency?: string;

  @IsString()
  @MaxLength(50)
  @IsOptional()
  timezone?: string;

  @IsString()
  @MaxLength(200)
  @IsOptional()
  addressLine1?: string;

  @IsString()
  @MaxLength(200)
  @IsOptional()
  addressLine2?: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  city?: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  county?: string;

  @IsString()
  @MaxLength(20)
  @IsOptional()
  postalCode?: string;

  @IsString()
  @MaxLength(30)
  @IsOptional()
  phone?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @MaxLength(200)
  @IsOptional()
  website?: string;
}

export class UpdateCompanyDto {
  @IsObject()
  @ValidateNested()
  @Type(() => CompanyTaxPolicyDto)
  @IsOptional()
  taxPolicy?: CompanyTaxPolicyDto;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @IsOptional()
  name?: string;

  @IsString()
  @MaxLength(50)
  @IsOptional()
  registrationNumber?: string;

  @IsString()
  @MaxLength(50)
  @IsOptional()
  vatNumber?: string;

  @IsString()
  @Matches(/^[A-Za-z]{3}$/, { message: 'currency must be a 3-letter code' })
  @IsOptional()
  currency?: string;

  @IsString()
  @MaxLength(50)
  @IsOptional()
  timezone?: string;

  @IsString()
  @MaxLength(200)
  @IsOptional()
  addressLine1?: string;

  @IsString()
  @MaxLength(200)
  @IsOptional()
  addressLine2?: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  city?: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  county?: string;

  @IsString()
  @MaxLength(20)
  @IsOptional()
  postalCode?: string;

  @IsString()
  @MaxLength(30)
  @IsOptional()
  phone?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @MaxLength(200)
  @IsOptional()
  website?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
