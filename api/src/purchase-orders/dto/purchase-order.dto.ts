import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class CreatePurchaseOrderItemDto {
  @IsUUID() productId!: string;
  @Type(() => Number) @IsNumber() @Min(0.001) quantity!: number;
  @Type(() => Number) @IsNumber() @Min(0) unitCost!: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100) taxRate?: number;
}
export class CreatePurchaseOrderDto {
  @IsUUID() supplierId!: string;
  @IsOptional() @IsDateString() expectedDate?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({each:true}) @Type(() => CreatePurchaseOrderItemDto) items!: CreatePurchaseOrderItemDto[];
}
export class CreatePurchaseOrderFromRequisitionItemDto {
  @IsUUID() requisitionItemId!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) unitCost!: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) taxRate?: number;
}
export class CreatePurchaseOrderFromRequisitionDto {
  @IsUUID() requisitionId!: string;
  @IsUUID() supplierId!: string;
  @IsOptional() @IsDateString() expectedDate?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({each:true}) @Type(() => CreatePurchaseOrderFromRequisitionItemDto) items!: CreatePurchaseOrderFromRequisitionItemDto[];
}
export class UpdatePurchaseOrderStatusDto {
  @IsString() status!: 'ordered' | 'cancelled';
}
export class ReceivePurchaseOrderItemDto {
  @IsUUID() itemId!: string;
  @Type(() => Number) @IsNumber() @Min(0.001) quantity!: number;
}
export class ReceivePurchaseOrderDto {
  @IsUUID() warehouseId!: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({each:true}) @Type(() => ReceivePurchaseOrderItemDto) items!: ReceivePurchaseOrderItemDto[];
  @IsOptional() @IsString() @MaxLength(120) reference?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
