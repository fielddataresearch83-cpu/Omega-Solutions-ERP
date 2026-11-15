# Project Management calendar reminders — development

Calendar reminders are delivered as company-scoped in-app notifications. The dispatcher checks every 15 minutes for non-cancelled events starting within the next 24 hours. A delivery ledger prevents duplicate notifications for the same event, recipient, and start time.

## Enable the development scheduler

1. The Development database currently records all 82 repository migrations, including 202611120013_project_management.sql and 202611130001_project_event_reminders.sql. Their recorded checksums match the repository files. Production has not been migrated.
2. Configure PROJECT_EVENT_REMINDER_CRON_SECRET in the Vercel API Preview environment used by the selected development API deployment. Use a randomly generated value of at least 32 characters, and redeploy the API after saving it.
3. In GitHub repository Settings → Secrets and variables → Actions, add:
   - Repository variable OMEGA_DEVELOPMENT_API_URL, set to the exact development API base URL ending in /api
   - Repository secret PROJECT_EVENT_REMINDER_CRON_SECRET, set to the same value configured in Vercel
4. The workflow .github/workflows/project-event-reminders.yml runs every 15 minutes and can also be run manually from GitHub Actions. It refuses the known Production API hostname and sends the secret only in the x-cron-secret request header.
5. Check the workflow run output for the delivered count. Zero is normal when no event is within its reminder window.

The recipient list includes the event creator and any listed attendee whose email matches an active user with an active membership in the same company. External attendees are retained on the event but do not receive Omega notifications. No email or SMS is sent. Editing the event start time creates a new reminder opportunity; cancellation or disabling the reminder prevents delivery.

Do not configure this workflow with a Production API URL or Production database credentials. Do not use Render. The migrations remain a separate, manually reviewed database operation. The project-management and reminder migrations have been exercised on a disposable Neon branch; this does not mean they have been applied to shared Development.
