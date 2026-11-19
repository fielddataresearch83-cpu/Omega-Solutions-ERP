import { IsIn, IsString } from 'class-validator';

export class UpdateDisplayPreferencesDto {
  @IsString()
  @IsIn(['DD MMM YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'])
  dateFormat!: string;
}
