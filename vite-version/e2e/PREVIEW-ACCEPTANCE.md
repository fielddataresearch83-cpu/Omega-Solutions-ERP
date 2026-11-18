# Preview acceptance test

This is a read-only Playwright smoke test for the deployed Omega ERP Preview.
It signs in with a dedicated non-production acceptance account, chooses the
configured company (or the first available company), and visits the main ERP
modules. It does not create, update, or delete business records.

## GitHub Actions configuration

Add these repository Actions secrets:

- `E2E_BASE_URL`: the stable HTTPS URL of the **Preview** frontend deployment.
- `E2E_ACCEPTANCE_EMAIL`: a dedicated non-production user with read access to
  the modules under test.
- `E2E_ACCEPTANCE_PASSWORD`: that user's password.

Optional repository Actions variable:

- `E2E_COMPANY_NAME`: company name to select when the account has multiple
  companies. If omitted, the first company offered to the account is selected.

Do not use Production credentials, Production URLs, or Production databases.
The workflow runs manually or daily at 09:00 East Africa Time. It does not
run on pushes, deploy anything, or run migrations; this avoids triggering a
Vercel deployment merely to execute acceptance tests.

## Local execution

From `vite-version`, set the same environment variables in your local shell and
run `npm ci`, `npx playwright install chromium`, then
`npm run test:e2e:acceptance`.
