import * as React from "react";
import { AlertCircle, Download, FilePlus2, Loader2, RefreshCw } from "lucide-react";
import { BaseLayout } from "@/components/layouts/base-layout";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api-client";
import { useMyCompany } from "@/hooks/use-company";
import { formatDate, formatKES } from "@/lib/format";
import { downloadBusinessDocument, escapeDocumentText, printBusinessDocument } from "@/lib/printable-document";
import type { InvoiceApiRow } from "@/lib/api-types";

type OriginalInvoiceItem = { id: string; product_name: string; quantity: number | string; unit_price: number | string; tax_rate: number | string; tax_treatment?: string };
type CreditNoteItem = { id?: string; invoice_item_id?: string; tax_treatment?: string; description: string; quantity: number | string; unit_price: number | string; tax_rate: number | string; line_subtotal: number | string; tax_amount: number | string; line_total: number | string };
type CreditNote = { id: string; company_id: string; invoice_id: string; customer_id: string; customer_name: string; invoice_number: string; credit_note_number: string; issue_date: string; reason: string; subtotal: number | string; tax_amount: number | string; total: number | string; created_at: string; items?: CreditNoteItem[] };
const today = () => new Date().toISOString().slice(0, 10);
const message = (e: unknown) => e && typeof e === "object" && "message" in e ? String((e as {message: unknown}).message) : "The request failed. Please try again.";

