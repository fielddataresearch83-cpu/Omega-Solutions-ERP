import { describe, expect, it } from 'vitest';
import { businessDateAt } from './business-date.js';

describe('businessDateAt', () => {
  it('uses the company calendar date rather than UTC in Nairobi', () => {
    expect(businessDateAt('Africa/Nairobi', new Date('2026-11-14T22:00:00.000Z'))).toBe('2026-11-15');
  });
  it('respects a company in a timezone west of UTC', () => {
    expect(businessDateAt('America/Los_Angeles', new Date('2026-11-15T02:00:00.000Z'))).toBe('2026-11-14');
  });
  it('rejects invalid timezone identifiers', () => {
    expect(() => businessDateAt('Not/A_Timezone', new Date('2026-11-15T00:00:00.000Z'))).toThrow(RangeError);
  });
});
