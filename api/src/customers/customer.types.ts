export interface CustomerRow {
  [key: string]: unknown;
  id: string;
  company_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  county: string | null;
  address_line1: string | null;
  postal_code: string | null;
  credit_limit: number;
  outstanding_balance: number | null;
  status: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
