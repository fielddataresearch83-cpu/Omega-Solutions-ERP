import { IsEmail, IsString, MinLength, MaxLength, IsOptional, IsUUID } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  fullName!: string;

  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @IsOptional()
  companyName?: string;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;

  @IsUUID()
  @IsOptional()
  companyId?: string;
}

export class RefreshDto {
  @IsString()
  refreshToken!: string;
}

export class NeonExchangeDto {
  @IsString()
  @MinLength(20)
  @MaxLength(8192)
  token!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @IsOptional()
  fullName?: string;

  @IsString()
  @MaxLength(20)
  @IsOptional()
  phone?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @IsOptional()
  companyName?: string;
}


export class SwitchCompanyDto {
  @IsUUID()
  companyId!: string;
}

export class NeonInvitationExchangeDto {
  @IsString()
  @MinLength(20)
  @MaxLength(8192)
  token!: string;

  @IsString()
  @MinLength(20)
  @MaxLength(256)
  invitationToken!: string;
}
