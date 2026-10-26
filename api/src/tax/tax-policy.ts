import { BadRequestException } from '@nestjs/common';

export type TaxTreatment = 'legacy' | 'standard' | 'zero_rated' | 'exempt' | 'out_of_scope';
export interface CompanyTaxPolicy {
  mode: 'legacy' | 'configured';
  vatRegistered: boolean;
  standardRate?: number;
}

/**
 * Missing taxPolicy is the explicit compatibility path for companies that have
 * not opted into configured tax. Once a policy exists, malformed values fail
 * closed rather than silently restoring client-controlled legacy tax rates.
 */
export function readCompanyTaxPolicy(settings: unknown): CompanyTaxPolicy {
  let value: unknown = settings;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      if (value.trim()) throw new BadRequestException('Company tax settings are invalid JSON. Correct the tax policy before creating transactions.');
      value = {};
    }
  }
  if (value === null || value === undefined || value === '') {
    return { mode: 'legacy', vatRegistered: false };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Company tax settings must be an object.');
  }
  const settingsObject = value as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(settingsObject, 'taxPolicy')) {
    return { mode: 'legacy', vatRegistered: false };
  }
  const raw = settingsObject.taxPolicy;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BadRequestException('Company tax policy is invalid. Correct the tax policy before creating transactions.');
  }
  const policy = raw as Record<string, unknown>;
  if (policy.mode !== 'legacy' && policy.mode !== 'configured') {
    throw new BadRequestException('Company tax policy mode must be legacy or configured.');
  }
  if (typeof policy.vatRegistered !== 'boolean') {
    throw new BadRequestException('Company tax policy must explicitly state VAT registration status.');
  }
  if (policy.standardRate !== undefined &&
      (typeof policy.standardRate !== 'number' || !Number.isFinite(policy.standardRate) ||
       policy.standardRate <= 0 || policy.standardRate > 100)) {
    throw new BadRequestException('Company standard tax rate must be a number greater than zero and no more than 100.');
  }
  if (policy.mode === 'configured' && policy.vatRegistered && policy.standardRate === undefined) {
    throw new BadRequestException('A VAT-registered company must configure its standard tax rate.');
  }
  return {
    mode: policy.mode,
    vatRegistered: policy.vatRegistered,
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
  if (input.productTreatment === 'standard' && !(Number.isFinite(rate) && rate > 0 && rate <= 100)) {
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
