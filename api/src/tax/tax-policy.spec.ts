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

  it('rejects a standard product rate that differs from the company standard rate', () => {
    const policy = readCompanyTaxPolicy({
      taxPolicy: { mode: 'configured', vatRegistered: true, standardRate: 16 },
    });
    expect(() => resolveTaxTreatment({
      policy,
      productTreatment: 'standard',
      productRate: 7.5,
    })).toThrow(BadRequestException);
  });

  it('rejects a missing company standard rate while reading configured policy', () => {
    expect(() => readCompanyTaxPolicy({
      taxPolicy: { mode: 'configured', vatRegistered: true },
    })).toThrow(BadRequestException);
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
  it.each([
    ['unknown mode', { taxPolicy: { mode: 'enabled', vatRegistered: true, standardRate: 16 } }],
    ['wrong registration type', { taxPolicy: { mode: 'configured', vatRegistered: 'yes', standardRate: 16 } }],
    ['invalid rate type', { taxPolicy: { mode: 'configured', vatRegistered: true, standardRate: '16' } }],
    ['out-of-range rate', { taxPolicy: { mode: 'configured', vatRegistered: true, standardRate: 101 } }],
    ['non-object policy', { taxPolicy: 'configured' }],
  ])('rejects malformed company tax policy: %s', (_name, settings) => {
    expect(() => readCompanyTaxPolicy(settings)).toThrow(BadRequestException);
  });

  it('rejects malformed non-empty JSON settings rather than silently falling back to legacy', () => {
    expect(() => readCompanyTaxPolicy('{invalid json')).toThrow(BadRequestException);
  });

  it('allows an explicit legacy policy while validating its shape', () => {
    expect(readCompanyTaxPolicy({ taxPolicy: { mode: 'legacy', vatRegistered: false } }))
      .toEqual({ mode: 'legacy', vatRegistered: false });
  });

});
