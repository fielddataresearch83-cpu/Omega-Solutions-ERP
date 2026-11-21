import { UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jwtVerify } from 'jose';
import { verifyGitHubActionsReminderRequest } from './github-actions-reminder-auth.js';

vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => ({ testKeySet: true })),
  jwtVerify: vi.fn(),
}));

const validClaims = {
  repository: 'fielddataresearch83-cpu/Omega-Solutions-ERP',
  ref: 'refs/heads/development',
  workflow_ref:
    'fielddataresearch83-cpu/Omega-Solutions-ERP/.github/workflows/crm-activity-reminders.yml@refs/heads/development',
  event_name: 'schedule',
};

describe('verifyGitHubActionsReminderRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(jwtVerify).mockResolvedValue({ payload: validClaims } as never);
  });

  it('requires a bearer token', async () => {
    await expect(
      verifyGitHubActionsReminderRequest(undefined, 'crm-activity-reminders.yml'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwtVerify).not.toHaveBeenCalled();
  });

  it('verifies issuer, audience, token age, and CRM workflow identity', async () => {
    await expect(
      verifyGitHubActionsReminderRequest('Bearer signed-token', 'crm-activity-reminders.yml'),
    ).resolves.toBeUndefined();
    expect(jwtVerify).toHaveBeenCalledWith(
      'signed-token',
      expect.anything(),
      {
        issuer: 'https://token.actions.githubusercontent.com',
        audience: 'omega-erp-reminders',
        maxTokenAge: '5 minutes',
      },
    );
  });

  it('accepts only the project-event workflow identity for its endpoint', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: {
        ...validClaims,
        workflow_ref:
          'fielddataresearch83-cpu/Omega-Solutions-ERP/.github/workflows/project-event-reminders.yml@refs/heads/development',
        event_name: 'workflow_dispatch',
      },
    } as never);
    await expect(
      verifyGitHubActionsReminderRequest(
        'Bearer signed-token',
        'project-event-reminders.yml',
      ),
    ).resolves.toBeUndefined();
  });

  it.each([
    { ...validClaims, repository: 'another-owner/another-repo' },
    { ...validClaims, ref: 'refs/heads/main' },
    { ...validClaims, workflow_ref: 'untrusted-workflow' },
    { ...validClaims, event_name: 'pull_request' },
  ])('rejects claims outside the approved repository, branch, workflow, or event', async (claims) => {
    vi.mocked(jwtVerify).mockResolvedValue({ payload: claims } as never);
    await expect(
      verifyGitHubActionsReminderRequest('Bearer signed-token', 'crm-activity-reminders.yml'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an invalid or expired JWT', async () => {
    vi.mocked(jwtVerify).mockRejectedValueOnce(new Error('signature verification failed'));
    await expect(
      verifyGitHubActionsReminderRequest('Bearer invalid-token', 'crm-activity-reminders.yml'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
