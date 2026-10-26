import * as React from "react";
import type { AuthenticatedUser } from "@/lib/api-types";
import { api, getAccessToken, getRefreshToken, setTokens, clearTokens } from "@/lib/api-client";
import { getCurrentUser, login, exchangeNeonToken, exchangeNeonInvitationToken, completeMfaChallenge } from "@/lib/auth-api";
import { signInWithNeon } from "@/lib/neon-auth-api";
import type { LoginResponse, MfaChallengeResponse } from "@/lib/auth-api";

interface AuthContextValue {
  user: AuthenticatedUser | null;
  loading: boolean;
  error: string | null;
  mfaChallengePending: boolean;
  completeMfaCode: (code: string) => Promise<void>;
  loginEmail: (email: string, password: string) => Promise<void>;
  registerUser: (email: string, password: string, fullName: string, phone?: string, companyName?: string) => Promise<void>;
  finishNeonRegistration: (token: string, fullName: string, phone?: string, companyName?: string) => Promise<void>;
  finishNeonInvitation: (token: string, invitationToken: string) => Promise<boolean>;
  switchCompany: (companyId: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [mfaChallengeToken, setMfaChallengeToken] = React.useState<string | null>(null);

  React.useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      setLoading(false);
      return;
    }
    getCurrentUser(token)
      .then((u) => setUser(u))
      .catch(() => {
        clearTokens();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const applyOmegaSession = React.useCallback(async (result: LoginResponse | MfaChallengeResponse) => {
    if ("mfaRequired" in result) {
      setMfaChallengeToken(result.mfaChallengeToken);
      return;
    }
    setMfaChallengeToken(null);
    setTokens(result.accessToken, result.refreshToken);
    try {
      const current = await getCurrentUser(result.accessToken);
      setUser(current);
    } catch (err) {
      clearTokens();
      setUser(null);
      throw err;
    }
  }, []);

  const loginEmail = React.useCallback(async (email: string, password: string) => {
    setError(null);
    let neonError: unknown;
    if (import.meta.env.VITE_NEON_AUTH_URL) {
      try {
        const token = await signInWithNeon(email, password);
        const result = await exchangeNeonToken(token, email, undefined, undefined);
        await applyOmegaSession(result);
        return;
      } catch (err) {
        neonError = err;
      }
    }
    try {
      const result = await login(email, password);
      await applyOmegaSession(result);
    } catch (legacyError) {
      if (neonError instanceof Error) throw neonError;
      throw legacyError;
    }
  }, [applyOmegaSession]);

  const completeMfaCode = React.useCallback(async (code: string) => {
    if (!mfaChallengeToken) throw new Error("No active MFA challenge. Please sign in again.");
    const result = await completeMfaChallenge(mfaChallengeToken, code);
    await applyOmegaSession(result);
  }, [mfaChallengeToken, applyOmegaSession]);

  const registerUser = React.useCallback(async (email: string, password: string, fullName: string, phone?: string, companyName?: string) => {
    setError(null);
    const { registerWithNeon } = await import("@/lib/neon-auth-api");
    await registerWithNeon({ email, password, fullName });
    void phone;
    void companyName;
  }, []);

  const finishNeonRegistration = React.useCallback(async (token: string, fullName: string, phone?: string, companyName?: string) => {
    setError(null);
    const result = await exchangeNeonToken(token, fullName, phone, companyName);
    await applyOmegaSession(result);
  }, [applyOmegaSession]);

  const finishNeonInvitation = React.useCallback(async (token: string, invitationToken: string) => {
    setError(null);
    const result = await exchangeNeonInvitationToken(token, invitationToken);
    await applyOmegaSession(result);
    return "mfaRequired" in result;
  }, [applyOmegaSession]);

  const switchCompany = React.useCallback(async (companyId: string) => {
    if (!companyId || companyId === user?.companyId) return;
    const previousAccessToken = getAccessToken();
    const previousRefreshToken = getRefreshToken();
    if (!previousAccessToken || !previousRefreshToken) throw new Error("Your session has expired. Please sign in again.");

    const result = await api.post<LoginResponse>("/auth/switch-company", { companyId });
    if (!result?.accessToken || !result.refreshToken) throw new Error("The company switch returned an invalid session.");

    setTokens(result.accessToken, result.refreshToken);
    try {
      const current = await getCurrentUser(result.accessToken);
      setUser(current);
    } catch (err) {
      setTokens(previousAccessToken, previousRefreshToken);
      throw err;
    }
  }, [user?.companyId]);

  const logout = React.useCallback(() => {
    clearTokens();
    setUser(null);
  }, []);

  const refreshUser = React.useCallback(async () => {
    const token = getAccessToken();
    if (!token) return;
    const u = await getCurrentUser(token);
    setUser(u);
  }, []);

  const value: AuthContextValue = {
    user,
    loading,
    error,
    mfaChallengePending: Boolean(mfaChallengeToken),
    completeMfaCode,
    loginEmail,
    registerUser,
    finishNeonRegistration,
    finishNeonInvitation,
    switchCompany,
    logout,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
