import { BadRequestException } from '@nestjs/common';

export type TaxTreatment = 'legacy' | 'standard' | 'zero_rated' | 'exempt' | 'out_of_scope';
export interface CompanyTaxPolicy {
  mode: 'legacy' | 'configured';
  vatRegistered: boolean;
  standardRate?: number;
}

export function readCompanyTaxPolicy(settings: unknown): CompanyTaxPolicy {
  let value: unknown = settings;
  if (typeof value === 'string') {
    try { value = JSON.parse(value) as unknown; } catch { value = {}; }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { mode: 'legacy', vatRegistered: false };
  const raw = (value as Record<string, unknown>).taxPolicy;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { mode: 'legacy', vatRegistered: false };
  const policy = raw as Record<string, unknown>;
  return {
    mode: policy.mode === 'configured' ? 'configured' : 'legacy',
    vatRegistered: policy.vatRegistered === true,
    ...(typeof policy.standardRate === 'number' ? { standardRate: policy.standardRate } : {}),
  };
}

export function resolveTaxTreatment(input: {
  policy: CompanyTaxPolicy;
  productTreatment: TaxTreatment;
  productRate: number;
  requestedRate?: number;
}): { treatment: TaxTreatment; rate: number } {
  if (input.policy.mode !== 'configured') {
    return { treatment: 'legacy', rate: input.requestedRate ?? 0 };
  }
  if (input.productTreatment === 'legacy') {
    throw new BadRequestException('Configure this product tax treatment before creating transactions under the company tax policy.');
  }
  if (input.productTreatment === 'standard' && !input.policy.vatRegistered) {
    throw new BadRequestException('A company must be marked VAT-registered before selling standard-rated products.');
  }
  const rate = input.productTreatment === 'standard' ? input.productRate : 0;
  if (input.productTreatment === 'standard' && !(rate > 0 && rate <= 100)) {
    throw new BadRequestException('Standard-rated products require a valid configured tax rate.');
  }
  if (input.productTreatment === 'standard') {
    const companyRate = input.policy.standardRate;
    if (typeof companyRate !== 'number' || !Number.isFinite(companyRate) || companyRate <= 0 || companyRate > 100) {
      throw new BadRequestException('Configure a valid company standard tax rate before using standard-rated products.');
    }
    if (Math.abs(rate - companyRate) > 0.0001) {
      throw new BadRequestException('The product tax rate must match the company standard tax rate. Classify different statutory treatments explicitly as zero-rated, exempt, or out-of-scope.');
    }
  }
  return { treatment: input.productTreatment, rate };
}
