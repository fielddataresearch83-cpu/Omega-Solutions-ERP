import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCompanyDto, UpdateCompanyDto } from './company.dto.js';

describe('Company timezone DTO validation', () => {
  it('accepts valid IANA timezones on create and update', async () => {
    const createErrors = await validate(plainToInstance(CreateCompanyDto, {
      name: 'Nairobi Traders', timezone: 'Africa/Nairobi',
    }));
    const updateErrors = await validate(plainToInstance(UpdateCompanyDto, {
      timezone: 'America/Los_Angeles',
    }));
    expect(createErrors).toHaveLength(0);
    expect(updateErrors).toHaveLength(0);
  });

  it('rejects invalid IANA timezones on create and update', async () => {
    const createErrors = await validate(plainToInstance(CreateCompanyDto, {
      name: 'Nairobi Traders', timezone: 'Not/A_Real_Zone',
    }));
    const updateErrors = await validate(plainToInstance(UpdateCompanyDto, {
      timezone: 'Not/A_Real_Zone',
    }));
    expect(createErrors.some((error) => error.property === 'timezone')).toBe(true);
    expect(updateErrors.some((error) => error.property === 'timezone')).toBe(true);
  });
});
