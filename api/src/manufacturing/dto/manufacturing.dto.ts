import { ArrayMinSize, IsArray, IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateBomLineDto {
 @IsUUID() materialProductId!: string;
 @Type(() => Number) @IsNumber({maxDecimalPlaces:4}) @Min(0.0001) quantity!: number;
 @Type(() => Number) @IsNumber({maxDecimalPlaces:4}) @IsOptional() @Min(0) @Max(100) wastePercent?: number;
 @IsString() @IsOptional() @MaxLength(500) notes?: string;
}
export class CreateBomDto {
 @IsString() @MaxLength(32) code!: string;
 @IsString() @MaxLength(180) name!: string;
 @IsUUID() productId!: string;
 @Type(() => Number) @IsNumber({maxDecimalPlaces:4}) @Min(0.0001) outputQuantity!: number;
 @IsArray() @ArrayMinSize(1) @ValidateNested({each:true}) @Type(() => CreateBomLineDto) lines!: CreateBomLineDto[];
 @IsString() @IsOptional() @MaxLength(2000) notes?: string;
}
export class CreateProductionOrderDto {
 @IsUUID() bomId!: string;
 @IsUUID() warehouseId!: string;
 @Type(() => Number) @IsNumber({maxDecimalPlaces:4}) @Min(0.0001) plannedQuantity!: number;
 @IsDateString() @IsOptional() plannedStartDate?: string;
 @IsDateString() @IsOptional() plannedEndDate?: string;
 @IsString() @IsOptional() @MaxLength(2000) notes?: string;
}
export class CreateProductionCostDto {
 @IsIn(['labour','overhead']) costType!: 'labour'|'overhead';
 @IsString() @MaxLength(240) description!: string;
 @Type(() => Number) @IsNumber({maxDecimalPlaces:2}) @Min(0.01) amount!: number;
 @IsUUID() sourceAccountId!: string;
 @IsDateString() @IsOptional() incurredOn?: string;
}

export class CreateManufacturingQualityEventDto {
 @IsUUID() productId!: string;
 @IsUUID() warehouseId!: string;
 @IsUUID() @IsOptional() productionOrderId?: string;
 @IsIn(['spoiled','rejected','quality_hold']) eventType!: 'spoiled'|'rejected'|'quality_hold';
 @IsString() @IsOptional() @MaxLength(100) originalBatchReference?: string;
 @Type(() => Number) @IsNumber({maxDecimalPlaces:4}) @Min(0.0001) affectedQuantity!: number;
 @Type(() => Number) @IsNumber({maxDecimalPlaces:4}) @IsOptional() @Min(0) recoverableQuantity?: number;
 @Type(() => Number) @IsNumber({maxDecimalPlaces:4}) @IsOptional() @Min(0) disposalQuantity?: number;
 @IsString() @MaxLength(2000) reason!: string;
}
