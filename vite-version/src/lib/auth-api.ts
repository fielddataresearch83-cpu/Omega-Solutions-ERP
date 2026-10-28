import type { AuthenticatedUser } from "./api-types";

export interface LoginResponse {
  accessToken: string;
  refreshToken?: string;
  user: {
    userId: string;
    email: string;
    fullName: string;
    companyId: string | null;
    branchId: string | null;
    role: string;
  };
}

export interface MfaChallengeResponse {
  mfaRequired: true;
  mfaChallengeToken: string;
}

export interface LoginCompanyChoice {
  id: string;
  name: string;
  role: string;
  branchId: string | null;
}

export interface RegisterResponse {
  userId: string;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "https://omega-solutions-api.onrender.com/api";

async function readError(res: Response, fallback: string): Promise<Error> {
  const err = await res.json().catch(() => ({ message: fallback }));
  const message = Array.isArray(err.message) ? err.message.join(", ") : err.message;
  return new Error(message || fallback);
}

export async function login(email: string, password: string): Promise<LoginResponse | MfaChallengeResponse> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw await readError(res, "Invalid credentials");
  return res.json();
}

export async function register(email: string, password: string, fullName: string, phone?: string, companyName?: string): Promise<RegisterResponse> {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password, fullName, phone, companyName }),
  });
  if (!res.ok) throw await readError(res, "Registration failed");
  return res.json();
}

export async function getNeonIdentityCompanies(token: string): Promise<LoginCompanyChoice[]> {
  const res = await fetch(`${API_BASE}/auth/neon/companies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw await readError(res, "Could not load your company memberships");
  const result = await res.json() as { companies?: LoginCompanyChoice[] };
  return result.companies ?? [];
}

export async function exchangeNeonToken(token: string, fullName: string, phone?: string, companyName?: string, companyId?: string, intent: 'login' | 'register' = 'login'): Promise<LoginResponse> {
  const res = await fetch(`${API_BASE}/auth/neon/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ token, fullName, phone, companyName, companyId, intent }),
  });
  if (!res.ok) throw await readError(res, "Could not finish setting up your Omega account");
  return res.json();
}

export async function getCurrentUser(token: string): Promise<AuthenticatedUser> {
  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch user profile");
  return res.json();
}

export async function completeMfaChallenge(challengeToken: string, code: string): Promise<LoginResponse> {
  const res = await fetch(`${API_BASE}/auth/mfa/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ challengeToken, code }),
  });
  if (!res.ok) throw await readError(res, "MFA verification failed");
  return res.json();
}

export async function exchangeNeonInvitationToken(token: string, invitationToken: string): Promise<LoginResponse | MfaChallengeResponse> {
  const res = await fetch(`${API_BASE}/auth/neon/exchange-invitation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ token, invitationToken }),
  });
  if (!res.ok) throw await readError(res, "Could not accept this company invitation");
  return res.json();
}
