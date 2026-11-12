import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
export class CreateAccountDto {
 @IsString() @MinLength(1) @MaxLength(20) code!: string;
 @IsString() @MinLength(1) @MaxLength(160) name!: string;
 @IsString() @IsIn(['asset','liability','equity','income','expense']) accountType!: string;
 @IsOptional() @IsString() @IsIn(['debit','credit']) normalSide?: string;
 @IsOptional() @IsString() @IsIn(['operating','investing','financing']) cashFlowCategory?: 'operating'|'investing'|'financing';
}
