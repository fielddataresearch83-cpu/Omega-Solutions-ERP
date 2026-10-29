const base = (process.env.OMEGA_API_URL || "https://omega-solutions-api-development.onrender.com/api").replace(/\/$/, "");
const emailA = process.env.OMEGA_SECURITY_TEST_A_EMAIL;
const passwordA = process.env.OMEGA_SECURITY_TEST_A_PASSWORD;
const emailB = process.env.OMEGA_SECURITY_TEST_B_EMAIL;
const passwordB = process.env.OMEGA_SECURITY_TEST_B_PASSWORD;
if (![emailA, passwordA, emailB, passwordB].every(v => typeof v === "string" && v.trim())) {
  throw new Error("Configure OMEGA_SECURITY_TEST_A_EMAIL, OMEGA_SECURITY_TEST_A_PASSWORD, OMEGA_SECURITY_TEST_B_EMAIL, and OMEGA_SECURITY_TEST_B_PASSWORD as GitHub Actions secrets. Never pass credentials on the command line.");
}
if (emailA.trim().toLowerCase() === emailB.trim().toLowerCase()) throw new Error("Security test requires two distinct verified development accounts.");
const checks = [];
function assert(ok, message) {
  if (!ok) throw new Error(message);
  checks.push(message);
}
async function request(method, path, body, token, expected = [200]) {
  const response = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!expected.includes(response.status)) {
    throw new Error(`${method} ${path}: expected HTTP ${expected.join("/")} , received ${response.status}; response=${JSON.stringify(data).slice(0, 250)}`);
  }
  return data;
}
async function login(email, password, label, avoidCompanyId = null) {
  let result;
  let activeCompanyIds = [];
  const neonAuthBase = (process.env.NEON_AUTH_BASE_URL || "https://ep-fragrant-bird-b4hie5sp.neonauth.c-6.us-east-2.aws.neon.tech/neondb/auth").replace(/\/$/, "");
  const trustedOrigin = (process.env.OMEGA_SECURITY_TEST_ORIGIN || "https://omega-solutions-git-development-pestria72-2760.vercel.app").replace(/\/$/, "");
  if (neonAuthBase) {
    // Neon Auth requires an allowed browser Origin even for this server-side smoke test.
    const response = await fetch(`${neonAuthBase}/sign-in/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: trustedOrigin,
        referer: `${trustedOrigin}/login`,
      },
      body: JSON.stringify({ email, password }),
    });
    const raw = await response.text();
    let authResult;
    try { authResult = raw ? JSON.parse(raw) : null; } catch { authResult = raw; }
    if (response.status === 401) {
      // Some historical accounts may use the legacy Omega password hash. Try that provider,
      // but report both failures so a missing/stale secret cannot look like a tenant regression.
      try {
        result = await request("POST", "/auth/login", { email, password }, undefined, [200]);
        assert(true, `${label}: authenticated through legacy Omega login (Neon Auth credentials not accepted; identity exchange not tested)`);
      } catch (legacyError) {
        const legacyMessage = legacyError instanceof Error ? legacyError.message : String(legacyError);
        const legacyStatus = legacyMessage.match(/received HTTP (\d+)/)?.[1];
        if (legacyStatus === "401") {
          throw new Error(`${label}: sign-in rejected by both providers (Neon Auth HTTP 401; legacy Omega login HTTP 401). The configured email/password is not valid in either provider, or the account is missing/inactive. Provision and verify two separate development accounts, then update the matching GitHub Actions secrets. No tenant-isolation assertions ran; credentials were not logged.`);
        }
        throw new Error(`${label}: Neon Auth rejected sign-in (HTTP 401), and legacy fallback failed: ${legacyMessage}`);
      }
    } else {
      if (!response.ok) throw new Error(`${label}: Neon Auth sign-in returned HTTP ${response.status}; response=${JSON.stringify(authResult).slice(0, 250)}`);
      // Managed Neon Auth sign-in returns a session response; obtain its short-lived JWT
      // through the JWT plugin endpoint, forwarding only the session cookies.
      const setCookies = typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [response.headers.get("set-cookie")].filter(Boolean);
      const cookieHeader = setCookies.map(value => value.split(";", 1)[0]).filter(Boolean).join("; ");
      if (!cookieHeader) {
        throw new Error(label + ": Neon Auth sign-in succeeded but did not set a session cookie; cannot request a JWT.");
      }
      const tokenResponse = await fetch(neonAuthBase + "/token", {
        method: "GET",
        headers: { origin: trustedOrigin, referer: trustedOrigin + "/login", cookie: cookieHeader },
      });
      const tokenRaw = await tokenResponse.text();
      let tokenResult;
      try { tokenResult = tokenRaw ? JSON.parse(tokenRaw) : null; } catch { tokenResult = tokenRaw; }
      if (!tokenResponse.ok) {
        throw new Error(label + ": Neon Auth JWT endpoint returned HTTP " + tokenResponse.status + "; response=" + JSON.stringify(tokenResult).slice(0, 200));
      }
      const identityToken = tokenResult?.token ?? tokenResult?.data?.token;
      if (typeof identityToken !== "string" || identityToken.split(".").length !== 3) {
        throw new Error(label + ": Neon Auth JWT endpoint did not return a JWT in data.token; no tenant checks were run.");
      }
      const choiceResult = await request("POST", "/auth/neon/companies", { token: identityToken }, undefined, [200, 201]);
      const companies = choiceResult?.companies;
      activeCompanyIds = Array.isArray(companies) ? companies.map(company => company?.id).filter(id => typeof id === "string") : [];
      assert(Array.isArray(companies) && companies.length > 0, `${label}: verified identity receives active company choices before session exchange`);
      const uniqueCompanyIds = new Set(companies.map(company => company?.id).filter(id => typeof id === "string"));
      assert(uniqueCompanyIds.size === companies.length, `${label}: company choices contain no duplicate memberships`);
      if (companies.length > 1) {
        await request("POST", "/auth/neon/exchange", { token: identityToken }, undefined, [401]);
        checks.push(`${label}: exchange without companyId is rejected for a multi-company identity`);
      }
      // Keep the two smoke-test sessions in different tenants even when one identity has multiple memberships.
      const selectedCompany = companies.find(company => company?.id !== avoidCompanyId) || companies[0];
      result = await request("POST", "/auth/neon/exchange", { token: identityToken, companyId: selectedCompany.id }, undefined, [200, 201]);
      assert(result.user?.companyId === selectedCompany.id, `${label}: session exchange honors the explicitly selected company`);
      assert(true, `${label}: authenticated through Neon Auth identity exchange`);
    }
  } else {
    result = await request("POST", "/auth/login", { email, password }, undefined, [200]);
  }
  assert(typeof result.accessToken === "string" && typeof result.refreshToken === "string", `${label}: login returns access and refresh tokens`);
  assert(typeof result.user?.companyId === "string" && result.user.companyId.length > 0, `${label}: login selects an active company`);
  return { accessToken: result.accessToken, refreshToken: result.refreshToken, companyId: result.user.companyId, companyIds: activeCompanyIds.length ? activeCompanyIds : [result.user.companyId] };
}
function rows(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}
async function main() {
  const health = await request("GET", "/health", undefined, undefined, [200]);
  assert(health?.status === "ok" && health?.database === "connected", "configured API and database are healthy");

  const a = await login(emailA, passwordA, "Account A");
  const b = await login(emailB, passwordB, "Account B", a.companyId);
  assert(a.companyId !== b.companyId, "accounts belong to different companies; test is not accidentally same-tenant");

  const meA = await request("GET", "/auth/me", undefined, a.accessToken);
  const meB = await request("GET", "/auth/me", undefined, b.accessToken);
  assert(meA.companyId === a.companyId, "Account A profile matches its token company");
  assert(meB.companyId === b.companyId, "Account B profile matches its token company");

  const ownCompanyA = await request("GET", "/companies/me", undefined, a.accessToken);
  assert(ownCompanyA.id === a.companyId, "Account A company profile matches its selected tenant");
  if (!a.companyIds.includes(b.companyId)) {
    await request("GET", `/companies/${b.companyId}`, undefined, a.accessToken, [403, 404]);
    checks.push("Account A cannot read Account B company profile");
    await request("GET", `/companies/${b.companyId}/branches`, undefined, a.accessToken, [403, 404]);
    checks.push("Account A cannot list Account B branches");
  } else {
    checks.push("Account A has an active membership in Account B company; reverse-direction isolation checks are used instead");
  }
  if (!b.companyIds.includes(a.companyId)) {
    await request("GET", `/companies/${a.companyId}`, undefined, b.accessToken, [403, 404]);
    checks.push("Account B cannot read Account A company profile");
    await request("GET", `/companies/${a.companyId}/branches`, undefined, b.accessToken, [403, 404]);
    checks.push("Account B cannot list Account A branches");
  }

  const forgedContext = await request("GET", `/auth/me?companyId=${encodeURIComponent(b.companyId)}`, undefined, a.accessToken);
  assert(forgedContext.companyId === a.companyId, "client-supplied companyId cannot override Account A token context");

  if (!a.companyIds.includes(b.companyId)) {
    await request("POST", "/auth/switch-company", { companyId: b.companyId }, a.accessToken, [400, 401, 403, 404]);
    checks.push("Account A cannot switch into Account B company without membership");
  } else {
    checks.push("Account A company switch target is an authorized membership; denial assertion correctly skipped");
  }
  if (!b.companyIds.includes(a.companyId)) {
    await request("POST", "/auth/switch-company", { companyId: a.companyId }, b.accessToken, [400, 401, 403, 404]);
    checks.push("Account B cannot switch into Account A company without membership");
  } else {
    checks.push("Account B company switch target is an authorized membership; denial assertion correctly skipped");
  }

  // Read-only resource checks. No customer, invoice, product, or other business record is created.
  const resources = [
    { path: "/customers", detail: id => `/customers/${id}`, label: "customers" },
    { path: "/products", detail: id => `/products/${id}`, label: "products" },
    { path: "/suppliers", detail: id => `/suppliers/${id}`, label: "suppliers" },
    { path: "/invoices", detail: id => `/invoices/${id}`, label: "invoices" },
    { path: "/contracts", detail: id => `/contracts/${id}`, label: "contracts" },
    { path: "/requisitions", detail: id => `/requisitions/${id}`, label: "requisitions" },
    { path: "/purchase-orders", detail: id => `/purchase-orders/${id}`, label: "purchase orders" },
    { path: "/supplier-bills", detail: id => `/supplier-bills/${id}`, label: "supplier bills" },
    { path: "/credit-notes", detail: id => `/credit-notes/${id}`, label: "credit notes" },
    { path: "/sales-orders", detail: id => `/sales-orders/${id}`, label: "sales orders" },
    { path: "/pos/sales", detail: null, label: "POS sales" },
    { path: "/inventory/stock", detail: null, label: "inventory stock" },
    { path: "/crm/leads", detail: id => `/crm/leads/${id}`, label: "CRM leads" },
    { path: "/crm/customers", detail: null, label: "CRM customer lookup" },
    { path: "/crm/campaigns?limit=50&offset=0", detail: null, label: "CRM campaigns" },
    { path: "/crm/segments", detail: null, label: "CRM segments" },
    { path: "/crm/tickets?limit=50&offset=0", detail: null, label: "CRM support tickets" },
    { path: "/crm/opportunities", detail: id => `/crm/opportunities/${id}`, label: "CRM opportunities" },
    { path: "/crm/activities", detail: null, label: "CRM activities" },
    { path: "/payroll/runs", detail: id => `/payroll/runs/${id}`, label: "payroll runs" },
    { path: "/employees", detail: id => `/employees/${id}`, label: "employees" },
    { path: "/notifications", detail: null, label: "notifications" },
    { path: "/audit-logs", detail: null, label: "audit logs" },
    { path: "/accounting/journals", detail: id => `/accounting/journals/${id}`, label: "accounting journals" },
  ];
  const failures = [];
  for (const resource of resources) {
    try {
      const [responseA, responseB] = await Promise.all([
        request("GET", resource.path, undefined, a.accessToken, [200, 403]),
        request("GET", resource.path, undefined, b.accessToken, [200, 403]),
      ]);
      if (responseA?.statusCode === 403 || responseB?.statusCode === 403) {
        checks.push(`${resource.label}: access denied by role/module policy for at least one account; cross-tenant list comparison skipped`);
        continue;
      }
      const listA = rows(responseA);
      const listB = rows(responseB);
      const idsA = new Set(listA.map(row => row?.id).filter(id => typeof id === "string"));
      const overlap = listB.filter(row => typeof row?.id === "string" && idsA.has(row.id));
      assert(overlap.length === 0, `${resource.label}: list results contain no shared record IDs across companies`);
      const foreignRecord = listA.find(row => typeof row?.id === "string");
      if (foreignRecord && resource.detail) {
        await request("GET", resource.detail(foreignRecord.id), undefined, b.accessToken, [403, 404]);
        checks.push(`${resource.label}: Account B cannot fetch Account A record ${foreignRecord.id}`);
      } else if (!foreignRecord) {
        checks.push(`${resource.label}: Account A has no records; direct foreign-record lookup not applicable`);
      } else {
        checks.push(`${resource.label}: cross-company list IDs checked; no detail route configured for direct-IDOR probe`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${resource.label}: ${message}`);
      checks.push(`${resource.label}: CHECK FAILED — ${message}`);
    }
  }

  const refreshed = await request("POST", "/auth/refresh", { refreshToken: a.refreshToken }, undefined, [200, 201]);
  assert(typeof refreshed.accessToken === "string" && typeof refreshed.refreshToken === "string", "refresh issues a new token pair");
  const meAfterRefresh = await request("GET", "/auth/me", undefined, refreshed.accessToken);
  assert(meAfterRefresh.companyId === a.companyId, "refresh preserves Account A selected company");
  await request("GET", "/auth/me", undefined, undefined, [401, 403]);
  checks.push("protected profile endpoint rejects unauthenticated requests");

  console.log(JSON.stringify({ result: failures.length ? "FAIL" : "PASS", mode: "read-only", api: base, checks, failures }, null, 2));
  if (failures.length) throw new Error(`Read-only tenant smoke found ${failures.length} endpoint/resource failure(s).`);
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
