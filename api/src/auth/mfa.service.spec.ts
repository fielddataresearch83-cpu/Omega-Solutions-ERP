import { ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { MfaService } from './mfa.service.js';

describe('MfaService.status', () => {
  it('fails closed when the MFA schema is missing', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({ rows: [{ table_name: null }] }),
    };
    const service = new MfaService(db as any);

    await expect(service.status('user-1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(db.query).toHaveBeenCalledOnce();
  });

  it('reports MFA disabled only when the schema exists and the user has no enabled MFA', async () => {
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ table_name: 'user_mfa' }] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    const service = new MfaService(db as any);

    await expect(service.status('user-1')).resolves.toEqual({
      enabled: false,
      recoveryCodesRemaining: 0,
    });
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  it('reports enabled MFA and remaining recovery codes from the user record', async () => {
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ table_name: 'user_mfa' }] })
        .mockResolvedValueOnce({ rows: [{ enabled_at: new Date(), recovery_code_hashes: ['hash-a', 'hash-b'] }] }),
    };
    const service = new MfaService(db as any);

    await expect(service.status('user-1')).resolves.toEqual({
      enabled: true,
      recoveryCodesRemaining: 2,
    });
  });

  it('does not turn database errors into an MFA-disabled result', async () => {
    const db = {
      query: vi.fn().mockRejectedValue(new Error('database unavailable')),
    };
    const service = new MfaService(db as any);

    await expect(service.status('user-1')).rejects.toThrow('database unavailable');
  });
});

describe('MfaService.useRecoveryCode atomic consumption', () => {
  it('removes a recovery code from the current database array in one conditional update', async () => {
    const code = 'A1B2C3D4';
    const target = createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ table_name: 'user_mfa' }] })
        .mockResolvedValueOnce({
          rows: [{
            recovery_code_hashes: [target, 'another-hash'],
            locked_until: null,
          }],
        })
        .mockResolvedValueOnce({ rowCount: 1 }),
    };
    const service = new MfaService(db as any);

    await expect(service.useRecoveryCode('user-1', code)).resolves.toBe(true);

    const [sql, params] = db.query.mock.calls[2] as [string, unknown[]];
    expect(sql).toContain('recovery_code_hashes = array_remove(recovery_code_hashes, $2::text)');
    expect(sql).toContain('$2::text = ANY(recovery_code_hashes)');
    expect(sql).toContain('enabled_at IS NOT NULL');
    expect(sql).toContain('locked_until <= NOW()');
    expect(sql).not.toContain('jsonb_array_elements_text');
    expect(params).toEqual(['user-1', target]);
  });
});

describe('MfaService.verifyUserCode lockout accounting', () => {
  it('increments failed attempts atomically in the database', async () => {
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ table_name: 'user_mfa' }] })
        .mockResolvedValueOnce({
          rows: [{
            secret_encrypted: 'encrypted-secret',
            pending_secret_encrypted: null,
            enabled_at: new Date(),
            recovery_code_hashes: [],
            failed_attempts: 4,
            locked_until: null,
          }],
        })
        .mockResolvedValueOnce({ rowCount: 1 }),
    };
    const service = new MfaService(db as any);
    (service as any).decrypt = vi.fn().mockReturnValue('secret');
    (service as any).verifyTotp = vi.fn().mockReturnValue(false);

    await expect(service.verifyUserCode('user-1', '000000')).resolves.toBe(false);

    const update = db.query.mock.calls[2][0] as string;
    expect(update).toContain('failed_attempts = failed_attempts + 1');
    expect(update).toContain('WHEN failed_attempts + 1 >= 5');
    expect(update).not.toContain('SET failed_attempts=$2');
    expect(db.query.mock.calls[2][1]).toEqual(['user-1']);
  });
});
