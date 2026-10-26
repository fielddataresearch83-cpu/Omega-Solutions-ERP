import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateSupplierBillItemDto, RecordSupplierBillPaymentDto } from './supplier-bill.dto.js';

describe('supplier bill monetary precision validation', () => {
  it('accepts quantities to three decimals, unit costs and tax rates to two decimals', async () => {
    const dto = plainToInstance(CreateSupplierBillItemDto, {
      description: 'Cleaning supplies',
      quantity: '1.125',
      unitCost: '125.50',
      taxRate: '16.50',
    });

    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects quantities beyond three decimals and unit costs or tax rates beyond two decimals', async () => {
    const quantity = plainToInstance(CreateSupplierBillItemDto, {
      description: 'Cleaning supplies',
      quantity: '1.1234',
      unitCost: '125.50',
      taxRate: '16',
    });
    const unitCost = plainToInstance(CreateSupplierBillItemDto, {
      description: 'Cleaning supplies',
      quantity: '1',
      unitCost: '125.501',
      taxRate: '16',
    });
    const taxRate = plainToInstance(CreateSupplierBillItemDto, {
      description: 'Cleaning supplies',
      quantity: '1',
      unitCost: '125.50',
      taxRate: '16.555',
    });

    expect((await validate(quantity)).some(error => error.property === 'quantity')).toBe(true);
    expect((await validate(unitCost)).some(error => error.property === 'unitCost')).toBe(true);
    expect((await validate(taxRate)).some(error => error.property === 'taxRate')).toBe(true);
  });

  it('rejects supplier payments with fractions of a cent', async () => {
    const dto = plainToInstance(RecordSupplierBillPaymentDto, {
      amount: '10.001',
      method: 'cash',
    });

    expect((await validate(dto)).some(error => error.property === 'amount')).toBe(true);
  });
});
