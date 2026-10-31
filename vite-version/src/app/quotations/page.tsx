import * as React from "react";
import { AlertCircle, FileText, Loader2, Plus, Search, Send, CheckCircle2, XCircle, ShoppingCart } from "lucide-react";
import { BaseLayout } from "@/components/layouts/base-layout";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCustomers } from "@/hooks/use-customers";
import { useProducts } from "@/hooks/use-products";
import { api } from "@/lib/api-client";
import { formatKES, formatDate } from "@/lib/format";
import type { CustomerRow, ProductRow } from "@/lib/api-types";

type QuotationStatus = "draft" | "sent" | "accepted" | "rejected" | "expired" | "cancelled" | "converted";
type QuotationItem = { id: string; product_id: string | null; product_name: string; sku: string | null; quantity: string | number; unit_price: string | number; tax_rate: string | number; line_total: string | number };
type Quotation = { id: string; customer_id: string; customer_name: string; quotation_number: string; issue_date: string; valid_until: string; status: QuotationStatus; subtotal: string | number; tax_amount: string | number; total: string | number; notes: string | null; item_count?: number; items?: QuotationItem[] };
type DraftItem = { productId: string; quantity: string; taxRate: string };
const today = () => new Date().toISOString().slice(0, 10);
const validDate = () => { const date = new Date(); date.setDate(date.getDate() + 14); return date.toISOString().slice(0, 10); };
const statusLabels: Record<QuotationStatus, string> = { draft: "Draft", sent: "Sent", accepted: "Accepted", rejected: "Rejected", expired: "Expired", cancelled: "Cancelled", converted: "Converted" };
function messageOf(error: unknown) { return error && typeof error === "object" && "message" in error ? String((error as {message: unknown}).message) : "Request failed. Please try again."; }
function statusClass(status: QuotationStatus) { return status === "accepted" || status === "converted" ? "bg-emerald-500/10 text-emerald-700" : status === "rejected" || status === "cancelled" ? "bg-destructive/10 text-destructive" : status === "sent" ? "bg-blue-500/10 text-blue-700" : "bg-muted text-muted-foreground"; }

