import { IsBoolean } from 'class-validator';

export class UpdateMembershipStatusDto {
  @IsBoolean()
  isActive!: boolean;
}
