import * as React from "react";
import { AlertCircle, Download, Eye, Loader2, Plus, Printer, Receipt, Search, Trash2 } from "lucide-react";
import { BaseLayout } from "@/components/layouts/base-layout";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { useCustomers } from "@/hooks/use-customers";
import { useProducts } from "@/hooks/use-products";
import { useMyCompany } from "@/hooks/use-company";
import { api } from "@/lib/api-client";
import { formatKES, formatDate } from "@/lib/format";
import type { CustomerRow, InvoiceApiRow, InvoiceItemApiRow, InvoicePaymentApiRow, ProductRow } from "@/lib/api-types";
import type { InvoiceStatus } from "@/lib/types";

const statuses = [
  { value: "all", label: "All statuses" }, { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" }, { value: "partially_paid", label: "Partially Paid" },
  { value: "paid", label: "Paid" }, { value: "overdue", label: "Overdue" },
  { value: "cancelled", label: "Cancelled" },
];
type DraftItem = { productId: string; quantity: string; taxRate: string };
type InvoiceDraft = { customerId: string; issueDate: string; dueDate: string; notes: string; items: DraftItem[] };
const todayISO = () => new Date().toISOString().slice(0, 10);
function defaultDueDate() { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10); }
function uiStatus(status: InvoiceApiRow["status"]): InvoiceStatus {
  const labels: Record<InvoiceApiRow["status"], InvoiceStatus> = {
    draft: "Draft", sent: "Sent", paid: "Paid", partially_paid: "Partially Paid", overdue: "Overdue", cancelled: "Cancelled",
  };
  return labels[status];
}
function errorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") return (error as { message: string }).message;
  return "The request failed. Please try again.";
}
function escapeHtml(value: unknown): string {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function printInvoice(invoice: InvoiceApiRow, company: { name?: string; address_line1?: string | null; address_line2?: string | null; city?: string | null; county?: string | null; phone?: string | null; email?: string | null; website?: string | null; registration_number?: string | null; vat_number?: string | null } | null, download = false) {
  const items = (invoice.items ?? []).map((item) => `<tr><td><strong>${escapeHtml(item.product_name)}</strong>${item.sku ? `<small>SKU: ${escapeHtml(item.sku)}</small>` : ""}</td><td class="num">${Number(item.quantity).toLocaleString()}</td><td class="num">${escapeHtml(formatKES(Number(item.unit_price)))}</td><td class="num">${escapeHtml(formatKES(Number(item.tax_amount)))}</td><td class="num">${escapeHtml(formatKES(Number(item.line_total)))}</td></tr>`).join("");
  const companyName = company?.name || "Omega Solutions";
  const address = [company?.address_line1, company?.address_line2, company?.city, company?.county].filter(Boolean).join(", ");
  const balance = Math.max(0, Number(invoice.total) - Number(invoice.amount_paid) - Number(invoice.credited_amount ?? 0));
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(invoice.invoice_number)}</title><style>
    *{box-sizing:border-box}body{font:13px Arial,Helvetica,sans-serif;color:#222;margin:0;background:#fff}.page{max-width:900px;margin:0 auto;padding:42px}.top{display:flex;justify-content:space-between;gap:28px;border-bottom:3px solid #2f6b3f;padding-bottom:22px}.brand{font-size:24px;font-weight:700;color:#245c36}.muted{color:#666;line-height:1.55}.invoice-title{text-align:right}.invoice-title h1{font-size:30px;margin:0 0 8px;letter-spacing:2px;color:#333}.meta{margin-top:26px;display:grid;grid-template-columns:1fr 1fr;gap:24px}.label{font-size:10px;font-weight:bold;text-transform:uppercase;color:#666;letter-spacing:1px;margin-bottom:8px}.billto{font-size:15px;font-weight:bold;margin-bottom:6px}.summary{display:flex;justify-content:space-between;margin:25px 0;background:#f3f7f3;padding:15px 18px;border:1px solid #d9e5da}.summary strong{font-size:17px}.summary .due{color:#245c36}.table{width:100%;border-collapse:collapse;margin-top:25px}.table th{background:#f0f2f0;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.6px;padding:12px 10px;border-bottom:1px solid #d8ddd8}.table td{padding:13px 10px;border-bottom:1px solid #e5e7e5;vertical-align:top}.table small{display:block;color:#777;margin-top:4px}.num{text-align:right;white-space:nowrap}.totals{margin:20px 0 0 auto;width:290px}.totals div{display:flex;justify-content:space-between;padding:7px 0}.grand{font-size:18px;font-weight:bold;border-top:2px solid #333;margin-top:5px;padding-top:12px!important}.notes{margin-top:28px;border-top:1px solid #ddd;padding-top:16px;white-space:pre-wrap}.footer{margin-top:45px;border-top:1px solid #ddd;padding-top:15px;color:#666;font-size:11px}.actions{position:sticky;top:0;padding:12px;background:#f5f5f5;text-align:right}.actions button{border:0;border-radius:5px;background:#245c36;color:white;padding:10px 16px;font-weight:bold;cursor:pointer}@media print{.actions{display:none}.page{padding:0;margin:0;max-width:none}@page{size:A4;margin:16mm}}</style></head><body><div class="actions"><button onclick="window.print()">Print / Save as PDF</button></div><main class="page">
    <div class="top"><div><div class="brand">${escapeHtml(companyName)}</div><div class="muted">${escapeHtml(address)}<br>${escapeHtml(company?.phone || "")}<br>${escapeHtml(company?.email || "")}<br>${escapeHtml(company?.website || "")}</div></div><div class="invoice-title"><h1>INVOICE</h1><div><strong>${escapeHtml(invoice.invoice_number)}</strong></div><div class="muted">Issue date: ${escapeHtml(formatDate(invoice.issue_date))}<br>Due date: ${escapeHtml(formatDate(invoice.due_date))}<br>Status: ${escapeHtml(invoice.status.replaceAll("_", " ").toUpperCase())}</div></div></div>
    <div class="meta"><section><div class="label">Bill to</div><div class="billto">${escapeHtml(invoice.customer_name)}</div><div class="muted">Customer account</div></section><section><div class="label">Payment terms</div><div>Due by ${escapeHtml(formatDate(invoice.due_date))}</div><div class="muted">Currency: ${escapeHtml(invoice.currency || "KES")}</div></section></div>
    <div class="summary"><span>Invoice total<br><strong>${escapeHtml(formatKES(Number(invoice.total)))}</strong></span><span>Amount paid<br><strong>${escapeHtml(formatKES(Number(invoice.amount_paid)))}</strong></span><span class="due">Balance due<br><strong>${escapeHtml(formatKES(balance))}</strong></span></div>
    <table class="table"><thead><tr><th>Product / Service</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Tax</th><th class="num">Amount</th></tr></thead><tbody>${items || '<tr><td colspan="5">No line items available.</td></tr>'}</tbody></table>
    <div class="totals"><div><span>Subtotal</span><span>${escapeHtml(formatKES(Number(invoice.subtotal)))}</span></div><div><span>Tax</span><span>${escapeHtml(formatKES(Number(invoice.tax_amount)))}</span></div><div class="grand"><span>Total</span><span>${escapeHtml(formatKES(Number(invoice.total)))}</span></div><div><span>Paid</span><span>${escapeHtml(formatKES(Number(invoice.amount_paid)))}</span></div><div><span>Credits applied</span><span>${escapeHtml(formatKES(Number(invoice.credited_amount ?? 0)))}</span></div><div><strong>Balance due</strong><strong>${escapeHtml(formatKES(balance))}</strong></div></div>
    ${invoice.notes ? `<div class="notes"><div class="label">Notes / payment information</div>${escapeHtml(invoice.notes)}</div>` : ""}
    <div class="footer">Thank you for your business.${company?.registration_number ? ` Registration no: ${escapeHtml(company.registration_number)}.` : ""}${company?.vat_number ? ` VAT no: ${escapeHtml(company.vat_number)}.` : ""}</div>
    </main></body></html>`;
  if (download) {
    const blob = new Blob(["\uFEFF", html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${invoice.invoice_number.replace(/[^a-zA-Z0-9_-]/g, "_")}.html`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return;
  }
  const popup = window.open("", "_blank", "width=960,height=760");
  if (!popup) {
    window.alert("Your browser blocked the print window. Allow pop-ups for this ERP site, then try again.");
    return;
  }
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  popup.focus();
}
function lineAmounts(item: DraftItem, products: ProductRow[]) {
  const product = products.find((entry) => entry.id === item.productId);
  const quantity = Number(item.quantity) || 0;
  const rate = Number(item.taxRate) || 0;
  const subtotal = product ? Math.round(Number(product.selling_price) * quantity * 100) / 100 : 0;
  const tax = Math.round(subtotal * rate) / 100;
  return { subtotal, tax, total: subtotal + tax };
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = React.useState<InvoiceApiRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState("");
  const [actionError, setActionError] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [viewingInvoice, setViewingInvoice] = React.useState<InvoiceApiRow | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [paymentOpen, setPaymentOpen] = React.useState(false);
  const [paymentDraft, setPaymentDraft] = React.useState({ amount: "", method: "mpesa", reference: "", notes: "" });
  const [formErrors, setFormErrors] = React.useState<Record<string, string>>({});
  const { customers, loading: customersLoading, error: customersError } = useCustomers();
  const { products, loading: productsLoading, error: productsError } = useProducts();
  const { company } = useMyCompany();
  const [draft, setDraft] = React.useState<InvoiceDraft>({
    customerId: "", issueDate: todayISO(), dueDate: defaultDueDate(), notes: "",
    items: [{ productId: "", quantity: "1", taxRate: "0" }],
  });

  const refreshInvoices = React.useCallback(async () => {
    setLoading(true); setLoadError("");
    try { setInvoices(await api.get<InvoiceApiRow[]>("/invoices")); }
    catch (error) { setLoadError(errorMessage(error)); }
    finally { setLoading(false); }
  }, []);
  React.useEffect(() => { let active=true; void api.get<InvoiceApiRow[]>("/invoices").then(result=>{if(active)setInvoices(result);}).catch(error=>{if(active)setLoadError(errorMessage(error));}).finally(()=>{if(active)setLoading(false);}); return()=>{active=false;}; }, []);

  const filtered = invoices.filter((invoice) => {
    const query = search.trim().toLowerCase();
    const matches = !query || invoice.invoice_number.toLowerCase().includes(query) || invoice.customer_name.toLowerCase().includes(query);
    return matches && (statusFilter === "all" || invoice.status === statusFilter);
  });
  const filteredTotal = filtered.reduce((sum, invoice) => sum + Number(invoice.total), 0);
  const amounts = draft.items.map((item) => lineAmounts(item, products));
  const subtotal = amounts.reduce((sum, item) => sum + item.subtotal, 0);
  const taxTotal = amounts.reduce((sum, item) => sum + item.tax, 0);

  const updateDraftItem = (index: number, patch: Partial<DraftItem>) => setDraft((current) => ({
    ...current, items: current.items.map((item, i) => i === index ? { ...item, ...patch } : item),
  }));

  const handleCreate = async () => {
    const errors: Record<string, string> = {};
    if (!draft.customerId) errors.customerId = "Select a customer.";
    if (!draft.issueDate) errors.issueDate = "Issue date is required.";
    if (!draft.dueDate) errors.dueDate = "Due date is required.";
    if (draft.dueDate && draft.issueDate && draft.dueDate < draft.issueDate) errors.dueDate = "Due date cannot be before issue date.";
    if (!draft.items.length || draft.items.some((item) => !item.productId || !(Number(item.quantity) > 0) || !Number.isFinite(Number(item.taxRate)) || Number(item.taxRate) < 0 || Number(item.taxRate) > 100)) errors.items = "Choose a product and enter a valid quantity and tax rate for every line.";
    setFormErrors(errors); setActionError("");
    if (Object.keys(errors).length) return;
    setSaving(true);
    try {
      const created = await api.post<InvoiceApiRow>("/invoices", {
        customerId: draft.customerId, issueDate: draft.issueDate, dueDate: draft.dueDate,
        notes: draft.notes.trim() || undefined,
        items: draft.items.map((item) => ({ productId: item.productId, quantity: Number(item.quantity), taxRate: Number(item.taxRate) || 0 })),
      });
      setInvoices((current) => [created, ...current.filter((invoice) => invoice.id !== created.id)]);
      setCreateOpen(false);
      setDraft({ customerId: "", issueDate: todayISO(), dueDate: defaultDueDate(), notes: "", items: [{ productId: "", quantity: "1", taxRate: "0" }] });
      setFormErrors({});
      void refreshInvoices();
    } catch (error) { setActionError(errorMessage(error)); }
    finally { setSaving(false); }
  };

  const openDetails = async (invoice: InvoiceApiRow) => {
    setViewingInvoice(invoice); setDetailLoading(true); setActionError("");
    try { setViewingInvoice(await api.get<InvoiceApiRow>(`/invoices/${invoice.id}`)); }
    catch (error) { setActionError(errorMessage(error)); }
    finally { setDetailLoading(false); }
  };
  const changeStatus = async (status: "sent" | "cancelled") => {
    if (!viewingInvoice) return;
    setSaving(true); setActionError("");
    try {
      const updated = await api.patch<InvoiceApiRow>(`/invoices/${viewingInvoice.id}/status`, { status });
      setViewingInvoice(updated);
      setInvoices((current) => current.map((invoice) => invoice.id === updated.id ? updated : invoice));
      await refreshInvoices();
    } catch (error) { setActionError(errorMessage(error)); }
    finally { setSaving(false); }
  };
  const openPaymentDialog = () => {
    if (!viewingInvoice) return;
    const pendingReports = (viewingInvoice.payments ?? []).filter((payment) => payment.status === "pending").reduce((sum, payment) => sum + Number(payment.amount), 0);
    const balance = Math.max(0, Number(viewingInvoice.total) - Number(viewingInvoice.amount_paid) - Number(viewingInvoice.credited_amount ?? 0) - pendingReports);
    setPaymentDraft({ amount: balance.toFixed(2), method: "mpesa", reference: "", notes: "" });
    setActionError("");
    setPaymentOpen(true);
  };
  const recordPayment = async () => {
    if (!viewingInvoice) return;
    const amount = Number(paymentDraft.amount);
    const pendingReports = (viewingInvoice.payments ?? []).filter((payment) => payment.status === "pending").reduce((sum, payment) => sum + Number(payment.amount), 0);
    const balance = Math.max(0, Number(viewingInvoice.total) - Number(viewingInvoice.amount_paid) - Number(viewingInvoice.credited_amount ?? 0) - pendingReports);
    if (!Number.isFinite(amount) || amount <= 0 || amount > balance) {
      setActionError("Enter a payment greater than zero and no more than the outstanding balance.");
      return;
    }
    setSaving(true);
    setActionError("");
    try {
      const updated = await api.post<InvoiceApiRow>(`/invoices/${viewingInvoice.id}/payments`, {
        amount, method: paymentDraft.method,
        reference: paymentDraft.reference.trim() || undefined,
        notes: paymentDraft.notes.trim() || undefined,
      });
      setViewingInvoice(updated);
      setInvoices((current) => current.map((invoice) => invoice.id === updated.id ? updated : invoice));
      setPaymentOpen(false);
      setPaymentDraft({ amount: "", method: "mpesa", reference: "", notes: "" });
      await refreshInvoices();
    } catch (error) { setActionError(errorMessage(error)); }
    finally { setSaving(false); }
  };
  const resetCreate = (open: boolean) => { setCreateOpen(open); if (!open) { setFormErrors({}); setActionError(""); } };
  const activeCustomers: CustomerRow[] = customers.filter((customer) => customer.is_active);
  const activeProducts: ProductRow[] = products.filter((product) => product.is_active);

  return <BaseLayout>
    <div className="flex flex-col gap-6 px-4 lg:px-6">
      <PageHeader title="Invoices" description="Create and track invoices using your company's real customer and product records." action={<Button onClick={() => resetCreate(true)} className="cursor-pointer"><Plus className="size-4" />Create Invoice</Button>} />
      {loadError && <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 p-3 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" /><span>{loadError}</span><Button variant="outline" size="sm" className="ml-auto" onClick={() => void refreshInvoices()}>Retry</Button></div>}
      <Card><CardContent className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1"><Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input placeholder="Search by invoice number or customer..." value={search} onChange={(event) => setSearch(event.target.value)} className="pl-8" aria-label="Search invoices" /></div>
          <Select value={statusFilter} onValueChange={(value) => value && setStatusFilter(value)}><SelectTrigger size="sm" className="w-full sm:w-44" aria-label="Filter by status"><SelectValue placeholder="All statuses" /></SelectTrigger><SelectContent>{statuses.map((status) => <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>)}</SelectContent></Select>
        </div>
        {loading ? <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading invoices…</div> : filtered.length === 0 ? <EmptyState icon={Receipt} title={invoices.length ? "No invoices found" : "No invoices yet"} description={invoices.length ? "Try adjusting your search or status filter." : "Create your first invoice from a real customer and product record."} action={<Button onClick={() => resetCreate(true)} variant="outline" className="cursor-pointer"><Plus className="size-4" />Create Invoice</Button>} /> : <>
          <Table><TableHeader><TableRow><TableHead>Invoice #</TableHead><TableHead>Customer</TableHead><TableHead className="hidden sm:table-cell">Issue Date</TableHead><TableHead className="hidden md:table-cell">Due Date</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>{filtered.map((invoice) => <TableRow key={invoice.id}><TableCell className="font-medium">{invoice.invoice_number}</TableCell><TableCell className="max-w-[180px] truncate">{invoice.customer_name}</TableCell><TableCell className="hidden sm:table-cell text-muted-foreground">{formatDate(invoice.issue_date)}</TableCell><TableCell className="hidden md:table-cell text-muted-foreground">{formatDate(invoice.due_date)}</TableCell><TableCell className="text-right font-medium tabular-nums">{formatKES(Number(invoice.total))}</TableCell><TableCell><StatusBadge status={uiStatus(invoice.status)} /></TableCell><TableCell className="text-right"><Button variant="ghost" size="icon-sm" className="cursor-pointer" onClick={() => void openDetails(invoice)} aria-label={`View ${invoice.invoice_number}`}><Eye className="size-4" /></Button></TableCell></TableRow>)}</TableBody>
          </Table>
          <div className="flex items-center justify-between border-t pt-3 text-sm text-muted-foreground"><span>{filtered.length} invoice(s)</span><span className="font-medium text-foreground tabular-nums">Total: {formatKES(filteredTotal)}</span></div>
        </>}
      </CardContent></Card>
    </div>
    <Dialog open={createOpen} onOpenChange={resetCreate}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Create Invoice</DialogTitle><DialogDescription>Saved invoices use your company's real database records. The server validates items and totals.</DialogDescription></DialogHeader>
        {(customersError || productsError) && <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{customersError || productsError}</div>}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5"><Label htmlFor="inv-customer">Customer *</Label><Select value={draft.customerId} onValueChange={(value) => value && setDraft((current) => ({ ...current, customerId: value }))}><SelectTrigger id="inv-customer" size="sm"><SelectValue placeholder={customersLoading ? "Loading customers…" : "Select customer"} /></SelectTrigger><SelectContent>{activeCustomers.map((customer) => <SelectItem key={customer.id} value={customer.id}>{customer.name}{customer.email ? ` — ${customer.email}` : ""}</SelectItem>)}</SelectContent></Select>{formErrors.customerId && <span className="text-xs text-destructive">{formErrors.customerId}</span>}{!customersLoading && activeCustomers.length === 0 && <span className="text-xs text-muted-foreground">Add an active customer before creating an invoice.</span>}</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div className="flex flex-col gap-1.5"><Label htmlFor="inv-issue">Issue date *</Label><Input id="inv-issue" type="date" value={draft.issueDate} onChange={(event) => setDraft((current) => ({ ...current, issueDate: event.target.value }))} /></div><div className="flex flex-col gap-1.5"><Label htmlFor="inv-due">Due date *</Label><Input id="inv-due" type="date" value={draft.dueDate} onChange={(event) => setDraft((current) => ({ ...current, dueDate: event.target.value }))} aria-invalid={!!formErrors.dueDate} />{formErrors.dueDate && <span className="text-xs text-destructive">{formErrors.dueDate}</span>}</div></div>
          <div className="flex flex-col gap-3"><div className="flex items-center justify-between"><Label>Invoice items *</Label><Button type="button" variant="outline" size="sm" onClick={() => setDraft((current) => ({ ...current, items: [...current.items, { productId: "", quantity: "1", taxRate: "0" }] }))}><Plus className="size-4" />Add item</Button></div>
            {draft.items.map((item, index) => { const product = activeProducts.find((entry) => entry.id === item.productId); const line = lineAmounts(item, activeProducts); return <div key={index} className="grid grid-cols-1 items-end gap-3 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_90px_90px_auto]"><div className="flex flex-col gap-1.5"><Label>Product</Label><Select value={item.productId} onValueChange={(value) => value && updateDraftItem(index, { productId: value })}><SelectTrigger size="sm"><SelectValue placeholder={productsLoading ? "Loading products…" : "Select product"} /></SelectTrigger><SelectContent>{activeProducts.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.name} ({entry.sku}) — {formatKES(Number(entry.selling_price))}</SelectItem>)}</SelectContent></Select>{product && <span className="text-xs text-muted-foreground">Unit price: {formatKES(Number(product.selling_price))}</span>}</div><div className="flex flex-col gap-1.5"><Label>Quantity</Label><Input type="number" min="0.001" step="0.001" value={item.quantity} onChange={(event) => updateDraftItem(index, { quantity: event.target.value })} /></div><div className="flex flex-col gap-1.5"><Label>Tax %</Label><Input type="number" min="0" max="100" step="0.01" value={item.taxRate} onChange={(event) => updateDraftItem(index, { taxRate: event.target.value })} /></div><div className="flex items-center justify-between gap-2 sm:flex-col sm:items-end"><span className="text-sm font-medium tabular-nums">{formatKES(line.total)}</span><Button type="button" variant="ghost" size="icon-sm" aria-label="Remove invoice item" disabled={draft.items.length === 1} onClick={() => setDraft((current) => ({ ...current, items: current.items.filter((_, i) => i !== index) }))}><Trash2 className="size-4" /></Button></div></div>; })}
            {formErrors.items && <span className="text-xs text-destructive">{formErrors.items}</span>}
          </div>
          <div className="flex flex-col gap-2 rounded-md bg-muted/40 p-3 text-sm"><div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{formatKES(subtotal)}</span></div><div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span className="tabular-nums">{formatKES(taxTotal)}</span></div><div className="flex justify-between border-t pt-2 text-base font-semibold"><span>Total (KES)</span><span className="tabular-nums">{formatKES(subtotal + taxTotal)}</span></div></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="inv-notes">Notes (optional)</Label><Input id="inv-notes" maxLength={2000} value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Payment terms or additional notes" /></div>
        </div>
        {actionError && <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{actionError}</div>}
        <DialogFooter><DialogClose render={<Button variant="outline" disabled={saving}>Cancel</Button>} /><Button onClick={() => void handleCreate()} disabled={saving || customersLoading || productsLoading || activeCustomers.length === 0 || activeProducts.length === 0} className="cursor-pointer">{saving && <Loader2 className="size-4 animate-spin" />}Save Invoice</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={!!viewingInvoice} onOpenChange={(open) => { if (!open) { setViewingInvoice(null); setActionError(""); } }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Invoice Details</DialogTitle><DialogDescription>{viewingInvoice?.invoice_number}</DialogDescription></DialogHeader>
        {viewingInvoice && <div className="flex flex-col gap-4 text-sm"><div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><div><span className="text-muted-foreground">Customer</span><p className="font-medium">{viewingInvoice.customer_name}</p></div><div><span className="text-muted-foreground">Status</span><p><StatusBadge status={uiStatus(viewingInvoice.status)} /></p></div><div><span className="text-muted-foreground">Issue date</span><p>{formatDate(viewingInvoice.issue_date)}</p></div><div><span className="text-muted-foreground">Due date</span><p>{formatDate(viewingInvoice.due_date)}</p></div><div><span className="text-muted-foreground">Amount paid</span><p>{formatKES(Number(viewingInvoice.amount_paid))}</p></div><div><span className="text-muted-foreground">Balance</span><p className="font-medium">{formatKES(Math.max(0, Number(viewingInvoice.total) - Number(viewingInvoice.amount_paid) - Number(viewingInvoice.credited_amount ?? 0)))}</p></div></div>
          <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Unit price</TableHead><TableHead className="text-right">Tax</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader><TableBody>{detailLoading ? <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground"><Loader2 className="mr-2 inline size-4 animate-spin" />Loading items…</TableCell></TableRow> : (viewingInvoice.items ?? []).map((item: InvoiceItemApiRow) => <TableRow key={item.id}><TableCell><span className="font-medium">{item.product_name}</span>{item.sku && <span className="block text-xs text-muted-foreground">{item.sku}</span>}</TableCell><TableCell className="text-right">{Number(item.quantity).toLocaleString()}</TableCell><TableCell className="text-right">{formatKES(Number(item.unit_price))}</TableCell><TableCell className="text-right">{formatKES(Number(item.tax_amount))}</TableCell><TableCell className="text-right font-medium">{formatKES(Number(item.line_total))}</TableCell></TableRow>)}</TableBody></Table></div>
          <div className="ml-auto flex w-full max-w-xs flex-col gap-2 border-t pt-3"><div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatKES(Number(viewingInvoice.subtotal))}</span></div><div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span>{formatKES(Number(viewingInvoice.tax_amount))}</span></div><div className="flex justify-between text-base font-semibold"><span>Total</span><span>{formatKES(Number(viewingInvoice.total))}</span></div></div>
          <div className="flex flex-col gap-2"><h3 className="font-medium">Payment history</h3>{!viewingInvoice.payments?.length ? <p className="text-muted-foreground">No payments recorded.</p> : <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Method</TableHead><TableHead>Reference</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{viewingInvoice.payments.map((payment: InvoicePaymentApiRow) => <TableRow key={payment.id}><TableCell>{formatDate(payment.status === "pending" ? payment.created_at : payment.paid_at)}</TableCell><TableCell className="capitalize">{payment.method}</TableCell><TableCell>{payment.reference || "—"}</TableCell><TableCell className="text-right">{formatKES(Number(payment.amount))}</TableCell><TableCell className="capitalize">{payment.status.replaceAll("_", " ")}</TableCell></TableRow>)}</TableBody></Table></div>}</div>
          {viewingInvoice.notes && <div><span className="text-muted-foreground">Notes</span><p>{viewingInvoice.notes}</p></div>}</div>}
        {actionError && <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{actionError}</div>}
        <DialogFooter>{viewingInvoice && <Button variant="outline" disabled={detailLoading} onClick={() => printInvoice(viewingInvoice, company, true)}><Download className="size-4" />Download HTML</Button>}{viewingInvoice && <Button variant="outline" disabled={detailLoading} onClick={() => printInvoice(viewingInvoice, company)}><Printer className="size-4" />Print / Save PDF</Button>}{viewingInvoice && ["sent", "overdue", "partially_paid"].includes(viewingInvoice.status) && Number(viewingInvoice.total) > Number(viewingInvoice.amount_paid) + Number(viewingInvoice.credited_amount ?? 0) && <Button variant="outline" disabled={saving || detailLoading} onClick={openPaymentDialog}>Record payment</Button>}{viewingInvoice?.status === "draft" && <Button variant="outline" disabled={saving || detailLoading} onClick={() => void changeStatus("cancelled")}>Cancel invoice</Button>}{viewingInvoice?.status === "draft" && <Button disabled={saving || detailLoading} onClick={() => void changeStatus("sent")}>{saving && <Loader2 className="size-4 animate-spin" />}Mark as sent</Button>}<DialogClose render={<Button variant="outline">Close</Button>} /></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={paymentOpen} onOpenChange={(open) => { setPaymentOpen(open); if (!open) setActionError(""); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Record invoice payment</DialogTitle><DialogDescription>Available to report: {viewingInvoice ? formatKES(Math.max(0, Number(viewingInvoice.total) - Number(viewingInvoice.amount_paid) - Number(viewingInvoice.credited_amount ?? 0) - (viewingInvoice.payments ?? []).filter((payment) => payment.status === "pending").reduce((sum, payment) => sum + Number(payment.amount), 0))) : formatKES(0)}. Saving creates a pending payment report. Invoice balances and accounting change only after an authorized user confirms it.</DialogDescription></DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5"><Label htmlFor="payment-amount">Amount (KES) *</Label><Input id="payment-amount" type="number" min="0.01" step="0.01" value={paymentDraft.amount} onChange={(event) => setPaymentDraft((current) => ({ ...current, amount: event.target.value }))} /></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="payment-method">Payment method *</Label><Select value={paymentDraft.method} onValueChange={(value) => value && setPaymentDraft((current) => ({ ...current, method: value }))}><SelectTrigger id="payment-method" size="sm"><SelectValue placeholder="Choose method" /></SelectTrigger><SelectContent><SelectItem value="mpesa">M-Pesa</SelectItem><SelectItem value="bank">Bank transfer</SelectItem><SelectItem value="cash">Cash</SelectItem><SelectItem value="card">Card</SelectItem><SelectItem value="cheque">Cheque</SelectItem></SelectContent></Select></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="payment-reference">Reference (optional)</Label><Input id="payment-reference" maxLength={100} value={paymentDraft.reference} onChange={(event) => setPaymentDraft((current) => ({ ...current, reference: event.target.value }))} placeholder="M-Pesa receipt or bank reference" /></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="payment-notes">Notes (optional)</Label><Input id="payment-notes" maxLength={1000} value={paymentDraft.notes} onChange={(event) => setPaymentDraft((current) => ({ ...current, notes: event.target.value }))} /></div>
        </div>
        {actionError && <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{actionError}</div>}
        <DialogFooter><DialogClose render={<Button variant="outline" disabled={saving}>Cancel</Button>} /><Button onClick={() => void recordPayment()} disabled={saving}>{saving && <Loader2 className="size-4 animate-spin" />}Save payment</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </BaseLayout>;
}