export default function QuotationsPage() {
  const [quotations, setQuotations] = React.useState<Quotation[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [formOpen, setFormOpen] = React.useState(false);
  const [error, setError] = React.useState("");
  const [formError, setFormError] = React.useState("");
  const [customerId, setCustomerId] = React.useState("");
  const [issueDate, setIssueDate] = React.useState(today());
  const [validUntil, setValidUntil] = React.useState(validDate());
  const [notes, setNotes] = React.useState("");
  const [items, setItems] = React.useState<DraftItem[]>([{ productId: "", quantity: "1", taxRate: "0" }]);
  const { customers, loading: customersLoading, error: customersError } = useCustomers();
  const { products, loading: productsLoading, error: productsError } = useProducts();

  const refresh = React.useCallback(async () => {
    setLoading(true); setError("");
    try { setQuotations(await api.get<Quotation[]>("/quotations")); }
    catch (e) { setError(messageOf(e)); }
    finally { setLoading(false); }
  }, []);
  React.useEffect(() => { void Promise.resolve().then(refresh); }, [refresh]);
  React.useEffect(() => {
    let active = true
    void Promise.resolve().then(() => {
      if (!active || customersLoading || typeof window === "undefined") return
      const params = new URLSearchParams(window.location.search)
      const requestedCustomerId = params.get("customerId")
      if (!requestedCustomerId) return
      const customer = customers.find((item) => item.id === requestedCustomerId && item.is_active)
      if (!customer) {
        setFormError("The customer linked to this opportunity is unavailable or inactive. Choose an active customer instead.")
        setFormOpen(true)
        return
      }
      setCustomerId(customer.id)
      const opportunity = params.get("opportunity")?.trim()
      if (opportunity) setNotes((current) => current || `Opportunity: ${opportunity}`)
      setFormOpen(true)
    })
    return () => { active = false }
  }, [customers, customersLoading]);


  const filtered = quotations.filter((q) => {
    const query = search.trim().toLowerCase();
    return (!query || q.quotation_number.toLowerCase().includes(query) || q.customer_name.toLowerCase().includes(query)) &&
      (statusFilter === "all" || q.status === statusFilter);
  });
  const lineTotals = items.map((item) => {
    const product = products.find((p) => p.id === item.productId);
    const subtotal = Math.round(Number(product?.selling_price ?? 0) * (Number(item.quantity) || 0) * 100) / 100;
    const tax = Math.round(subtotal * (Number(item.taxRate) || 0)) / 100;
    return { subtotal, tax, total: subtotal + tax };
  });
  const total = lineTotals.reduce((sum, line) => sum + line.total, 0);

  const changeItem = (index: number, patch: Partial<DraftItem>) =>
    setItems((current) => current.map((item, i) => i === index ? { ...item, ...patch } : item));

  const createQuotation = async () => {
    setFormError("");
    if (!customerId) { setFormError("Select a customer."); return; }
    if (!issueDate || !validUntil || validUntil < issueDate) { setFormError("The validity date must be on or after the issue date."); return; }
    if (!items.length || items.some((item) => !item.productId || !(Number(item.quantity) > 0) || !Number.isFinite(Number(item.taxRate)) || Number(item.taxRate) < 0 || Number(item.taxRate) > 100)) {
      setFormError("Choose a product and enter a positive quantity and tax rate from 0 to 100 for every line."); return;
    }
    setSaving(true);
    try {
      await api.post<Quotation>("/quotations", {
        customerId, issueDate, validUntil, notes,
        items: items.map((item) => ({ productId: item.productId, quantity: Number(item.quantity), taxRate: Number(item.taxRate) })),
      });
      setFormOpen(false); setCustomerId(""); setNotes(""); setItems([{ productId: "", quantity: "1", taxRate: "0" }]);
      await refresh();
    } catch (e) { setFormError(messageOf(e)); }
    finally { setSaving(false); }
  };

  const convertToOrder = async (quotation: Quotation) => {
    setError("");
    try { await api.post(`/sales-orders/from-quotation/${quotation.id}`); await refresh(); }
    catch (e) { setError(messageOf(e)); }
  };

  const updateStatus = async (quotation: Quotation, status: "sent" | "accepted" | "rejected" | "cancelled") => {
    setError("");
    try {
      await api.patch<Quotation>(`/quotations/${quotation.id}/status`, { status });
      await refresh();
    } catch (e) { setError(messageOf(e)); }
  };

  return (
    <BaseLayout>
      <div className="flex flex-col gap-6 px-4 lg:px-6">
        <PageHeader title="Quotations" description="Create customer quotations using your live product catalogue, then track customer decisions."
          action={<Button onClick={() => { setFormOpen((v) => !v); setFormError(""); }}><Plus className="size-4" /> New quotation</Button>} />
        {(error || customersError || productsError) && <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" />{error || customersError || productsError}</div>}

        {formOpen && <Card><CardContent className="flex flex-col gap-4 p-4 md:p-6">
          <div><h2 className="font-semibold">Create quotation</h2><p className="text-sm text-muted-foreground">Prices are taken from the selected products and saved as a quotation snapshot.</p></div>
          {formError && <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{formError}</div>}
          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex flex-col gap-1.5"><Label>Customer *</Label><select className="h-9 rounded-md border bg-background px-3 text-sm" value={customerId} onChange={(e) => setCustomerId(e.target.value)} disabled={customersLoading}><option value="">Select customer</option>{customers.filter((c) => c.is_active).map((c: CustomerRow) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div className="flex flex-col gap-1.5"><Label>Issue date *</Label><Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} /></div>
            <div className="flex flex-col gap-1.5"><Label>Valid until *</Label><Input type="date" min={issueDate} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></div>
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between"><Label>Quotation items *</Label><Button variant="outline" size="sm" onClick={() => setItems((v) => [...v, { productId: "", quantity: "1", taxRate: "0" }])}><Plus className="size-4" /> Add line</Button></div>
            {items.map((item, index) => <div key={index} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_auto] md:items-end">
              <div className="flex flex-col gap-1.5"><Label>Product</Label><select className="h-9 min-w-0 rounded-md border bg-background px-3 text-sm" value={item.productId} onChange={(e) => changeItem(index, { productId: e.target.value })} disabled={productsLoading}><option value="">Select product</option>{products.filter((p) => p.is_active).map((p: ProductRow) => <option key={p.id} value={p.id}>{p.name} · {formatKES(Number(p.selling_price))}</option>)}</select></div>
              <div className="flex flex-col gap-1.5"><Label>Quantity</Label><Input type="number" min="0.001" step="0.001" value={item.quantity} onChange={(e) => changeItem(index, { quantity: e.target.value })} /></div>
              <div className="flex flex-col gap-1.5"><Label>Tax %</Label><Input type="number" min="0" max="100" step="0.01" value={item.taxRate} onChange={(e) => changeItem(index, { taxRate: e.target.value })} /></div>
              <div className="flex flex-col gap-1.5"><Label>Line total</Label><div className="h-9 flex items-center text-sm font-medium tabular-nums">{formatKES(lineTotals[index]?.total ?? 0)}</div></div>
              <Button variant="ghost" size="icon" aria-label="Remove quotation line" disabled={items.length === 1} onClick={() => setItems((v) => v.filter((_, i) => i !== index))}><XCircle className="size-4" /></Button>
            </div>)}
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end"><div className="flex flex-col gap-1.5"><Label>Notes (optional)</Label><Input value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} placeholder="Scope, terms, or additional details" /></div><div className="text-right"><p className="text-sm text-muted-foreground">Estimated total</p><p className="text-xl font-semibold tabular-nums">{formatKES(total)}</p></div></div>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</Button><Button onClick={() => void createQuotation()} disabled={saving || customersLoading || productsLoading}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Save draft</Button></div>
        </CardContent></Card>}

        <Card><CardContent className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1"><Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-8" placeholder="Search quotation number or customer" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <select className="h-9 rounded-md border bg-background px-3 text-sm sm:w-48" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter quotation status"><option value="all">All statuses</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          </div>
          {loading ? <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div> : filtered.length === 0 ? <div className="flex flex-col items-center gap-2 py-12 text-center"><FileText className="size-8 text-muted-foreground" /><p className="font-medium">{quotations.length ? "No matching quotations" : "No quotations yet"}</p><p className="text-sm text-muted-foreground">{quotations.length ? "Adjust your search or status filter." : "Create a quotation to start your sales workflow. No sample records are shown."}</p></div> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Quotation #</TableHead><TableHead>Customer</TableHead><TableHead>Issue date</TableHead><TableHead>Valid until</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{filtered.map((q) => <TableRow key={q.id}><TableCell className="font-medium">{q.quotation_number}</TableCell><TableCell>{q.customer_name}</TableCell><TableCell>{formatDate(q.issue_date)}</TableCell><TableCell>{formatDate(q.valid_until)}</TableCell><TableCell><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusClass(q.status)}`}>{statusLabels[q.status]}</span></TableCell><TableCell className="text-right font-medium tabular-nums">{formatKES(Number(q.total))}</TableCell><TableCell><div className="flex justify-end gap-1">{q.status === "draft" && <Button size="sm" variant="outline" onClick={() => void updateStatus(q, "sent")}><Send className="size-3.5" /> Send</Button>}{q.status === "sent" && <><Button size="icon-sm" variant="ghost" aria-label="Mark accepted" onClick={() => void updateStatus(q, "accepted")}><CheckCircle2 className="size-4 text-emerald-600" /></Button><Button size="icon-sm" variant="ghost" aria-label="Mark rejected" onClick={() => void updateStatus(q, "rejected")}><XCircle className="size-4 text-destructive" /></Button></>}{q.status === "accepted" && <Button size="sm" variant="outline" onClick={() => void convertToOrder(q)}><ShoppingCart className="size-3.5" /> Create order</Button>}{(q.status === "draft" || q.status === "sent") && <Button size="sm" variant="ghost" onClick={() => void updateStatus(q, "cancelled")}>Cancel</Button>}</div></TableCell></TableRow>)}</TableBody></Table></div>}
        </CardContent></Card>
      </div>
    </BaseLayout>
  );
}
