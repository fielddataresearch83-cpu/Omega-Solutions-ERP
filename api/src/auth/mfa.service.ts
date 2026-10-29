import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { DatabaseService } from '../database.service.js';

type MfaRow = {
  secret_encrypted: string | null;
  pending_secret_encrypted: string | null;
  enabled_at: Date | null;
  recovery_code_hashes: string[];
  failed_attempts: number;
  locked_until: Date | null;
};

const b32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(input: Buffer): string {
  let bits = '';
  for (const byte of input) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) out += b32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}
function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/g, '').toUpperCase();
  let bits = '';
  for (const char of clean) {
    const value = b32.indexOf(char);
    if (value < 0) throw new BadRequestException('Invalid authenticator secret');
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totp(secret: string, at = Date.now()): string {
  const counter = Math.floor(at / 30000);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const n = (mac.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return String(n).padStart(6, '0');
}
function hashCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

@Injectable()
export class MfaService {
  constructor(private readonly db: DatabaseService) {}

  private key(): Buffer {
    const value = process.env.MFA_ENCRYPTION_KEY;
    if (!value || !/^[0-9a-fA-F]{64}$/.test(value)) {
      throw new ServiceUnavailableException('MFA is not configured on the server (MFA_ENCRYPTION_KEY must be 32-byte hex).');
    }
    return Buffer.from(value, 'hex');
  }

  private encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
  }

  private decrypt(value: string): string {
    try {
      const [iv, tag, ciphertext] = value.split('.');
      const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      throw new ServiceUnavailableException('Unable to decrypt MFA secret; verify MFA_ENCRYPTION_KEY.');
    }
  }

  private async assertSchemaAvailable(): Promise<void> {
    const check = await this.db.query<{ table_name: string | null }>("SELECT to_regclass('public.user_mfa')::text AS table_name");
    if (!check.rows[0]?.table_name) {
      throw new ServiceUnavailableException('MFA schema is not yet installed on this environment.');
    }
  }

  async status(userId: string): Promise<{ enabled: boolean; recoveryCodesRemaining: number }> {
    const check = await this.db.query<{ table_name: string | null }>("SELECT to_regclass('public.user_mfa')::text AS table_name");
    if (!check.rows[0]?.table_name) {
      throw new ServiceUnavailableException('MFA schema is not yet installed on this environment.');
    }
    const result = await this.db.query<{ enabled_at: Date | null; recovery_code_hashes: string[] }>(
      'SELECT enabled_at, recovery_code_hashes FROM user_mfa WHERE user_id=$1',
      [userId],
    );
    const row = result.rows[0];
    return { enabled: Boolean(row?.enabled_at), recoveryCodesRemaining: row?.recovery_code_hashes?.length ?? 0 };
  }

  async beginEnrollment(userId: string, email: string): Promise<{ secret: string; otpauthUrl: string }> {
    await this.assertSchemaAvailable();
    const secret = base32Encode(randomBytes(20));
    await this.db.query(
      `INSERT INTO user_mfa (user_id, pending_secret_encrypted, updated_at)
       VALUES ($1,$2,NOW())
       ON CONFLICT (user_id) DO UPDATE SET pending_secret_encrypted=EXCLUDED.pending_secret_encrypted, updated_at=NOW()`,
      [userId, this.encrypt(secret)],
    );
    const issuer = 'Omega Solutions';
    const label = encodeURIComponent(`${issuer}:${email}`);
    const otpauthUrl = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
    return { secret, otpauthUrl };
  }

  async confirmEnrollment(userId: string, code: string): Promise<{ enabled: true; recoveryCodes: string[] }> {
    await this.assertSchemaAvailable();
    const result = await this.db.query<{ pending_secret_encrypted: string | null }>(
      'SELECT pending_secret_encrypted FROM user_mfa WHERE user_id=$1',
      [userId],
    );
    const pending = result.rows[0]?.pending_secret_encrypted;
    if (!pending) throw new BadRequestException('Start MFA enrollment before confirming it.');
    const secret = this.decrypt(pending);
    if (!this.verifyTotp(secret, code)) throw new UnauthorizedException('Invalid authenticator code.');
    const recoveryCodes = Array.from({ length: 10 }, () => randomBytes(5).toString('hex').toUpperCase());
    const hashes = recoveryCodes.map(hashCode);
    await this.db.query(
      `UPDATE user_mfa SET secret_encrypted=pending_secret_encrypted, pending_secret_encrypted=NULL,
       enabled_at=NOW(), recovery_code_hashes=ARRAY(SELECT jsonb_array_elements_text($2::jsonb)), failed_attempts=0, locked_until=NULL, updated_at=NOW()
       WHERE user_id=$1`,
      [userId, JSON.stringify(hashes)],
    );
    return { enabled: true, recoveryCodes };
  }

  async verifyUserCode(userId: string, code: string): Promise<boolean> {
    await this.assertSchemaAvailable();
    const result = await this.db.query<MfaRow>(
      'SELECT secret_encrypted, pending_secret_encrypted, enabled_at, recovery_code_hashes, failed_attempts, locked_until FROM user_mfa WHERE user_id=$1',
      [userId],
    );
    const row = result.rows[0];
    if (!row?.enabled_at || !row.secret_encrypted) return false;
    if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
      throw new UnauthorizedException('MFA temporarily locked after repeated failed attempts.');
    }
    const secret = this.decrypt(row.secret_encrypted);
    if (this.verifyTotp(secret, code)) {
      await this.db.query('UPDATE user_mfa SET failed_attempts=0, locked_until=NULL, updated_at=NOW() WHERE user_id=$1', [userId]);
      return true;
    }
    // Increment in SQL so concurrent invalid attempts cannot overwrite one another
    // and evade the lockout threshold through lost updates.
    await this.db.query(
      `UPDATE user_mfa
       SET failed_attempts = failed_attempts + 1,
           locked_until = CASE
             WHEN failed_attempts + 1 >= 5 THEN NOW() + INTERVAL '15 minutes'
             ELSE locked_until
           END,
           updated_at = NOW()
       WHERE user_id = $1`,
      [userId],
    );
    return false;
  }

  async useRecoveryCode(userId: string, code: string): Promise<boolean> {
    await this.assertSchemaAvailable();
    const result = await this.db.query<{ recovery_code_hashes: string[]; locked_until: Date | null }>(
      'SELECT recovery_code_hashes, locked_until FROM user_mfa WHERE user_id=$1 AND enabled_at IS NOT NULL',
      [userId],
    );
    const row = result.rows[0];
    if (!row) return false;
    if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
      throw new UnauthorizedException('MFA temporarily locked after repeated failed attempts.');
    }
    const target = hashCode(code);
    const index = row.recovery_code_hashes.findIndex((saved) => {
      const a = Buffer.from(saved, 'hex'); const b = Buffer.from(target, 'hex');
      return a.length === b.length && timingSafeEqual(a, b);
    });
    if (index < 0) return false;
    // Consume the code atomically against the current row. PostgreSQL serializes
    // concurrent UPDATEs on this row; array_remove is evaluated against the
    // latest row version, so concurrent use of different codes cannot restore
    // a previously consumed code from a stale application-side array.
    const updated = await this.db.query(
      `UPDATE user_mfa
       SET recovery_code_hashes = array_remove(recovery_code_hashes, $2::text),
           failed_attempts = 0,
           locked_until = NULL,
           updated_at = NOW()
       WHERE user_id = $1
         AND enabled_at IS NOT NULL
         AND $2::text = ANY(recovery_code_hashes)
         AND (locked_until IS NULL OR locked_until <= NOW())`,
      [userId, target],
    );
    return (updated.rowCount ?? 0) > 0;
  }

  async disable(userId: string, code: string): Promise<void> {
    await this.assertSchemaAvailable();
    const valid = (await this.verifyUserCode(userId, code)) || (await this.useRecoveryCode(userId, code));
    if (!valid) throw new UnauthorizedException('A valid authenticator or unused recovery code is required.');
    await this.db.query('DELETE FROM user_mfa WHERE user_id=$1', [userId]);
  }

  private verifyTotp(secret: string, supplied: string): boolean {
    if (!/^\d{6}$/.test(supplied)) return false;
    const now = Date.now();
    for (const drift of [-30000, 0, 30000]) {
      const expected = Buffer.from(totp(secret, now + drift));
      const actual = Buffer.from(supplied);
      if (timingSafeEqual(expected, actual)) return true;
    }
    return false;
  }
}
