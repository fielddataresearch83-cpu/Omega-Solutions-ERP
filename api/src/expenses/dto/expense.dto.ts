import { IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

export class CreateExpenseDto {
  @IsString() @MinLength(2) @MaxLength(240) description!: string;
  @IsString() @MinLength(2) @MaxLength(120) category!: string;
  @IsNumber({maxDecimalPlaces:2}) @Min(0.01) amount!: number;
  @IsIn(['cash','mpesa','bank']) paymentMethod!: 'cash'|'mpesa'|'bank';
  @IsOptional() @IsDateString() expenseDate?: string;
  @IsOptional() @IsString() @MaxLength(160) reference?: string;
  @IsOptional() @IsUUID() expenseAccountId?: string;
  @IsOptional() @IsUUID() costCentreId?: string;
}
