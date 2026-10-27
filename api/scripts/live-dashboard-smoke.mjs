const base = (process.env.OMEGA_API_URL || "https://omega-solutions-api-development.onrender.com/api").replace(/\/$/, "");
const email = process.env.OMEGA_DASHBOARD_TEST_EMAIL || process.env.OMEGA_SECURITY_TEST_A_EMAIL;
const password = process.env.OMEGA_DASHBOARD_TEST_PASSWORD || process.env.OMEGA_SECURITY_TEST_A_PASSWORD;
if (![email, password].every(v => typeof v === "string" && v.trim())) {
  throw new Error("Configure OMEGA_DASHBOARD_TEST_EMAIL and OMEGA_DASHBOARD_TEST_PASSWORD (or the existing OMEGA_SECURITY_TEST_A_EMAIL/PASSWORD secrets).");
}
const checks = [];
function assert(ok, message) {
  if (!ok) throw new Error(message);
  checks.push(message);
}
async function api(method, path, token, body) {
  const response = await fetch(base + path, {
    method,
    headers: { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(45000),
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  return { status: response.status, data };
}
async function login() {
  const authBase = (process.env.NEON_AUTH_BASE_URL || "https://ep-fragrant-bird-b4hie5sp.neonauth.c-6.us-east-2.aws.neon.tech/neondb/auth").replace(/\/$/, "");
  const origin = (process.env.OMEGA_SECURITY_TEST_ORIGIN || "https://omega-solutions-git-development-pestria72-2760.vercel.app").replace(/\/$/, "");
  const response = await fetch(authBase + "/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin, referer: origin + "/login" },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(45000),
  });
  if (response.status === 401) {
    const legacy = await api("POST", "/auth/login", null, { email, password });
    if (legacy.status !== 200) throw new Error(`Both configured sign-in paths rejected the dashboard test account (Neon Auth 401; Omega login HTTP ${legacy.status}).`);
    assert(true, "test account authenticated through legacy Omega login");
    return legacy.data;
  }
  const raw = await response.text();
  let auth;
  try { auth = raw ? JSON.parse(raw) : null; } catch { auth = raw; }
  if (!response.ok) throw new Error(`Neon Auth sign-in failed with HTTP ${response.status}; response=${JSON.stringify(auth).slice(0, 200)}`);
  const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie")].filter(Boolean);
  const cookie = cookies.map(v => v.split(";", 1)[0]).filter(Boolean).join("; ");
  if (!cookie) throw new Error("Neon Auth did not issue a session cookie; cannot verify dashboard.");
  const tokenResponse = await fetch(authBase + "/token", { headers: { origin, referer: origin + "/login", cookie }, signal: AbortSignal.timeout(45000) });
  const tokenRaw = await tokenResponse.text();
  let tokenData;
  try { tokenData = tokenRaw ? JSON.parse(tokenRaw) : null; } catch { tokenData = tokenRaw; }
  if (!tokenResponse.ok) throw new Error(`Neon Auth JWT endpoint failed with HTTP ${tokenResponse.status}.`);
  const identityToken = tokenData?.token ?? tokenData?.data?.token;
  if (typeof identityToken !== "string" || identityToken.split(".").length !== 3) throw new Error("Neon Auth did not return a usable JWT.");

  // Company selection is explicit for multi-tenant identities. Discover active
  // memberships first so this smoke test exercises the same safe login contract
  // as the UI rather than relying on an implicit first-company fallback.
  const companyResponse = await api("POST", "/auth/neon/companies", null, { token: identityToken });
  if (![200, 201].includes(companyResponse.status) || !Array.isArray(companyResponse.data?.companies)) {
    throw new Error(`Omega active-company discovery failed with HTTP ${companyResponse.status}.`);
  }
  const companies = companyResponse.data.companies;
  const configuredCompanyId = process.env.OMEGA_DASHBOARD_TEST_COMPANY_ID
    || process.env.OMEGA_SECURITY_TEST_A_COMPANY_ID;
  let companyId;
  if (configuredCompanyId) {
    if (!companies.some(company => company.id === configuredCompanyId)) {
      throw new Error("Configured dashboard test company is not an active membership of the test account.");
    }
    companyId = configuredCompanyId;
  } else if (companies.length > 0) {
    // The API returns active memberships in stable company-name order. The smoke
    // test explicitly submits the first returned ID; it never relies on backend
    // implicit membership selection or guesses a company outside the allowlist.
    companyId = companies[0].id;
  } else {
    throw new Error("Dashboard test account has no active Omega company membership.");
  }

  const exchange = await api("POST", "/auth/neon/exchange", null, { token: identityToken, companyId });
  if (![200, 201].includes(exchange.status)) throw new Error(`Omega identity exchange failed with HTTP ${exchange.status} for the explicitly selected company.`);
  assert(true, "test account authenticated through Neon Auth identity exchange");
  return exchange.data;
}
async function main() {
  const health = await api("GET", "/health");
  assert(health.status === 200 && health.data?.status === "ok" && health.data?.database === "connected", "API and PostgreSQL health are healthy");
  const session = await login();
  const accessToken = session.accessToken;
  assert(typeof accessToken === "string" && accessToken.length > 0, "login returned an Omega access token");
  assert(typeof session.user?.companyId === "string" && session.user.companyId.length > 0, "test account has a selected company");
  const [dashboard, modules] = await Promise.all([
    api("GET", "/dashboard/summary", accessToken),
    api("GET", "/subscriptions/modules", accessToken),
  ]);
  assert(dashboard.status === 200, `authenticated dashboard summary returned HTTP ${dashboard.status}`);
  assert(typeof dashboard.data?.currency === "string" && dashboard.data.currency.length > 0, "dashboard response includes company currency");
  assert(dashboard.data?.modules && typeof dashboard.data.modules === "object", "dashboard response includes module access state");
  assert(modules.status === 200, `authenticated module catalogue returned HTTP ${modules.status}`);
  assert(Array.isArray(modules.data?.modules), "module catalogue returns a modules array");
  console.log(JSON.stringify({ result: "PASS", api: base, companyId: session.user.companyId, checks }, null, 2));
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
