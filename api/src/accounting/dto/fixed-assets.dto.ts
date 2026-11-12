import { Type } from 'class-transformer';
import { IsDateString, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

export class CreateFixedAssetDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  assetCode!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(240)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsDateString()
  acquisitionDate!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  cost!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  residualValue!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  usefulLifeMonths!: number;

  @IsUUID()
  assetAccountId!: string;

  @IsUUID()
  accumulatedDepreciationAccountId!: string;

  @IsUUID()
  depreciationExpenseAccountId!: string;

  @IsUUID()
  paymentAccountId!: string;
}

export class RunDepreciationDto {
  @IsDateString()
  periodEnd!: string;
}
