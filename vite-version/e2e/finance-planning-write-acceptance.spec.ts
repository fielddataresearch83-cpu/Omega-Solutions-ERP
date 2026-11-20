import { test, expect } from "@playwright/test";

const email = process.env.E2E_ACCEPTANCE_EMAIL;
const password = process.env.E2E_ACCEPTANCE_PASSWORD;
const companyName = process.env.E2E_COMPANY_NAME;

// The preceding live run created the labelled test cost centre and draft budget.
// This idempotent follow-up verifies the saved records without creating duplicates.
test("verifies the saved Preview cost centre and monthly budget", async ({ page }) => {
  test.skip(!email || !password, "Dedicated non-production E2E credentials are required.");

  const code = "E2E-1795182216662";
  const pageErrors: string[] = [];
  const accountingWrites: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("request", request => {
    const url = request.url();
    if (url.includes("/accounting/") && !["GET", "OPTIONS"].includes(request.method())) {
      accountingWrites.push(`${request.method()} ${url}`);
    }
  });

  await page.goto("/login");
  await page.getByLabel(/email address/i).fill(email!);
  await page.getByRole("textbox", { name: "Password" }).fill(password!);
  await page.getByRole("button", { name: /sign in to omega/i }).click();

  const companyHeading = page.getByRole("heading", { name: /choose your company/i });
  const needsCompany = await companyHeading.waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true).catch(() => false);
  if (needsCompany) {
    const targetCompany = companyName || "The Shire";
    await page.getByRole("main").getByRole("button", {
      name: new RegExp(targetCompany, "i"),
    }).click();
    await expect(companyHeading).toBeHidden({ timeout: 20_000 });
  }

  await expect(page).toHaveURL(/\/(dashboard|sales-dashboard)(\?|$)/, { timeout: 45_000 });
  await page.goto("/finance-planning", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Create cost centre" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create monthly budget" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);

  const costCentreTable = page.getByRole("table").nth(0);
  const costCentreRow = costCentreTable.getByRole("row").filter({ hasText: code });
  await expect(costCentreRow).toBeVisible();
  await expect(costCentreRow).toContainText("Active");

  const budgetTable = page.getByRole("table").nth(1);
  const budgetRow = budgetTable.getByRole("row").filter({ hasText: code });
  await expect(budgetRow).toBeVisible();
  await expect(budgetRow).toContainText("draft");
  await expect(budgetRow).toContainText("Ksh 12,346");

  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(pageErrors, `Browser JavaScript errors:\n${pageErrors.join("\n")}`).toEqual([]);
  expect(accountingWrites, `Unexpected accounting writes:\n${accountingWrites.join("\n")}`).toEqual([]);

  console.log(JSON.stringify({
    result: "PASS",
    company: companyName || "The Shire",
    costCentreCode: code,
    budgetAmountKES: "12345.67",
    budgetPeriod: "November 2026",
    budgetStatus: "draft",
    writesDuringVerification: 0,
    note: "Cost centre and budget were created through the authenticated Preview UI in the earlier write run; this verification made no changes.",
  }));
});
