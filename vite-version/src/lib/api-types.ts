export interface AuthenticatedUser {
  userId: string;
  email: string;
  fullName: string;
  companyId: string | null;
  branchId: string | null;
  role: string;
  permissions: string[];
}

export interface CompanyRow {
  id: string;
  name: string;
  registration_number: string | null;
  vat_number: string | null;
  currency: string;
  timezone: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  county: string | null;
  postal_code: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  settings: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface BranchRow {
  id: string;
  company_id: string;
  name: string;
  code: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  county: string | null;
  postal_code: string | null;
  phone: string | null;
  email: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ApiError {
  statusCode: number;
  message: string;
  details?: unknown;
}

export interface CustomerRow {
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
  credit_limit: number;
  outstanding_balance: number;
  status: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProductRow {
  id: string;
  company_id: string;
  sku: string;
  name: string;
  description: string | null;
  image_url: string | null;
  category: string | null;
  unit: string;
  selling_price: number;
  cost_price: number;
  stock_quantity: number;
  reorder_level: number;
  tax_treatment: 'legacy' | 'standard' | 'zero_rated' | 'exempt' | 'out_of_scope';
  tax_rate: number;
  is_service: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SupplierRow {
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

export interface InvoiceItemApiRow {
  id: string; invoice_id: string; product_id: string | null; product_name: string; sku: string | null;
  quantity: number | string; unit_price: number | string; tax_rate: number | string;
  line_subtotal: number | string; tax_amount: number | string; line_total: number | string;
}

export interface InvoicePaymentApiRow {
  id: string;
  invoice_id: string;
  amount: number | string;
  method: "mpesa" | "bank" | "cash" | "card" | "cheque";
  reference: string | null;
  paid_at: string;
  notes: string | null;
  created_at: string;
  status: 'pending' | 'confirmed' | 'rejected' | 'reconciled';
  verified_at: string | null;
  reconciled_at: string | null;
  reconciliation_reference: string | null;
}

export interface InvoiceApiRow {
  id: string; company_id: string; customer_id: string; customer_name: string; invoice_number: string;
  issue_date: string; due_date: string;
  status: "draft" | "sent" | "paid" | "partially_paid" | "overdue" | "cancelled";
  currency: string; subtotal: number | string; tax_amount: number | string; total: number | string;
  amount_paid: number | string; credited_amount?: number | string; notes: string | null; created_at: string; updated_at: string;
  item_count?: number; items?: InvoiceItemApiRow[]; payments?: InvoicePaymentApiRow[];
}
