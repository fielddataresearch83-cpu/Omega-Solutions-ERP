const NEON_AUTH_URL = import.meta.env.VITE_NEON_AUTH_URL as string | undefined;

type NeonResponse = {
  message?: string;
  error?: string;
  token?: string;
  data?: {
    token?: string;
    jwt?: string;
    accessToken?: string;
    access_token?: string;
    session?: { token?: string; access_token?: string; accessToken?: string };
  };
  /** JWT exposed by Neon Auth on the response, as consumed by the official SDK. */
  jwt?: string;
  accessToken?: string;
  access_token?: string;
  session?: { token?: string; access_token?: string; accessToken?: string };
};

function authUrl(): string {
  if (!NEON_AUTH_URL) {
    throw new Error("Email verification is not configured for this deployment. Please use the existing Omega sign-in or contact support.");
  }
  return NEON_AUTH_URL.replace(/\/$/, "");
}

async function neonRequest(path: string, body?: unknown): Promise<NeonResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  let response: Response;
  try {
    response = await fetch(`${authUrl()}${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "include",
    signal: controller.signal,
    headers: body === undefined ? { Accept: "application/json" } : {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("Account verification is taking too long. Your invitation has not been accepted yet. Please retry.", { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const raw = await response.text();
  const result: NeonResponse = (() => {
    try {
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      // Some auth endpoints (notably an unauthenticated /get-session) can return JSON null.
      // Normalize that response before reading error/message fields so the invitation page
      // can show the intended sign-in guidance instead of crashing on null.error.
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as NeonResponse
        : {};
    } catch (error) {
      throw new Error("The email authentication service returned an invalid response. Please try again.", { cause: error });
    }
  })();

  if (!response.ok || result.error) {
    throw new Error(result.message || result.error || "Email authentication failed. Check your details and try again.");
  }
  const headerJwt = response.headers.get("set-auth-jwt");
  // Do not erase a JWT returned in the JSON body when the optional header is absent.
  return headerJwt ? { ...result, jwt: headerJwt } : result;
}

export async function registerWithNeon(input: {
  email: string;
  password: string;
  fullName: string;
}): Promise<boolean> {
  const email = input.email.trim().toLowerCase();
  await neonRequest("/sign-up/email", {
    name: input.fullName,
    email,
    password: input.password,
  });

  // Account creation is already complete. If OTP delivery fails, keep the UI
  // on the verification step so the user can retry delivery instead of
  // submitting registration again and hitting an existing-account conflict.
  try {
    await neonRequest("/email-otp/send-verification-otp", {
      email,
      type: "email-verification",
    });
    return true;
  } catch {
    return false;
  }
}

export async function resendNeonVerification(email: string): Promise<void> {
  await neonRequest("/email-otp/send-verification-otp", {
    email: email.trim().toLowerCase(),
    type: "email-verification",
  });
}

export async function verifyNeonEmailAndSignIn(input: {
  email: string;
  password: string;
  otp: string;
}): Promise<string> {
  const email = input.email.trim().toLowerCase();
  await neonRequest("/email-otp/verify-email", { email, otp: input.otp.trim() });

  // Verification deliberately does not sign the user in; perform an explicit password sign-in.
  const signInResponse = await neonRequest("/sign-in/email", { email: email, password: input.password });
  // Prefer the JWT returned by sign-in. A separate /token request depends on a
  // cross-origin session cookie that may be blocked by browser privacy settings.
  const directToken = signInResponse.jwt
    || signInResponse.accessToken
    || signInResponse.access_token
    || signInResponse.data?.jwt
    || signInResponse.data?.accessToken
    || signInResponse.data?.access_token
    || signInResponse.data?.session?.access_token
    || signInResponse.data?.session?.accessToken;
  if (directToken) return directToken;

  // Use /token only as a fallback when sign-in returned no identity JWT.
  try {
    const tokenResponse = await neonRequest("/token");
    const token = tokenResponse.jwt
      || tokenResponse.accessToken
      || tokenResponse.access_token
      || tokenResponse.data?.jwt
      || tokenResponse.data?.token
      || tokenResponse.data?.accessToken
      || tokenResponse.data?.access_token
      || tokenResponse.data?.session?.access_token
      || tokenResponse.data?.session?.accessToken
      || tokenResponse.token;
    if (token) return token;
  } catch {
    // Show one actionable setup error rather than a misleading cookie/session error.
  }
  throw new Error("Your email was verified, but Omega could not complete account setup securely. Please try again.");
}

export async function signInWithNeon(emailInput: string, password: string): Promise<string> {
  const email = emailInput.trim().toLowerCase();
  const signInResponse = await neonRequest("/sign-in/email", { email, password });

  // Prefer the JWT returned by Neon Auth itself (including its set-auth-jwt
  // response header). A second cross-origin /token request can fail when browser
  // cookie restrictions block the Auth session cookie, even after sign-in worked.
  const directToken = signInResponse.jwt
    || signInResponse.accessToken
    || signInResponse.access_token
    || signInResponse.data?.jwt
    || signInResponse.data?.accessToken
    || signInResponse.data?.access_token
    || signInResponse.data?.session?.access_token
    || signInResponse.data?.session?.accessToken;
  if (directToken) return directToken;

  // Only call /token when sign-in did not return a JWT.
  try {
    const tokenResponse = await neonRequest("/token");
    const token = tokenResponse.jwt
      || tokenResponse.accessToken
      || tokenResponse.access_token
      || tokenResponse.data?.jwt
      || tokenResponse.data?.token
      || tokenResponse.data?.accessToken
      || tokenResponse.data?.access_token
      || tokenResponse.data?.session?.access_token
      || tokenResponse.data?.session?.accessToken
      || tokenResponse.token;
    if (token) return token;
  } catch {
    // Surface the account-setup error below instead of a misleading fallback
    // session Unauthorized when the sign-in response had no JWT.
  }

  throw new Error("Your email was verified, but Omega could not complete account setup securely. Please try again.");
}

export async function getNeonIdentityToken(): Promise<string> {
  // Confirm the magic-link callback actually established a browser session before
  // asking the JWT plugin for a token. This distinguishes a missing session cookie
  // from a token response that the client cannot parse.
  const sessionResponse = await neonRequest("/get-session");
  const session = sessionResponse.data?.session || sessionResponse.session;
  const hasSession = Boolean(session || sessionResponse.data?.token || sessionResponse.token);
  if (!hasSession) {
    throw new Error("Your verification session could not be found. Please reopen the Omega invitation and try again.");
  }

  // Do not use session.token as an identity JWT: it may be an opaque session ID.
  const tokenResponse = await neonRequest("/token");
  const token = tokenResponse.jwt
    || tokenResponse.accessToken
    || tokenResponse.access_token
    || tokenResponse.data?.jwt
    || tokenResponse.data?.token
    || tokenResponse.data?.accessToken
    || tokenResponse.data?.access_token
    || tokenResponse.data?.session?.access_token
    || tokenResponse.data?.session?.accessToken
    || tokenResponse.token;
  if (!token) {
    throw new Error("Your email session is active, but Omega could not complete account setup securely. Please retry.");
  }
  return token;
}

/**
 * Request a password-reset OTP through Neon Auth's email-OTP plugin.
 * The provider handles delivery, expiry, and one-time token validation.
 */
export async function requestNeonPasswordReset(emailInput: string): Promise<void> {
  await neonRequest("/forget-password/email-otp", {
    email: emailInput.trim().toLowerCase(),
  });
}

/** Complete an OTP password reset using Neon Auth's email-OTP plugin. */
export async function resetNeonPassword(emailInput: string, otp: string, newPassword: string): Promise<void> {
  await neonRequest("/email-otp/reset-password", {
    email: emailInput.trim().toLowerCase(),
    otp: otp.trim(),
    password: newPassword,
  });
}
