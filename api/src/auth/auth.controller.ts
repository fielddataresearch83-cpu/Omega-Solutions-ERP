import { Controller, Post, Get, Body, UseGuards, Request, BadRequestException, Res, Req, UnauthorizedException } from '@nestjs/common';
import type { Request as ExpressRequest, Response } from 'express';
import { AuthService } from './auth.service.js';
import { LoginDto, NeonExchangeDto, NeonIdentityCompaniesDto, NeonInvitationExchangeDto, SwitchCompanyDto } from './dto/auth.dto.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import type { AuthenticatedUser } from './interfaces/authenticated-user.js';
import { MfaService } from './mfa.service.js';
import { MfaCodeDto, MfaChallengeDto } from './dto/mfa.dto.js';
import { AuthRateLimitGuard } from './auth-rate-limit.guard.js';

const REFRESH_COOKIE = 'omega_refresh';
const REFRESH_COOKIE_PATH = '/api/auth';
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

@Controller('auth')
@UseGuards(AuthRateLimitGuard)
export class AuthController {
  constructor(private readonly authService: AuthService, private readonly mfaService: MfaService) {}

  private readRefreshCookie(request: ExpressRequest): string | undefined {
    const cookieHeader = request.headers.cookie;
    if (!cookieHeader) return undefined;
    const entry = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(REFRESH_COOKIE + '='));
    if (!entry) return undefined;
    const value = entry.slice(REFRESH_COOKIE.length + 1);
    try { return decodeURIComponent(value); } catch { return undefined; }
  }

  private setRefreshCookie(response: Response, token: string): void {
    response.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: REFRESH_COOKIE_PATH,
      maxAge: REFRESH_COOKIE_MAX_AGE,
    });
  }

  private clearRefreshCookie(response: Response): void {
    response.clearCookie(REFRESH_COOKIE, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: REFRESH_COOKIE_PATH,
    });
  }

  private sessionResponse<T>(result: T, response: Response): T | Omit<T, 'refreshToken'> {
    if (!result || typeof result !== 'object' || !('refreshToken' in result)) return result;
    const session = result as T & { refreshToken?: unknown };
    if (typeof session.refreshToken !== 'string' || !session.refreshToken) return result;
    this.setRefreshCookie(response, session.refreshToken);
    const { refreshToken: _refreshToken, ...safe } = session;
    return safe as Omit<T, 'refreshToken'>;
  }

  private assertTrustedCookieOrigin(request: ExpressRequest): void {
    const origin = request.headers.origin;
    // Non-browser clients may omit Origin. Browser-supplied origins must match
    // the same explicit allow-list used by the CORS policy.
    if (!origin) return;
    const configured = [
      ...(process.env.CORS_ORIGINS || '').split(','),
      ...(process.env.CORS_ORIGIN || '').split(','),
    ].map((value) => value.trim()).filter(Boolean);
    const allowedOrigins = configured.length ? configured : ['http://localhost:5173'];
    const trustedVercelOrigin =
      origin === 'https://omega-solutions-nine.vercel.app' ||
      /^https:\/\/omega-solutions-[a-z0-9-]+-pestria72-2760\.vercel\.app$/.test(origin);
    if (!allowedOrigins.includes(origin) && !trustedVercelOrigin) {
      throw new UnauthorizedException('This request origin is not allowed.');
    }
  }

  @Post('register')
  async register() {
    throw new BadRequestException('Please register through the email verification flow.');
  }

  @Post('neon/companies')
  async neonIdentityCompanies(@Body() dto: NeonIdentityCompaniesDto) {
    return { companies: await this.authService.getNeonIdentityCompanies(dto.token) };
  }

  @Post('neon/exchange')
  async exchangeNeonIdentity(@Body() dto: NeonExchangeDto, @Res({ passthrough: true }) response: Response) {
    return this.sessionResponse(await this.authService.exchangeNeonIdentity(dto), response);
  }

  @Post('neon/exchange-invitation')
  async exchangeNeonInvitation(@Body() dto: NeonInvitationExchangeDto, @Res({ passthrough: true }) response: Response) {
    return this.sessionResponse(await this.authService.exchangeNeonInvitation(dto), response);
  }

  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: Response) {
    return this.sessionResponse(await this.authService.login(dto), response);
  }

  @Post('mfa/challenge')
  async completeMfaChallenge(@Body() dto: MfaChallengeDto, @Res({ passthrough: true }) response: Response) {
    return this.sessionResponse(await this.authService.completeMfaChallenge(dto.challengeToken, dto.code), response);
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

  @Post('logout')
  async logout(
    @Body() body: { refreshToken?: string } = {},
    @Req() request: ExpressRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.assertTrustedCookieOrigin(request);
    const cookieToken = this.readRefreshCookie(request);
    const token = cookieToken || body?.refreshToken;
    if (token) await this.authService.revokeRefreshToken(token);
    this.clearRefreshCookie(response);
    return { success: true };
  }

  @Post('refresh')
  async refresh(
    @Body() body: { refreshToken?: string } = {},
    @Req() request: ExpressRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.assertTrustedCookieOrigin(request);
    const cookieToken = this.readRefreshCookie(request);
    const token = cookieToken || body?.refreshToken;
    if (!token) {
      this.clearRefreshCookie(response);
      throw new UnauthorizedException('Refresh session is missing. Please sign in again.');
    }
    const result = await this.authService.refresh({ refreshToken: token });
    return this.sessionResponse(result, response);
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
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.sessionResponse(
      await this.authService.switchCompany(req.user.userId, dto.companyId, req.user.mfaVerified === true),
      response,
    );
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Request() req: { user: AuthenticatedUser }) {
    return req.user;
  }
}
