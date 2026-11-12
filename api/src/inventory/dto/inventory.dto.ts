import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';

export class CreateWarehouseDto {
  @IsString() @MaxLength(24) code!: string;
  @IsString() @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(500) location?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) capacity?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateWarehouseDto {
  @IsOptional() @IsString() @MaxLength(24) code?: string;
  @IsOptional() @IsString() @MaxLength(160) name?: string;
  @IsOptional() @IsString() @MaxLength(500) location?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) capacity?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateStockMovementDto {
  @IsUUID() productId!: string;
  @IsUUID() warehouseId!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.000001) quantity!: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) unitCost?: number;
  @IsOptional() @IsString() @MaxLength(120) reference?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class AdjustStockDto {
  @IsUUID() productId!: string;
  @IsUUID() warehouseId!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) newQuantity!: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) unitCost?: number;
  @IsOptional() @IsString() @MaxLength(120) reference?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class TransferStockDto {
  @IsUUID() productId!: string;
  @IsUUID() sourceWarehouseId!: string;
  @IsUUID() destinationWarehouseId!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.000001) quantity!: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) unitCost?: number;
  @IsOptional() @IsString() @MaxLength(120) reference?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class CreateStocktakeDto { @IsUUID() warehouseId!: string; @IsOptional() @IsString() @MaxLength(120) reference?: string; @IsOptional() @IsString() @MaxLength(2000) notes?: string; }
export class CountStocktakeLineDto { @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) countedQuantity!: number; @IsOptional() @IsString() @MaxLength(2000) notes?: string; }


export class CreateInventoryReturnLineDto {
  @IsUUID() productId!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.0001) quantity!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) unitCost!: number;
  @IsIn(['restock', 'quarantine', 'reject', 'return_to_supplier']) disposition!: 'restock' | 'quarantine' | 'reject' | 'return_to_supplier';
  @IsOptional() @IsString() @MaxLength(2000) inspectionNotes?: string;
}

export class CreateInventoryReturnDto {
  @IsIn(['customer', 'supplier']) returnType!: 'customer' | 'supplier';
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() supplierId?: string;
  @IsUUID() warehouseId!: string;
  @IsOptional() @IsString() @MaxLength(120) sourceReference?: string;
  @IsString() @MaxLength(1000) reason!: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => CreateInventoryReturnLineDto) items!: CreateInventoryReturnLineDto[];
}

export class ResolveInventoryQuarantineDto {
  @IsUUID() warehouseId!: string;
  @IsUUID() productId!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.0001) quantity!: number;
  @IsIn(['restock', 'reject']) disposition!: 'restock' | 'reject';
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
