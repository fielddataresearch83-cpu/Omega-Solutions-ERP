import { test, expect } from "@playwright/test";

const email = process.env.E2E_ACCEPTANCE_EMAIL;
const password = process.env.E2E_ACCEPTANCE_PASSWORD;
const companyName = process.env.E2E_COMPANY_NAME;

// This one-off Preview-only test creates exactly one disposable test cost centre
// and one draft budget through the authenticated UI. It never approves budgets.
test("creates and verifies a Preview cost centre and draft budget", async ({ page }) => {
  test.skip(!email || !password, "Requires the dedicated non-production acceptance account.");

  await page.goto("/login");
  await page.getByLabel(/email address/i).fill(email!);
  await page.getByRole("textbox", { name: "Password" }).fill(password!);
  await page.getByRole("button", { name: /sign in to omega/i }).click();

  const companyHeading = page.getByRole("heading", { name: /choose your company/i });
  const companySelectionRequired = await companyHeading
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (companySelectionRequired) {
    const choice = page.getByRole("main").getByRole("button", {
      name: new RegExp(companyName || "The Shire", "i"),
    });
    await expect(choice).toBeVisible();
    await choice.click();
    await expect(companyHeading).toBeHidden({ timeout: 20_000 });
  }

  await expect(page).toHaveURL(/\/(dashboard|sales-dashboard)(\?|$)/, { timeout: 45_000 });
  await page.goto("/finance-planning", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Create cost centre" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create monthly budget" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);

  const suffix = Date.now().toString();
  const code = `QA-${suffix}`;
  const name = `Preview acceptance ${suffix}`;

  const codeInput = page.locator("input").nth(0);
  const nameInput = page.locator("input").nth(1);
  const descriptionInput = page.locator("input").nth(2);
  await codeInput.fill(code);
  await nameInput.fill(name);
  await descriptionInput.fill("Automated Preview acceptance test data only; not a live business cost centre.");

  const createCentreResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    new URL(response.url()).pathname.endsWith("/accounting/cost-centres"),
  );
  await page.getByRole("button", { name: "Create cost centre" }).click();
  const centreResponse = await createCentreResponse;
  expect(centreResponse.status(), "Cost centre creation API response").toBeLessThan(300);
  await expect(page.getByText(code, { exact: true })).toBeVisible();

  const accountSelect = page.getByLabel("Account");
  await expect(accountSelect).not.toHaveValue("");
  const costCentreSelect = page.getByLabel("Cost centre (optional)");
  await costCentreSelect.selectOption({ label: new RegExp(`${code}.*${name}`) } as never);
  await page.getByLabel("Budget amount (KES)").fill("123.45");

  const createBudgetResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    new URL(response.url()).pathname.endsWith("/accounting/budgets"),
  );
  await page.getByRole("button", { name: "Add budget" }).click();
  const budgetResponse = await createBudgetResponse;
  expect(budgetResponse.status(), "Draft budget creation API response").toBeLessThan(300);

  const budgetRow = page.getByRole("row").filter({ hasText: code });
  await expect(budgetRow).toBeVisible();
  await expect(budgetRow).toContainText("Draft");
  await expect(budgetRow).toContainText("123.45");
  await expect(page.getByRole("alert")).toHaveCount(0);

  console.log(`Created Preview-only cost centre ${code} and draft budget KES 123.45. Budget left unapproved.`);
});