export default function CreditNotesPage() {
  const { company } = useMyCompany();
  const [invoices, setInvoices] = React.useState<InvoiceApiRow[]>([]);
  const [notes, setNotes] = React.useState<CreditNote[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [invoiceId, setInvoiceId] = React.useState("");
  const [issueDate, setIssueDate] = React.useState(today());
  const [reason, setReason] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [quantity, setQuantity] = React.useState("1");
  const [originalItems, setOriginalItems] = React.useState<OriginalInvoiceItem[]>([]);
  const [invoiceItemId, setInvoiceItemId] = React.useState("");
  const selectedOriginalItem = originalItems.find(item => item.id === invoiceItemId);
  const unitPrice = selectedOriginalItem ? Number(selectedOriginalItem.unit_price) : 0;
  const taxRate = selectedOriginalItem ? Number(selectedOriginalItem.tax_rate) : 0;

  const load = React.useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [invoiceRows, creditRows] = await Promise.all([
        api.get<InvoiceApiRow[]>("/invoices"),
        api.get<CreditNote[]>("/credit-notes"),
      ]);
      setInvoices(invoiceRows);
      setNotes(creditRows);
    } catch (e) { setError(message(e)); }
    finally { setLoading(false); }
  }, []);
  React.useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const eligibleInvoices = invoices.filter(i => !["draft", "cancelled"].includes(i.status));
  const selectedInvoice = eligibleInvoices.find(i => i.id === invoiceId);
  const lineSubtotal = Math.round(Math.max(0, Number(quantity) || 0) * unitPrice * 100) / 100;
  const lineTax = Math.round(lineSubtotal * Math.max(0, Number(taxRate) || 0)) / 100;
  const lineTotal = Math.round((lineSubtotal + lineTax) * 100) / 100;
  const remaining = selectedInvoice ? Math.max(0, Number(selectedInvoice.total) - Number(selectedInvoice.amount_paid) - Number(selectedInvoice.credited_amount ?? 0)) : 0;

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); setError(""); setNotice("");
    try {
      const created = await api.post<CreditNote>("/credit-notes", {
        invoiceId, issueDate, reason,
        items: [{ invoiceItemId, description, quantity: Number(quantity) }],
      });
      setNotes(current => [created, ...current]);
      setReason(""); setDescription(""); setQuantity("1"); setNotice(`Credit note ${created.credit_note_number} created and posted to the ledger.`);
      await load();
    } catch (e) { setError(message(e)); }
    finally { setSaving(false); }
  };

  const printNote = async (note: CreditNote, download = false) => {
    setError("");
    try {
      const detail = await api.get<CreditNote>(`/credit-notes/${note.id}`);
      const companyName = company?.name || "Your business";
      const address = [company?.address_line1, company?.address_line2, company?.city, company?.county].filter(Boolean).join(", ");
      const rows = (detail.items ?? []).map(item => `<tr><td>${escapeDocumentText(item.description)}</td><td class="num">${Number(item.quantity).toLocaleString()}</td><td class="num">${formatKES(Number(item.unit_price))}</td><td class="num">${Number(item.tax_rate).toFixed(2)}%</td><td class="num">${formatKES(Number(item.line_total))}</td></tr>`).join("");
      const content = `<header class="top"><div><div class="brand">${escapeDocumentText(companyName)}</div><div class="muted">${escapeDocumentText(address)}<br>${escapeDocumentText(company?.phone || "")}<br>${escapeDocumentText(company?.email || "")}</div><h1>Credit note</h1><div class="muted">Credit adjustment to a customer invoice</div></div><div class="meta"><strong>${escapeDocumentText(detail.credit_note_number)}</strong><div>Date: ${escapeDocumentText(formatDate(detail.issue_date))}</div><div>Original invoice: ${escapeDocumentText(detail.invoice_number)}</div></div></header><div class="columns"><section><div class="section-title">Customer</div><strong>${escapeDocumentText(detail.customer_name)}</strong></section><section><div class="section-title">Reason for credit</div><div>${escapeDocumentText(detail.reason)}</div></section></div><table><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Tax rate</th><th class="num">Credit amount</th></tr></thead><tbody>${rows}</tbody></table><div class="totals"><div><span>Subtotal</span><span>${formatKES(Number(detail.subtotal))}</span></div><div><span>Tax adjustment</span><span>${formatKES(Number(detail.tax_amount))}</span></div><div class="grand"><span>Total credit</span><span>${formatKES(Number(detail.total))}</span></div></div><div class="note">This credit note is linked to invoice ${escapeDocumentText(detail.invoice_number)} and reduces the remaining receivable. It does not represent a cash refund.</div>`;
      if (download) downloadBusinessDocument("Credit note", detail.credit_note_number, content);
      else printBusinessDocument("Credit note", detail.credit_note_number, content);
    } catch (e) { setError(message(e)); }
  };

  return <BaseLayout>
    <div className="flex flex-col gap-6 px-4 lg:px-6">
      <PageHeader title="Credit Notes" description="Issue documented credit adjustments against unpaid invoice balances. Each posted credit creates a balanced accounting journal and preserves the original invoice." action={<Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="size-4" />Refresh</Button>} />
      {error && <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 p-3 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" /><span>{error}</span><Button variant="outline" size="sm" className="ml-auto" onClick={() => void load()}>Retry</Button></div>}
      {notice && <div role="status" className="rounded-md border p-3 text-sm">{notice}</div>}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><FilePlus2 className="size-5" />Create credit note</CardTitle><CardDescription>Choose an invoice and enter the credit adjustment. The total cannot exceed that invoice's remaining unpaid balance.</CardDescription></CardHeader>
        <CardContent><form onSubmit={create} className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2"><Label htmlFor="credit-invoice">Original invoice</Label><select id="credit-invoice" className="h-9 w-full rounded-md border bg-background px-3 text-sm" required value={invoiceId} onChange={async e => { const id = e.target.value; setInvoiceId(id); setInvoiceItemId(""); setOriginalItems([]); if (id) { try { const detail = await api.get<InvoiceApiRow & { items?: OriginalInvoiceItem[] }>(`/invoices/${id}`); setOriginalItems(detail.items ?? []); } catch (err) { setError(message(err)); } } }}><option value="">Select invoice…</option>{eligibleInvoices.map(i => <option key={i.id} value={i.id}>{i.invoice_number} · {i.customer_name} · Balance {formatKES(Math.max(0, Number(i.total)-Number(i.amount_paid)-Number(i.credited_amount ?? 0)))}</option>)}</select></div>
          <div className="grid gap-2 md:col-span-2"><Label htmlFor="credit-original-line">Original invoice line</Label><select id="credit-original-line" className="h-9 w-full rounded-md border bg-background px-3 text-sm" required value={invoiceItemId} onChange={e => setInvoiceItemId(e.target.value)} disabled={!invoiceId}><option value="">Select invoice line…</option>{originalItems.map(item => <option key={item.id} value={item.id}>{item.product_name} · Qty {Number(item.quantity).toLocaleString()} · {formatKES(Number(item.unit_price))} · Tax {Number(item.tax_rate).toFixed(2)}%</option>)}</select><p className="text-xs text-muted-foreground">Price and tax are taken from the original invoice and cannot be overridden.</p></div>
          <div className="grid gap-2"><Label htmlFor="credit-date">Credit note date</Label><Input id="credit-date" type="date" value={issueDate} max={today()} onChange={e => setIssueDate(e.target.value)} required /></div>
          <div className="grid gap-2 md:col-span-2"><Label htmlFor="credit-reason">Reason</Label><Input id="credit-reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} placeholder="e.g. Pricing adjustment, service adjustment, or billing correction" required /></div>
          <div className="grid gap-2 md:col-span-2"><Label htmlFor="credit-description">Credit line description</Label><Input id="credit-description" value={description} onChange={e => setDescription(e.target.value)} maxLength={200} placeholder="Describe the item or adjustment being credited" required /></div>
          <div className="grid gap-2"><Label htmlFor="credit-quantity">Quantity</Label><Input id="credit-quantity" type="number" min="0.001" step="0.001" value={quantity} onChange={e => setQuantity(e.target.value)} required /></div>
          <div className="rounded-md border p-3 text-sm"><div className="flex justify-between"><span>Original unit price</span><strong>{formatKES(unitPrice)}</strong></div><div className="flex justify-between"><span>Original tax treatment</span><strong>{selectedOriginalItem?.tax_treatment ?? "Historical rate"} · {taxRate.toFixed(2)}%</strong></div></div>
          <div className="rounded-md border p-3 text-sm"><div className="flex justify-between"><span>Credit subtotal</span><strong>{formatKES(lineSubtotal)}</strong></div><div className="flex justify-between"><span>Tax adjustment</span><strong>{formatKES(lineTax)}</strong></div><div className="mt-2 flex justify-between border-t pt-2"><span>Credit total</span><strong>{formatKES(lineTotal)}</strong></div><div className="mt-1 text-xs text-muted-foreground">Remaining invoice balance: {formatKES(remaining)}</div></div>
          <div className="flex items-end"><Button type="submit" disabled={saving || loading || !selectedInvoice || !invoiceItemId || !reason.trim() || !description.trim() || lineTotal <= 0 || lineTotal > remaining}><>{saving ? <Loader2 className="size-4 animate-spin" /> : <FilePlus2 className="size-4" />}{saving ? "Posting credit…" : "Create and post credit note"}</></Button></div>
        </form></CardContent>
      </Card>
      <Card><CardHeader><CardTitle>Credit note history</CardTitle><CardDescription>Credit notes from this company's live records.</CardDescription></CardHeader><CardContent>
        {loading ? <div className="flex justify-center p-8"><Loader2 className="size-5 animate-spin" /></div> : notes.length === 0 ? <EmptyState icon={FilePlus2} title="No credit notes yet" description="Credit notes you create will appear here. No sample records are shown." /> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Credit note</TableHead><TableHead>Original invoice</TableHead><TableHead>Customer</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Credit total</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{notes.map(note => <TableRow key={note.id}><TableCell className="font-medium">{note.credit_note_number}</TableCell><TableCell>{note.invoice_number}</TableCell><TableCell>{note.customer_name}</TableCell><TableCell>{formatDate(note.issue_date)}</TableCell><TableCell className="text-right tabular-nums">{formatKES(Number(note.total))}</TableCell><TableCell className="text-right"><div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={() => void printNote(note, true)}><Download className="size-4" />Download HTML</Button><Button variant="outline" size="sm" onClick={() => void printNote(note)}><FilePlus2 className="size-4" />Print / Save PDF</Button></div></TableCell></TableRow>)}</TableBody></Table></div>}
      </CardContent></Card>
    </div>
  </BaseLayout>;
}
