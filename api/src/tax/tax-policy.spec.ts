import { BadRequestException } from '@nestjs/common';
import { readCompanyTaxPolicy, resolveTaxTreatment } from './tax-policy.js';

describe('company tax policy', () => {
  it('preserves legacy transaction tax inputs until the company opts in', () => {
    const policy = readCompanyTaxPolicy({});
    expect(policy.mode).toBe('legacy');
    expect(resolveTaxTreatment({
      policy,
      productTreatment: 'standard',
      productRate: 16,
      requestedRate: 7.5,
    })).toEqual({ treatment: 'legacy', rate: 7.5 });
  });

  it('uses the configured product rate for a VAT-registered company', () => {
    const policy = readCompanyTaxPolicy({
      taxPolicy: { mode: 'configured', vatRegistered: true, standardRate: 16 },
    });
    expect(resolveTaxTreatment({
      policy,
      productTreatment: 'standard',
      productRate: 16,
      requestedRate: 3,
    })).toEqual({ treatment: 'standard', rate: 16 });
  });

  it('rejects unclassified products once company tax policy is enabled', () => {
    const policy = readCompanyTaxPolicy({
      taxPolicy: { mode: 'configured', vatRegistered: true, standardRate: 16 },
    });
    expect(() => resolveTaxTreatment({
      policy,
      productTreatment: 'legacy',
      productRate: 0,
      requestedRate: 16,
    })).toThrow(BadRequestException);
  });

  it('does not apply standard-rated VAT when the company is not VAT-registered', () => {
    const policy = readCompanyTaxPolicy({
      taxPolicy: { mode: 'configured', vatRegistered: false },
    });
    expect(() => resolveTaxTreatment({
      policy,
      productTreatment: 'standard',
      productRate: 16,
    })).toThrow(BadRequestException);
  });

  it('forces zero output tax for exempt products even if the client sends a rate', () => {
    const policy = readCompanyTaxPolicy({
      taxPolicy: { mode: 'configured', vatRegistered: true, standardRate: 16 },
    });
    expect(resolveTaxTreatment({
      policy,
      productTreatment: 'exempt',
      productRate: 0,
      requestedRate: 16,
    })).toEqual({ treatment: 'exempt', rate: 0 });
  });
});
