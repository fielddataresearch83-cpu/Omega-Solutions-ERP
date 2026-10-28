// Fail safe to the development API when an environment-specific URL is not supplied.
// Production builds must explicitly set VITE_API_BASE_URL to the production API.
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "https://omega-solutions-api-development.onrender.com/api";

let accessTokenInMemory: string | null = null;

export function getAccessToken(): string | null {
  return accessTokenInMemory;
}

export function getRefreshToken(): string | null {
  // Refresh credentials are held only in the API's HttpOnly cookie.
  return null;
}

export function setTokens(accessToken: string, _refreshToken?: string): void {
  accessTokenInMemory = accessToken;
  // Clean up credentials persisted by older versions; access and refresh tokens
  // must not be stored in browser-readable persistent storage.
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem("omega-token");
    localStorage.removeItem("omega-refresh");
  }
}

export function clearTokens(): void {
  accessTokenInMemory = null;
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem("omega-token");
    localStorage.removeItem("omega-refresh");
  }
}

interface ApiError {
  statusCode: number;
  message: string;
  details?: unknown;
  timestamp?: string;
  path?: string;
}

function responseMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
    if (Array.isArray(message)) return message.filter((item): item is string => typeof item === "string").join("; ") || fallback;
  }
  return fallback;
}

async function readResponseBody<T>(res: Response, path: string, method: string): Promise<T> {
  if (res.status === 204 || res.status === 205) return undefined as T;

  const raw = await res.text();
  if (!raw.trim()) {
    throw {
      statusCode: res.status,
      message: `The API returned an empty response for ${method} ${path} (HTTP ${res.status}). Please refresh and try again.`,
      path,
    } as ApiError;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    const contentType = res.headers.get("content-type") ?? "";
    const detail = contentType.includes("text/html")
      ? "The server returned an HTML page instead of JSON."
      : "The server returned an incomplete or invalid JSON response.";
    throw {
      statusCode: res.status,
      message: `${detail} Request: ${method} ${path} (HTTP ${res.status}). Please refresh and try again.`,
      path,
    } as ApiError;
  }
}

export async function restoreSession(): Promise<string | null> {
  const refreshed = await refreshAccessToken();
  return refreshed ? getAccessToken() : null;
}

async function refreshAccessToken(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    });
    if (!res.ok) return false;
    const data = await readResponseBody<{ accessToken?: string }>(res, "/auth/refresh", "POST");
    if (!data?.accessToken) return false;
    setTokens(data.accessToken);
    return true;
  } catch {
    return false;
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(!isFormData ? { "Content-Type": "application/json" } : {}),
    ...(options.headers as Record<string, string>),
  };
  const token = getAccessToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const request = () => fetch(`${BASE_URL}${path}`, { ...options, headers, credentials: "include" });
  let res = await request();

  if (res.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      const newToken = getAccessToken();
      if (newToken) headers["Authorization"] = `Bearer ${newToken}`;
      res = await request();
    }
  }

  if (res.status === 401) {
    clearTokens();
    throw { statusCode: 401, message: "Your session has expired. Please sign in again." } as ApiError;
  }

  if (!res.ok) {
    let payload: unknown;
    try {
      const raw = await res.text();
      payload = raw.trim() ? JSON.parse(raw) : undefined;
    } catch {
      payload = undefined;
    }
    throw {
      statusCode: res.status,
      message: responseMessage(payload, res.statusText || `Request failed (HTTP ${res.status})`),
      ...(payload && typeof payload === "object" ? payload : {}),
      path,
    } as ApiError;
  }

  try {
    return await readResponseBody<T>(res, path, method);
  } catch (error) {
    // A GET can occasionally be cut off by a cold start or transient proxy interruption.
    // Retry once only for malformed/empty JSON; don't repeat writes such as checkout.
    if (method === "GET" && error && typeof error === "object" &&
      "message" in error && typeof (error as ApiError).message === "string" &&
      ((error as ApiError).message.includes("empty response") ||
       (error as ApiError).message.includes("incomplete or invalid JSON"))) {
      const retry = await request();
      if (retry.status === 401) {
        clearTokens();
        throw { statusCode: 401, message: "Your session has expired. Please sign in again." } as ApiError;
      }
      if (!retry.ok) {
        let payload: unknown;
        try {
          const raw = await retry.text();
          payload = raw.trim() ? JSON.parse(raw) : undefined;
        } catch {
          payload = undefined;
        }
        throw {
          statusCode: retry.status,
          message: responseMessage(payload, retry.statusText || `Request failed (HTTP ${retry.status})`),
          ...(payload && typeof payload === "object" ? payload : {}),
          path,
        } as ApiError;
      }
      return readResponseBody<T>(retry, path, method);
    }
    throw error;
  }
}

export const api = {
  get: <T>(path: string) => apiRequest<T>(path),
  post: <T>(path: string, body?: unknown) =>
    apiRequest<T>(path, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    }),
  patch: <T>(path: string, body?: unknown) =>
    apiRequest<T>(path, {
      method: "PATCH",
      body: body ? JSON.stringify(body) : undefined,
    }),
  put: <T>(path: string, body?: unknown) =>
    apiRequest<T>(path, {
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
    }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: "DELETE" }),
  upload: <T>(path: string, file: File) => {
    const body = new FormData();
    body.append("file", file);
    return apiRequest<T>(path, { method: "POST", body });
  },
};
