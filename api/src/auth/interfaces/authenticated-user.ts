export interface AuthenticatedUser {
  userId: string;
  email: string;
  fullName: string;
  companyId: string | null;
  branchId: string | null;
  role: string;
  permissions: string[];
  mfaVerified?: boolean;
  /** Server-tracked refresh-token family associated with this authenticated request. */
  sessionFamilyId?: string;
}

export interface JwtPayload {
  sub: string;
  email: string;
  companyId: string | null;
  branchId: string | null;
  role: string;
  mfaVerified?: boolean;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}
