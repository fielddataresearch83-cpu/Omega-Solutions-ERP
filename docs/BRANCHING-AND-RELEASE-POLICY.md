# Omega Solutions ERP — Branching and Release Policy

## Branches

- `development` is the sole day-to-day working branch. Feature work, fixes, integration, and development testing happen here.
- `main` is the production release branch. Create it only when a release candidate is ready and after Vercel's Production Branch has been changed from `development` to `main` in both existing projects.
- Do not create additional feature or working branches unless explicitly approved.
- Do not force-push, rewrite history, reset shared branches, or discard existing work.

## Vercel

- Keep the existing frontend project `omega-solutions-erp` and API project `omega-solutions-erp-9k9s`; do not create replacement projects.
- `development` must produce Preview deployments only.
- `main` is the only Production deployment branch.
- Before any push, verify the Production Branch setting on both projects. If either project still treats `development` as Production, do not push.
- Production releases require explicit approval. Do not promote, deploy to Production, or change production domains without approval.

## Databases and migrations

- Development and test work must use the designated development Neon database/branch and development-only secrets.
- Never use the production database for development, tests, or migration rehearsals.
- Migrations are manual: prepare, review, and test on an isolated disposable Neon branch first.
- Production migrations require a separately reviewed plan, verified backup/recovery path, and explicit user approval. Never run migrations automatically as part of a deployment.

## Release sequence

1. Complete and test changes on `development`.
2. Validate builds, unit tests, tenant/RLS isolation, and relevant end-to-end flows.
3. Verify both Vercel projects use `main` as Production Branch and `development` as Preview.
4. Create `main` from the approved, tested `development` commit.
5. Review and approve any production migration plan separately; execute migrations manually only after approval.
6. Release from `main` only with explicit approval, then verify application health.

## Current safety hold

Until both Vercel Production Branch settings are verified as `main`, do not push commits from the current `development` branch. Continue local/cloud-workspace development and testing only.

**Status 2026-11-21:** this hold is superseded for audit work by explicit owner authorization to keep committing to the existing `development` branch (single-branch workflow, no new branches). The Vercel Production Branch setting itself is still unverified — see the runtime-configuration section below.

## Required branch-protection settings for `development`

**Current state (last successful read 2026-11-21 via the GitHub branches API: `protected: false`).** No rule is enforced; any actor with push access can push directly and a red CI run does not block a merge. This is a repository-governance change, not a code change, and has not been applied.

**How to enforce it, and why it is still open:**

- The only supported routes are the repository's Settings → Branches UI or `gh api -X PUT .../branches/development/protection`, both of which require an authenticated actor with **admin** permission on the repository. The Freebuff connection is deliberately not authenticated for administration.
- In this environment `gh auth status` reports no logged-in host, and unauthenticated REST calls to the branches/protection endpoint return **HTTP 403 (rate limit)** from the shared egress address. The block is authentication, not a missing command.
- Do **not** attempt to work around it: no personal access token in a file, no `GITHUB_TOKEN` injection into the workspace, no ruleset created through an unofficial endpoint.
- Owner action: a repository admin runs the API call below (or applies the table's settings in the UI) and then re-reads `GET .../branches/development/protection` to confirm `enforce_admins.enabled=true` and `required_status_checks.contexts` contains `validate`. The audit will verify the result only from that authenticated read.
- Verify the check context **before** requiring it, because a required context that never reports blocks every merge: open one pull request, confirm a check named `validate` appears (job name in `development-validation.yml`), then enable protection.

The exact rule to create — GitHub → Settings → Branches → Add branch protection rule, branch name pattern `development`:

| Setting | Required value | Reason |
|---|---|---|
| Require a pull request before merging | **On** | Prevents direct pushes to the integration branch |
| Required approvals | **1** | At least one human review before merge |
| Dismiss stale pull request approvals when new commits are pushed | **On** | Approval must apply to the commit being merged |
| Require review from Code Owners | Off (no `CODEOWNERS` file exists) | Would otherwise be unenforceable |
| Require approval of the most recent reviewable push | **On** | Stops the author self-approving their own final push |
| Require status checks to pass before merging | **On** | Makes CI a real gate |
| Require branches to be up to date before merging | **On** (strict) | Prevents merging a commit never tested against the current tip |
| Required status check | **`validate`** (workflow `Development validation`) | It carries migrations, both RLS suites, both repair rehearsals, and API/frontend build+lint. The job name is the check context; confirm the exact context string in the branch-protection UI after the first PR |
| Require conversation resolution before merging | **On** | Prevents merging with open review threads |
| Require signed commits | Off (documented decision, no key distribution yet) | Would block every current contributor |
| Require linear history | **On** | Merge commits complicate release bisection |
| Require deployments to succeed | Off (no deployment gate exists) | Nothing to bind to |
| Lock branch | Off | Development must stay writable |
| Do not allow bypassing the above settings | **On** (include administrators) | Otherwise an admin push silently skips every rule |
| Restrict who can push to matching branches | **On** — the maintainers who need it | Least privilege on the integration branch |
| Allow force pushes | Off | History on a shared branch must be append-only |
| Allow deletions | Off | Prevents accidental branch deletion |

Equivalent API call (documented for an authorized repository admin; **not executed** from this audit):

```bash
gh api -X PUT repos/fielddataresearch83-cpu/Omega-Solutions-ERP/branches/development/protection \
  -H 'Accept: application/vnd.github+json' \
  -F 'required_status_checks[strict]=true' \
  -F 'required_status_checks[contexts][]=validate' \
  -F 'enforce_admins=true' \
  -F 'required_pull_request_reviews[required_approving_review_count]=1' \
  -F 'required_pull_request_reviews[dismiss_stale_reviews]=true' \
  -F 'required_pull_request_reviews[require_last_push_approval]=true' \
  -F 'restrictions[users][]=<maintainer-login>' \
  -F 'required_linear_history=true' \
  -F 'allow_force_pushes=false' \
  -F 'allow_deletions=false' \
  -F 'required_conversation_resolution=true'
```

Order of operations: confirm the check context name from a real pull request first (`validate`), because a required check that never reports blocks every merge permanently.

## Runtime configuration verification (API service)

`vercel.json` at the repository root declares four Vercel services — `api` (NestJS), `vite-version`, `docs` (VitePress) and `nextjs-version` — with `/api/(.*)` rewritten to the `api` service. The backend therefore runs as a Vercel service; earlier documents describing a Render-hosted API are historical.

To confirm the API's database role without exposing secrets (owner action, read-only):

1. Vercel dashboard → the API project → Settings → Environment Variables → inspect **Development/Preview** only. Record the **role name** in `DATABASE_URL` (expected `omega_app_dev`); never copy the value or password into a ticket, doc, or chat. There is no Vercel token or CLI in the audit workspace, so this cannot be read from code.
2. Confirm the host is the designated development Neon branch, not production.
3. Run the read-only inspection against that same database and read the `IDENTITY` block: `current_user` must equal the configured role and `rolbypassrls` must be `false`.
4. Read the `public tables owned by current_user` line. If `rolbypassrls` is `true` **or that count is greater than 0**, stop: the 110 policies are inert for that identity. Create/point to a `NOBYPASSRLS` role that owns no table and rehearse on a disposable clone before changing any environment variable.
