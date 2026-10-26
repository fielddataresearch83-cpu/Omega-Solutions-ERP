import { ArrayMinSize, IsArray, IsDateString, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCreditNoteItemDto {
  @IsUUID()
  invoiceItemId!: string;

  @IsString()
  @MaxLength(200)
  description!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  unitPrice!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsOptional()
  @Min(0)
  @Max(100)
  taxRate?: number;
}

export class CreateCreditNoteDto {
  @IsUUID()
  invoiceId!: string;

  @IsDateString()
  issueDate!: string;

  @IsString()
  @MaxLength(1000)
  reason!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateCreditNoteItemDto)
  items!: CreateCreditNoteItemDto[];
}
