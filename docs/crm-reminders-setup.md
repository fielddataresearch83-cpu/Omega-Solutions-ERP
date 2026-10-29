# CRM activity reminder scheduler

The development API generates in-app notifications for incomplete CRM activities assigned to active company members when they are due within 24 hours or overdue. Dispatch is idempotent per activity, reminder type, and due-date value.

## One-time development setup

1. Generate a random secret of at least 32 characters (PowerShell example):
   `[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))`
2. Add `CRM_REMINDER_CRON_SECRET` to the Render environment for **omega-solutions-api-development**, using that secret. Do not set this on production.
3. Add a GitHub Actions repository secret named `CRM_REMINDER_CRON_SECRET` with the exact same value.
4. Redeploy only the development API so the new environment variable is loaded.
5. In GitHub Actions, manually run **CRM activity reminders** once. A successful HTTP response confirms the endpoint is reachable; it does not require or create sample business data.
6. Confirm a real, incomplete CRM activity assigned to an active company member appears in that member's in-app notifications when it is due within 24 hours or overdue. Do not create test business records in the shared development database solely for this check.

The workflow then calls the development API every 15 minutes. If the GitHub secret is absent, it explicitly skips dispatch. If the API secret is absent or too short, the API returns service unavailable. The endpoint uses a constant-time secret comparison and is separate from normal user-authenticated CRM routes.

## Behavior and limits

- Notifications are in-app only; this does not send email or SMS.
- Completed activities and activities without a due date are ignored.
- Only active users with an active membership in the activity's company are recipients.
- Delivery is recorded in `crm_activity_reminder_deliveries`; repeat scheduler runs do not duplicate the same reminder.
- A due-soon reminder is emitted once per due-date value, and an overdue reminder is emitted once per due-date value.
- The CRM API continues to deny branch-bound memberships until CRM records have explicit branch attribution and all related queries enforce it. Do not remove that guard as a workaround.
