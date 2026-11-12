import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class CreateBankStatementLineDto {
  @IsDateString()
  transactionDate!: string;

  @IsString()
  @MaxLength(500)
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  reference?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  debit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  credit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  runningBalance?: number;
}

export class CreateBankStatementDto {
  @IsUUID()
  accountId!: string;

  @IsDateString()
  statementStart!: string;

  @IsDateString()
  statementEnd!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  openingBalance!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  closingBalance!: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileName?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateBankStatementLineDto)
  lines!: CreateBankStatementLineDto[];
}

export class MatchBankStatementLineDto {
  @IsUUID()
  journalEntryId!: string;
}
