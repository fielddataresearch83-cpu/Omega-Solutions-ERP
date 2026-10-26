import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class CreateSupplierBillItemDto {
  @IsString() @MaxLength(250) description!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) quantity!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) unitCost!: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) taxRate?: number;
  @IsOptional() @IsIn(['legacy', 'standard', 'zero_rated', 'exempt', 'out_of_scope']) taxTreatment?: 'legacy' | 'standard' | 'zero_rated' | 'exempt' | 'out_of_scope';
  @IsOptional() @IsUUID() purchaseOrderItemId?: string;
}
export class CreateSupplierBillDto {
  @IsUUID() supplierId!: string;
  @IsOptional() @IsUUID() purchaseOrderId?: string;
  @IsOptional() @IsString() @MaxLength(120) supplierInvoiceNumber?: string;
  @IsOptional() @IsDateString() billDate?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({each:true}) @Type(() => CreateSupplierBillItemDto) items!: CreateSupplierBillItemDto[];
}
export class RecordSupplierBillPaymentDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount!: number;
  @IsOptional() @IsDateString() paymentDate?: string;
  @IsString() @IsIn(['bank_transfer','mpesa','cash','cheque','card','other']) method!: string;
  @IsOptional() @IsString() @MaxLength(120) reference?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
