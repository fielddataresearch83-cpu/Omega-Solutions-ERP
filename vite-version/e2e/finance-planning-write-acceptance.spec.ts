import { test, expect } from "@playwright/test";

const email = process.env.E2E_ACCEPTANCE_EMAIL;
const password = process.env.E2E_ACCEPTANCE_PASSWORD;
const companyName = process.env.E2E_COMPANY_NAME;

// This is the only mutating Preview acceptance test. It writes two clearly
// labelled records to the isolated Preview company and never approves a budget.
test("creates and reads back a test cost centre and monthly budget", async ({ page }) => {
  test.skip(!email || !password, "Dedicated non-production E2E credentials are required.");

  const timestamp = Date.now();
  const code = `E2E-${timestamp}`;
  const name = `E2E Test Cost Centre ${timestamp}`;
  const amount = "12345.67";

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

  // Create the cost centre through the application UI and authenticated API.
  await page.locator('input[maxlength="40"]').fill(code);
  await page.locator('input[maxlength="160"]').fill(name);
  await page.locator('input[maxlength="1000"]').fill("Automated Preview acceptance test record; safe to remove after verification.");
  const centreResponsePromise = page.waitForResponse(response =>
    response.url().includes("/accounting/cost-centres") &&
    response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create cost centre" }).click();
  const centreResponse = await centreResponsePromise;
  expect(centreResponse.status(), "Cost centre creation response").toBe(201);
  await expect(page.getByRole("row").filter({ hasText: code })).toBeVisible();

  // Select a valid active expense account and the test cost centre.
  const selects = page.locator("select");
  const accountSelect = selects.nth(1);
  const accountOptions = await accountSelect.locator("option").evaluateAll(options =>
    options.map(option => ({ label: (option as HTMLOptionElement).textContent?.trim() ?? "", value: (option as HTMLOptionElement).value })),
  );
  const expenseAccount = accountOptions.find(option => option.value && option.label.includes("(expense)"));
  expect(expenseAccount, "An active expense account must be available").toBeTruthy();
  await accountSelect.selectOption(expenseAccount!.value);
  const centreSelect = selects.nth(2);
  const centreOptions = await centreSelect.locator("option").evaluateAll(options =>
    options.map(option => ({ label: (option as HTMLOptionElement).textContent?.trim() ?? "", value: (option as HTMLOptionElement).value })),
  );
  const testCentreOption = centreOptions.find(option => option.label.startsWith(code));
  expect(testCentreOption, "The newly created cost centre must be selectable").toBeTruthy();
  await centreSelect.selectOption(testCentreOption!.value);

  await page.locator('input[type="number"][min="0"][step="0.01"]').fill(amount);
  const budgetResponsePromise = page.waitForResponse(response =>
    response.url().includes("/accounting/budgets") &&
    response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Add budget" }).click();
  const budgetResponse = await budgetResponsePromise;
  expect(budgetResponse.status(), "Monthly budget creation response").toBe(201);

  const budgetRow = page.getByRole("row").filter({ hasText: code });
  await expect(budgetRow).toBeVisible();
  await expect(budgetRow).toContainText("draft");
  await expect(page.getByRole("alert")).toHaveCount(0);

  const createdBudget = await budgetResponse.json();
  expect(createdBudget).toBeTruthy();
  expect(createdBudget.id).toBeTruthy();

  console.log(JSON.stringify({
    result: "PASS",
    costCentreCode: code,
    costCentreName: name,
    budgetId: createdBudget.id,
    budgetAmountKES: amount,
    period: "current month",
    status: "draft",
    company: companyName || "The Shire",
    note: "Records intentionally remain in the isolated Preview database for inspection; no approval or ledger posting was performed.",
  }));
});
