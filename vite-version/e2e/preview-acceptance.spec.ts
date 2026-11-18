import { test, expect } from "@playwright/test";

const email = process.env.E2E_ACCEPTANCE_EMAIL;
const password = process.env.E2E_ACCEPTANCE_PASSWORD;
const companyName = process.env.E2E_COMPANY_NAME;

// Read-only smoke coverage: this suite only navigates and reads page content.
// It never creates, edits, submits, or deletes ERP business records.
const modules = [
  { name: "Dashboard", path: "/dashboard" },
  { name: "Inventory / Products", path: "/products" },
  { name: "Stock levels", path: "/stock-levels" },
  { name: "Customers", path: "/customers" },
  { name: "Sales dashboard", path: "/sales-dashboard" },
  { name: "Sales orders", path: "/sales-orders" },
  { name: "Invoices", path: "/invoices" },
  { name: "Quotations", path: "/quotations" },
  { name: "Point of Sale", path: "/pos" },
  { name: "Suppliers", path: "/suppliers" },
  { name: "Purchase orders", path: "/purchase-orders" },
  { name: "Expenses", path: "/expenses" },
  { name: "Accounting", path: "/chart-of-accounts" },
  { name: "Financial reports", path: "/financial-reports" },
  { name: "Employees", path: "/employees" },
  { name: "Payroll", path: "/payroll" },
  { name: "Projects", path: "/projects" },
  { name: "CRM", path: "/crm" },
  { name: "Reports", path: "/reports" },
  { name: "Tasks", path: "/tasks" },
  { name: "Calendar", path: "/calendar" },
  { name: "Salesperson stock", path: "/salesperson-stock" },
  { name: "CRM campaigns", path: "/crm/campaigns" },
  { name: "CRM segments", path: "/crm/segments" },
  { name: "CRM tickets", path: "/crm/tickets" },
  { name: "Credit notes", path: "/credit-notes" },
  { name: "Payments", path: "/payments" },
  { name: "Requisitions", path: "/requisitions" },
  { name: "Contracts", path: "/contracts" },
  { name: "Approvals", path: "/approvals" },
  { name: "Supplier bills", path: "/supplier-bills" },
  { name: "Stocktakes", path: "/stocktakes" },
  { name: "Inventory returns", path: "/inventory-returns" },
  { name: "Warehouses", path: "/warehouses" },
  { name: "Stock movements", path: "/stock-movements" },
  { name: "Manufacturing", path: "/manufacturing" },
  { name: "Bank reconciliation", path: "/bank-reconciliation" },
  { name: "Fixed assets", path: "/fixed-assets" },
  { name: "Finance planning", path: "/finance-planning" },
  { name: "Workforce", path: "/workforce" },
  { name: "Leave management", path: "/leave-management" },
  { name: "Company management", path: "/companies" },
  { name: "Users and roles", path: "/users-roles" },
  { name: "Audit logs", path: "/audit-logs" },
  { name: "Billing settings", path: "/settings/billing" },
  { name: "Module settings", path: "/settings/modules" },
  { name: "Tax settings", path: "/settings/tax" },
  { name: "Settings", path: "/settings" },
];

test.describe("Omega ERP Preview acceptance (read-only)", () => {
  test("login page is available", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.getByLabel(/email address/i)).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Password" })).toBeVisible();
  });

  test("signs in, selects a company, and smoke-tests core modules", async ({ page }) => {
    test.skip(!email || !password, "Authenticated acceptance requires E2E credentials in the test runner environment; Vercel project secrets are not automatically available in this workspace.");

    const pageErrors: string[] = [];
    const serverErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`);
    });

    await page.goto("/login");
    await page.getByLabel(/email address/i).fill(email!);
    await page.getByRole("textbox", { name: "Password" }).fill(password!);
    await page.getByRole("button", { name: /sign in to omega/i }).click();

    // Some accounts have one company and proceed directly; others are asked to choose.
    const companyChooser = page.locator('[aria-label="Choose company"]');
    // isVisible() is an immediate snapshot; wait for the asynchronous post-login
    // company-selection state so slower Preview responses do not race this check.
    const companySelectionRequired = await companyChooser
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (companySelectionRequired) {
      const choice = companyName
        ? companyChooser.getByRole("button", { name: new RegExp(companyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") })
        : companyChooser.getByRole("button").first();
      await expect(choice).toBeVisible();
      await choice.click();
    }

    await expect(page).toHaveURL(/\/(dashboard|sales-dashboard)(\?|$)/, { timeout: 45_000 });

    const results: string[] = [];
    const moduleFailures: string[] = [];
    for (const module of modules) {
      try {
        await page.goto(module.path, { waitUntil: "domcontentloaded" });
        await expect(page.locator("body")).toBeVisible();
        await expect(page.locator("body")).not.toContainText(/application error|unexpected error|something went wrong|404 not found/i);
        await expect(page).toHaveURL(new RegExp(`${module.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[?#].*)?$`), { timeout: 15_000 });
        const bodyText = (await page.locator("body").innerText()).trim();
        expect(bodyText.length, `${module.name} rendered an empty page`).toBeGreaterThan(20);
        results.push(`${module.name}: PASS`);
      } catch (error) {
        const detail = error instanceof Error ? error.message.split("\n")[0] : String(error);
        results.push(`${module.name}: FAIL (${detail})`);
        moduleFailures.push(`${module.name}: ${detail}`);
      }
    }
    console.log("\nPreview module acceptance results:\n" + results.join("\n"));
    expect(moduleFailures, `Module failures:\n${moduleFailures.join("\n")}`).toEqual([]);

    expect(pageErrors, `Browser JavaScript errors:\n${pageErrors.join("\n")}`).toEqual([]);
    expect(serverErrors, `API/server 5xx responses:\n${serverErrors.join("\n")}`).toEqual([]);
  });
});
