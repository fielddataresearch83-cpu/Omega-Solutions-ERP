import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import { UserPreferencesService } from './user-preferences.service.js';
import { UpdateDisplayPreferencesDto } from './dto/display-preferences.dto.js';

@Controller('user-preferences')
@UseGuards(JwtAuthGuard)
export class UserPreferencesController {
  constructor(private readonly preferences: UserPreferencesService) {}

  @Get('display')
  getDisplay(@Req() req: { user: AuthenticatedUser }) {
    return this.preferences.getDisplay(req.user);
  }

  @Put('display')
  updateDisplay(@Req() req: { user: AuthenticatedUser }, @Body() dto: UpdateDisplayPreferencesDto) {
    return this.preferences.updateDisplay(req.user, dto.dateFormat);
  }
}
