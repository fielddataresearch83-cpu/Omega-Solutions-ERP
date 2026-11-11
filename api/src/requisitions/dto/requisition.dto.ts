import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsOptional, IsString, IsUUID, MaxLength, Min, IsNumber, ValidateNested } from 'class-validator';

export class RequisitionItemDto {
  @IsUUID() productId!: string;
  @Type(() => Number) @IsNumber() @Min(0.001) quantity!: number;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}
export class CreateRequisitionDto {
  @IsString() @MaxLength(200) title!: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsDateString() requiredBy?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => RequisitionItemDto) items!: RequisitionItemDto[];
}
export class UpdateRequisitionDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsDateString() requiredBy?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => RequisitionItemDto) items?: RequisitionItemDto[];
}
export class ApprovalDecisionDto {
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
