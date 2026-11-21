import { UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const GITHUB_ACTIONS_ISSUER = 'https://token.actions.githubusercontent.com';
const GITHUB_ACTIONS_AUDIENCE = 'omega-erp-reminders';
const EXPECTED_REPOSITORY = 'fielddataresearch83-cpu/Omega-Solutions-ERP';
const EXPECTED_REF = 'refs/heads/development';

const githubActionsJwks = createRemoteJWKSet(
  new URL('https://token.actions.githubusercontent.com/.well-known/jwks'),
);

const allowedWorkflowRefs: Record<string, string> = {
  'crm-activity-reminders.yml':
    `${EXPECTED_REPOSITORY}/.github/workflows/crm-activity-reminders.yml@${EXPECTED_REF}`,
  'project-event-reminders.yml':
    `${EXPECTED_REPOSITORY}/.github/workflows/project-event-reminders.yml@${EXPECTED_REF}`,
};

/**
 * Authenticate scheduled reminder dispatches using GitHub's short-lived OIDC
 * identity token. This avoids synchronizing long-lived cron secrets between
 * GitHub Actions and Vercel.
 */
export async function verifyGitHubActionsReminderRequest(
  authorizationHeader: string | undefined,
  workflowFile: keyof typeof allowedWorkflowRefs,
): Promise<void> {
  const match = authorizationHeader?.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) {
    throw new UnauthorizedException('A GitHub Actions identity token is required.');
  }

  try {
    const { payload } = await jwtVerify(match[1], githubActionsJwks, {
      issuer: GITHUB_ACTIONS_ISSUER,
      audience: GITHUB_ACTIONS_AUDIENCE,
      maxTokenAge: '5 minutes',
    });

    if (
      payload.repository !== EXPECTED_REPOSITORY ||
      payload.ref !== EXPECTED_REF ||
      payload.workflow_ref !== allowedWorkflowRefs[workflowFile] ||
      !['schedule', 'workflow_dispatch'].includes(String(payload.event_name))
    ) {
      throw new UnauthorizedException('The GitHub Actions workflow identity is not authorized.');
    }
  } catch {
    throw new UnauthorizedException('The GitHub Actions identity token is invalid or expired.');
  }
}
