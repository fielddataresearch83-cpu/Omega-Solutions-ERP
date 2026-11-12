export interface SupplierRow {
  [key: string]: unknown;
  id: string;
  company_id: string;
  name: string;
  email: string | null;
  kra_pin: string | null;
  phone: string | null;
  city: string | null;
  county: string | null;
  address_line1: string | null;
  postal_code: string | null;
  contact_person: string | null;
  payment_terms: string | null;
  outstanding_balance: number;
  status: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
