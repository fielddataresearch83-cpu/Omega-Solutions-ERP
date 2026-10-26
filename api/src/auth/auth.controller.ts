import { Controller, Post, Get, Body, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { LoginDto, RefreshDto, NeonExchangeDto, NeonInvitationExchangeDto, SwitchCompanyDto } from './dto/auth.dto.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import type { AuthenticatedUser } from './interfaces/authenticated-user.js';
import { MfaService } from './mfa.service.js';
import { MfaCodeDto, MfaChallengeDto } from './dto/mfa.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService, private readonly mfaService: MfaService) {}

  @Post('register')
  async register() {
    throw new BadRequestException('Please register through the email verification flow.');
  }

  @Post('neon/exchange')
  async exchangeNeonIdentity(@Body() dto: NeonExchangeDto) {
    return this.authService.exchangeNeonIdentity(dto);
  }

  @Post('neon/exchange-invitation')
  async exchangeNeonInvitation(@Body() dto: NeonInvitationExchangeDto) {
    return this.authService.exchangeNeonInvitation(dto);
  }

  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }


  @Post('mfa/challenge')
  async completeMfaChallenge(@Body() dto: MfaChallengeDto) {
    return this.authService.completeMfaChallenge(dto.challengeToken, dto.code);
  }

  @Get('mfa/status')
  @UseGuards(JwtAuthGuard)
  async mfaStatus(@Request() req: { user: AuthenticatedUser }) {
    return this.mfaService.status(req.user.userId);
  }

  @Post('mfa/enroll')
  @UseGuards(JwtAuthGuard)
  async beginMfaEnrollment(@Request() req: { user: AuthenticatedUser }) {
    return this.mfaService.beginEnrollment(req.user.userId, req.user.email);
  }

  @Post('mfa/confirm')
  @UseGuards(JwtAuthGuard)
  async confirmMfaEnrollment(@Request() req: { user: AuthenticatedUser }, @Body() dto: MfaCodeDto) {
    return this.mfaService.confirmEnrollment(req.user.userId, dto.code);
  }

  @Post('mfa/disable')
  @UseGuards(JwtAuthGuard)
  async disableMfa(@Request() req: { user: AuthenticatedUser }, @Body() dto: MfaCodeDto) {
    await this.mfaService.disable(req.user.userId, dto.code);
    return { enabled: false };
  }

  @Post('refresh')
  async refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto);
  }


  @Get('companies')
  @UseGuards(JwtAuthGuard)
  async activeCompanies(@Request() req: { user: AuthenticatedUser }) {
    return this.authService.getActiveCompanies(req.user.userId);
  }

  @Post('switch-company')
  @UseGuards(JwtAuthGuard)
  async switchCompany(
    @Request() req: { user: AuthenticatedUser },
    @Body() dto: SwitchCompanyDto,
  ) {
    return this.authService.switchCompany(req.user.userId, dto.companyId, req.user.mfaVerified === true);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Request() req: { user: AuthenticatedUser }) {
    return req.user;
  }
}
