import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { JwtPayload, AuthenticatedUser } from '../interfaces/authenticated-user.js';
import { AuthService } from '../auth.service.js';
import { MfaService } from '../mfa.service.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly authService: AuthService, private readonly mfaService: MfaService) {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET is missing from the environment.');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
      algorithms: ['HS256'],
    });
  }

  async validate(payload: JwtPayload & { mfaChallenge?: boolean; familyId?: string }): Promise<AuthenticatedUser> {
    if (payload.mfaChallenge) throw new UnauthorizedException('MFA challenge token cannot be used as an access token.');
    if (!payload.familyId) throw new UnauthorizedException('Access token is not bound to a server session. Please sign in again.');
    await this.authService.assertActiveSession(payload.familyId, payload.sub, payload.companyId);
    const mfaStatus = await this.mfaService.status(payload.sub);
    if (mfaStatus.enabled && payload.mfaVerified !== true) throw new UnauthorizedException('Sign in again and complete MFA to access Omega.');
    const user = await this.authService.getUserProfile(payload.sub, payload.companyId);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return { ...user, mfaVerified: payload.mfaVerified === true, sessionFamilyId: payload.familyId };
  }
}
