import { neonTestLogin } from "./neon-test-auth.mjs";
if (process.env.OMEGA_LIVE_SMOKE_CONFIRM_ISOLATED_TEST_DATABASE !== "YES") {
  throw new Error("Refusing to write business data: explicitly confirm an isolated disposable test database with OMEGA_LIVE_SMOKE_CONFIRM_ISOLATED_TEST_DATABASE=YES.");
}
const configuredBase = process.env.OMEGA_API_URL?.trim();
if (!configuredBase) throw new Error("OMEGA_API_URL is required; refusing to default to a shared or production API.");
const base = configuredBase.replace(/\/$/, "");
const target = new URL(base);
if (target.protocol !== "https:" || target.pathname.replace(/\/$/, "") !== "/api" || ["omega-solutions-erp-9k9s.vercel.app", "omega-solutions-erp-9k9s-coll5.vercel.app"].includes(target.hostname) || !target.hostname.endsWith("-coll5.vercel.app")) throw new Error("OMEGA_API_URL must be an approved HTTPS development API URL ending in /api.");
const stamp = Date.now();
// Authenticated live regression for HRM, expenses, accounting, and CRM.
const checks = [];
async function req(method, path, body, token, expected = [200, 201]) {
  const response = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!expected.includes(response.status)) throw Error(`${method} ${path}: expected ${expected}, got ${response.status}: ${JSON.stringify(data).slice(0, 350)}`);
  return { status: response.status, data };
}
function ok(value, message) { if (!value) throw Error(message); checks.push(message); }
try {
  let health;
  let lastError;
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      health = await req("GET", "/health");
      if (health.data?.status === "ok" && health.data?.database === "connected") break;
      health = null;
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  if (!health) throw Error(`API health/database did not recover: ${String(lastError || "unexpected health response")}`);
  ok(health.data.status === "ok" && health.data.database === "connected", "health and database connection");
  const login = await neonTestLogin(base, { slot: "A", companyName: `Omega HRM E2E ${stamp}` });
  const token = login.token;
  ok(!!token && !!login.refreshToken, "verified Neon Auth identity exchanged for Omega tokens");
  const identity = (await req("GET", "/auth/me", undefined, token)).data;
  ok(identity.userId === login.user.userId && identity.companyId === login.user.companyId, "authenticated tenant identity");

  const employee = (await req("POST", "/employees", {
    employeeNumber: `E2E-${stamp}`, firstName: "Test", lastName: "Employee",
    workEmail: `employee-${stamp}@example.com`, jobTitle: "QA Test", department: "Validation",
    hireDate: new Date().toISOString().slice(0, 10),
  }, token, [201])).data;
  ok(!!employee.id && employee.company_id === identity.companyId, "create company-scoped employee");
  const employeeList = (await req("GET", "/employees", undefined, token)).data;
  ok(Array.isArray(employeeList) && employeeList.some(row => row.id === employee.id), "employee appears in company list");

  const startDate = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const endDate = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);
  const leave = (await req("POST", "/employees/leave-requests", {
    employeeId: employee.id, leaveType: "annual", startDate, endDate, reason: "Automated approval workflow validation",
  }, token, [201])).data;
  ok(!!leave.id && leave.status === "pending", "create pending leave request");
  const approved = (await req("PATCH", `/employees/leave-requests/${leave.id}/review`, {
    status: "approved", reviewNote: "Automated test approval",
  }, token, [200])).data;
  ok(approved.status === "approved", "approve leave request");
  await req("POST", "/employees/leave-requests", {
    employeeId: employee.id, leaveType: "annual", startDate, endDate, reason: "Must conflict with approved leave",
  }, token, [409]);
  ok(true, "overlapping leave request rejected");

  const expense = (await req("POST", "/expenses", {
    description: `E2E expense ${stamp}`, category: "testing", amount: 123.45,
    paymentMethod: "mpesa", expenseDate: new Date().toISOString().slice(0, 10),
    reference: `E2E-EXP-${stamp}`,
  }, token, [201])).data;
  ok(!!expense.id && Number(expense.amount) === 123.45 && !!expense.journal_entry_id, "create expense and link journal entry");
  const expenses = (await req("GET", "/expenses", undefined, token)).data;
  ok(Array.isArray(expenses) && expenses.some(row => row.id === expense.id), "expense appears in company expense list");
  const journals = (await req("GET", "/accounting/journals", undefined, token)).data;
  const journal = journals.find(row => row.id === expense.journal_entry_id && row.source_type === "expense");
  ok(!!journal && Number(journal.total_debits) === 123.45 && Number(journal.total_credits) === 123.45, "expense posts a balanced journal entry");

  const lead = (await req("POST", "/crm/leads", {
    contactName: `E2E CRM Contact ${stamp}`, organizationName: `E2E CRM Org ${stamp}`,
    email: `crm-contact-${stamp}@example.com`, source: "automated_test", estimatedValue: 50000, currency: "KES",
  }, token, [201])).data;
  ok(!!lead.id && lead.company_id === identity.companyId, "create company-scoped CRM lead");
  const qualifiedLead = (await req("PATCH", `/crm/leads/${lead.id}`, { status: "qualified" }, token, [200])).data;
  ok(qualifiedLead.status === "qualified", "qualify CRM lead");
  const opportunity = (await req("POST", "/crm/opportunities", {
    title: `E2E Opportunity ${stamp}`, leadId: lead.id, expectedValue: 50000, probability: 60, stage: "qualification",
  }, token, [201])).data;
  ok(!!opportunity.id && opportunity.lead_id === lead.id, "create lead-linked sales opportunity");
  const progressedOpportunity = (await req("PATCH", `/crm/opportunities/${opportunity.id}`, { stage: "proposal" }, token, [200])).data;
  ok(progressedOpportunity.stage === "proposal", "move opportunity through pipeline");
  const activity = (await req("POST", "/crm/activities", {
    activityType: "task", subject: `Follow up ${stamp}`, leadId: lead.id, opportunityId: opportunity.id,
  }, token, [201])).data;
  ok(!!activity.id, "create linked CRM activity");
  const completedActivity = (await req("PATCH", `/crm/activities/${activity.id}`, { completed: true }, token, [200])).data;
  ok(!!completedActivity.completed_at, "complete CRM activity");
  const ticket = (await req("POST", "/crm/tickets", {
    leadId: lead.id, subject: `E2E support ticket ${stamp}`, priority: "high", description: "Automated CRM workflow validation",
  }, token, [201])).data;
  ok(!!ticket.id && ticket.priority === "high", "create lead-linked support ticket");
  const updatedTicket = (await req("PATCH", `/crm/tickets/${ticket.id}`, { status: "in_progress" }, token, [200])).data;
  ok(updatedTicket.status === "in_progress", "update support ticket status");
  const campaign = (await req("POST", "/crm/campaigns", {
    name: `E2E Campaign ${stamp}`, campaignType: "email", status: "active", budget: 500, targetLeads: 1,
  }, token, [201])).data;
  ok(!!campaign.id, "create CRM campaign");
  await req("POST", `/crm/campaigns/${campaign.id}/leads`, { leadId: lead.id, responseStatus: "targeted" }, token, [201]);
  const audience = (await req("GET", `/crm/campaigns/${campaign.id}/leads`, undefined, token)).data;
  ok(Array.isArray(audience) && audience.some(row => row.lead_id === lead.id), "add lead to campaign audience");
  const segment = (await req("POST", "/crm/segments", {
    name: `E2E Segment ${stamp}`, description: "Temporary authenticated integration test segment", isDynamic: false,
  }, token, [201])).data;
  ok(!!segment.id, "create CRM audience segment");
  await req("POST", `/crm/segments/${segment.id}/members`, { leadId: lead.id }, token, [201]);
  await req("POST", `/crm/campaigns/${campaign.id}/segments`, { segmentId: segment.id }, token, [201]);
  const pipeline = (await req("GET", "/crm/pipeline", undefined, token)).data;
  ok(Array.isArray(pipeline.leads) && pipeline.leads.some(row => row.status === "qualified"), "CRM pipeline summary includes qualified leads");
  const crmLeads = (await req("GET", `/crm/leads?search=${encodeURIComponent(String(stamp))}`, undefined, token)).data;
  ok(Array.isArray(crmLeads) && crmLeads.some(row => row.id === lead.id), "search CRM leads within current tenant");

  const trialBalance = (await req("GET", "/accounting/reports/trial-balance", undefined, token)).data;
  ok(trialBalance.balanced === true && Math.abs(Number(trialBalance.variance)) <= 0.01, "trial balance debit/credit totals reconcile");
  ok(Math.abs(Number(trialBalance.totalDebits) - Number(trialBalance.totalCredits)) <= 0.01, "trial balance total debits equal total credits");
  console.log(JSON.stringify({
    ok: true, email: login.email, companyId: identity.companyId, employeeId: employee.id,
    leaveRequestId: leave.id, expenseId: expense.id, journalEntryId: expense.journal_entry_id,
    trialBalance: { totalDebits: trialBalance.totalDebits, totalCredits: trialBalance.totalCredits, variance: trialBalance.variance },
    checks,
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: String(error), checks }, null, 2));
  process.exitCode = 1;
}
