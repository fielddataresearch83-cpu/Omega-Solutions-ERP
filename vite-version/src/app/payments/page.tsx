import * as React from "react";
import { AlertCircle, Banknote, CheckCircle2, Download, Loader2, RefreshCw, Receipt, XCircle, Smartphone } from "lucide-react";
import { BaseLayout } from "@/components/layouts/base-layout";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api-client";
import { useAuth } from "@/contexts/auth-context";
import { useMyCompany } from "@/hooks/use-company";
import { escapeDocumentText, printBusinessDocument } from "@/lib/printable-document";
import { formatDate, formatDateTime, formatKES } from "@/lib/format";
import type { InvoiceApiRow, InvoicePaymentApiRow } from "@/lib/api-types";

type PaymentRecord = InvoicePaymentApiRow & { invoice_number: string; customer_name: string };
function errorMessage(error: unknown) {
  return error && typeof error === "object" && "message" in error && typeof error.message === "string"
    ? error.message : "Unable to load payment records. Please try again.";
}
const methodLabel: Record<InvoicePaymentApiRow["method"], string> = {
  mpesa: "M-Pesa", bank: "Bank transfer", cash: "Cash", card: "Card", cheque: "Cheque",
};

export default function PaymentsPage() {
  const { user } = useAuth();
  const { company } = useMyCompany();
  const canVerifyPayments = Boolean(user?.permissions.includes("payments:verify"));
  const canReconcilePayments = Boolean(user?.permissions.includes("payments:reconcile"));
  const [payments, setPayments] = React.useState<PaymentRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [invoiceCount, setInvoiceCount] = React.useState(0);
  const [eligibleInvoices, setEligibleInvoices] = React.useState<InvoiceApiRow[]>([]);
  const [mpesaInvoiceId, setMpesaInvoiceId] = React.useState("");
  const [mpesaPhone, setMpesaPhone] = React.useState("");
  const [mpesaAmount, setMpesaAmount] = React.useState("");
  const [mpesaSubmitting, setMpesaSubmitting] = React.useState(false);
  const [mpesaRequest, setMpesaRequest] = React.useState<{ requestId: string; status: string; message?: string } | null>(null);
  const [mpesaStatusLoading, setMpesaStatusLoading] = React.useState(false);
  const [confirmingId, setConfirmingId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState("");
  const [reconcilingId, setReconcilingId] = React.useState<string | null>(null);
  const [statementReferences, setStatementReferences] = React.useState<Record<string, string>>({});

  const load = React.useCallback(async () => {
    setLoading(true); setError("");
    try {
      const invoices = await api.get<InvoiceApiRow[]>("/invoices");
      setInvoiceCount(invoices.length);
      const eligible = invoices.filter((invoice) =>
        ["sent", "overdue", "partially_paid"].includes(invoice.status) &&
        Number(invoice.total) - Number(invoice.amount_paid) - Number(invoice.credited_amount ?? 0) > 0
      );
      setEligibleInvoices(eligible);
      setMpesaInvoiceId((current) => eligible.some((invoice) => invoice.id === current) ? current : (eligible[0]?.id ?? ""));
      // The current API exposes payment detail on each invoice, so load the company-scoped
      // invoice details and flatten their persisted payment records.
      const details = await Promise.all(invoices.map((invoice) => api.get<InvoiceApiRow>(`/invoices/${invoice.id}`)));
      const rows = details.flatMap((invoice) => (invoice.payments ?? []).map((payment) => ({
        ...payment, invoice_number: invoice.invoice_number, customer_name: invoice.customer_name,
      })));
      rows.sort((a, b) => new Date(b.paid_at || b.created_at).getTime() - new Date(a.paid_at || a.created_at).getTime());
      setPayments(rows);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, []);
  React.useEffect(() => { let active=true; void api.get<InvoiceApiRow[]>("/invoices").then(async invoices=>{if(!active)return;setInvoiceCount(invoices.length);const eligible=invoices.filter(invoice=>["sent","overdue","partially_paid"].includes(invoice.status)&&Number(invoice.total)-Number(invoice.amount_paid)-Number(invoice.credited_amount??0)>0);setEligibleInvoices(eligible);setMpesaInvoiceId(current=>eligible.some(invoice=>invoice.id===current)?current:(eligible[0]?.id??""));const details=await Promise.all(invoices.map(invoice=>api.get<InvoiceApiRow>(`/invoices/${invoice.id}`)));if(!active)return;const rows=details.flatMap(invoice=>(invoice.payments??[]).map(payment=>({...payment,invoice_number:invoice.invoice_number,customer_name:invoice.customer_name})));rows.sort((a,b)=>new Date(b.paid_at||b.created_at).getTime()-new Date(a.paid_at||a.created_at).getTime());setPayments(rows);}).catch(err=>{if(active)setError(errorMessage(err));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};}, []);

  const startMpesaPayment = async () => {
    const amount = Number(mpesaAmount);
    if (!mpesaInvoiceId || !mpesaPhone.trim() || !Number.isInteger(amount) || amount < 1) {
      setActionError("Choose an invoice, enter a Kenyan mobile number, and enter a whole-shilling amount.");
      return;
    }
    setMpesaSubmitting(true);
    setActionError("");
    setMpesaRequest(null);
    try {
      const result = await api.post<{ requestId: string; status: string; message?: string }>("/mpesa/stk-push", {
        invoiceId: mpesaInvoiceId,
        phoneNumber: mpesaPhone.trim(),
        amount,
      });
      setMpesaRequest(result);
      setMpesaAmount("");
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setMpesaSubmitting(false);
    }
  };
  const refreshMpesaStatus = async () => {
    if (!mpesaRequest) return;
    setMpesaStatusLoading(true);
    setActionError("");
    try {
      const result = await api.get<{ status: string; mpesa_receipt_number?: string | null; failure_reason?: string | null }>(`/mpesa/stk-push/${mpesaRequest.requestId}`);
      setMpesaRequest((current) => current ? { ...current, status: result.status } : current);
      if (result.failure_reason) setActionError(result.failure_reason);
      if (result.status === "reconciled") await load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setMpesaStatusLoading(false);
    }
  };
  const rejectPayment = async (payment: PaymentRecord) => {
    setConfirmingId(payment.id); setActionError("");
    try { await api.post<InvoiceApiRow>(`/invoices/${payment.invoice_id}/payments/${payment.id}/reject`); await load(); }
    catch (err) { setActionError(errorMessage(err)); }
    finally { setConfirmingId(null); }
  };
  const reconcilePayment = async (payment: PaymentRecord) => {
    const statementReference = (statementReferences[payment.id] || "").trim();
    if (!statementReference) { setActionError("Enter the matching bank statement reference before reconciling."); return; }
    setReconcilingId(payment.id); setActionError("");
    try {
      await api.post<InvoiceApiRow>(`/invoices/${payment.invoice_id}/payments/${payment.id}/reconcile`, { statementReference });
      setStatementReferences((current) => ({ ...current, [payment.id]: "" }));
      await load();
    } catch (err) { setActionError(errorMessage(err)); }
    finally { setReconcilingId(null); }
  };
  const printReceipt = (payment: PaymentRecord) => {
    const receiptNumber = "RCPT-" + payment.id.slice(0, 8).toUpperCase();
    const companyName = company?.name || "Your business";
    const address = [company?.address_line1, company?.address_line2, company?.city, company?.county].filter(Boolean).join(", ");
    const content = `<header class="top"><div><div class="brand">${escapeDocumentText(companyName)}</div><div class="muted">${escapeDocumentText(address)}<br>${escapeDocumentText(company?.phone || "")}<br>${escapeDocumentText(company?.email || "")}</div><h1>Payment receipt</h1></div><div class="meta"><strong>${escapeDocumentText(receiptNumber)}</strong><div>Invoice: ${escapeDocumentText(payment.invoice_number)}</div><div>Date: ${escapeDocumentText(formatDate(payment.paid_at || payment.created_at))}</div></div></header><div class="columns"><section><div class="section-title">Received from</div><strong>${escapeDocumentText(payment.customer_name)}</strong></section><section><div class="section-title">Payment details</div><div>Method: <strong>${escapeDocumentText(methodLabel[payment.method] ?? payment.method)}</strong></div><div>Reference: <strong>${escapeDocumentText(payment.reference || "—")}</strong></div><div>Status: <strong>${escapeDocumentText(payment.status)}</strong></div></section></div><div class="totals"><div class="grand"><span>Amount received</span><span>${formatKES(Number(payment.amount))}</span></div></div><div class="note">Payment allocated to invoice ${escapeDocumentText(payment.invoice_number)}. Retain this receipt for your records.</div>`;
    printBusinessDocument("Payment receipt", receiptNumber, content);
  };
  const totalRecorded = payments.filter((payment) => payment.status === "confirmed" || payment.status === "reconciled").reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const confirmPayment = async (payment: PaymentRecord) => {
    setConfirmingId(payment.id); setActionError("");
    try { await api.post<InvoiceApiRow>(`/invoices/${payment.invoice_id}/payments/${payment.id}/confirm`); await load(); }
    catch (err) { setActionError(errorMessage(err)); }
    finally { setConfirmingId(null); }
  };
  return <BaseLayout>
    <div className="mx-auto flex w-full max-w-screen-2xl min-w-0 flex-col gap-6 px-4 sm:px-6 lg:px-8">
      <PageHeader title="Payments" description="Payment records stored against your company's invoices. Provider and bank verification are shown separately from ERP recording." action={<Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-2 size-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button>} />
      {error && <div role="alert" className="flex items-start gap-3 rounded-lg border border-destructive/30 p-4 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" /><span className="flex-1">{error}</span><Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button></div>}
      {user?.permissions.includes("payments:write") && <Card><CardHeader><CardTitle className="flex items-center gap-2"><Smartphone className="size-5" />Collect with M-Pesa</CardTitle><CardDescription>Send an STK Push to the customer's phone. A verified successful Daraja callback will confirm and reconcile the receipt automatically; mismatched transactions require review.</CardDescription></CardHeader><CardContent className="flex flex-col gap-4">
        {eligibleInvoices.length === 0 ? <p className="text-sm text-muted-foreground">There are no issued invoices with an outstanding balance.</p> : <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5"><label htmlFor="mpesa-invoice" className="text-sm font-medium">Invoice</label><select id="mpesa-invoice" className="h-10 rounded-md border bg-background px-3 text-sm" value={mpesaInvoiceId} onChange={(event) => setMpesaInvoiceId(event.target.value)}>{eligibleInvoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoice_number} · {invoice.customer_name} · Balance {formatKES(Math.max(0, Number(invoice.total) - Number(invoice.amount_paid) - Number(invoice.credited_amount ?? 0)))}</option>)}</select></div>
          <div className="flex flex-col gap-1.5"><label htmlFor="mpesa-phone" className="text-sm font-medium">Customer mobile</label><input id="mpesa-phone" className="h-10 rounded-md border bg-background px-3 text-sm" value={mpesaPhone} onChange={(event) => setMpesaPhone(event.target.value)} placeholder="0712345678 or 254712345678" maxLength={32} /></div>
          <div className="flex flex-col gap-1.5"><label htmlFor="mpesa-amount" className="text-sm font-medium">Amount (whole KES)</label><input id="mpesa-amount" type="number" min="1" step="1" className="h-10 rounded-md border bg-background px-3 text-sm" value={mpesaAmount} onChange={(event) => setMpesaAmount(event.target.value)} placeholder="e.g. 1500" /></div>
        </div>}
        <div className="flex flex-wrap items-center gap-3"><Button onClick={() => void startMpesaPayment()} disabled={mpesaSubmitting || eligibleInvoices.length === 0}><Smartphone className="mr-2 size-4" />{mpesaSubmitting ? "Sending prompt…" : "Send payment prompt"}</Button>{mpesaRequest && <><span className="text-sm text-muted-foreground">Request status: <strong className="capitalize">{mpesaRequest.status}</strong>{mpesaRequest.message ? ` · ${mpesaRequest.message}` : ""}</span><Button variant="outline" onClick={() => void refreshMpesaStatus()} disabled={mpesaStatusLoading}>{mpesaStatusLoading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCw className="mr-2 size-4" />}Check status</Button></>}</div>
        <p className="text-xs text-muted-foreground">Daraja credentials and an HTTPS callback must be configured on the development API before this can initiate a real prompt. No live payments are enabled by this screen alone.</p>
      </CardContent></Card>}
      <section className="grid gap-4 sm:grid-cols-2">
        <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardDescription>Recorded payments</CardDescription><Banknote className="size-5 text-muted-foreground" /></CardHeader><CardContent><CardTitle className="text-2xl tabular-nums">{loading ? "—" : payments.length}</CardTitle><p className="mt-1 text-sm text-muted-foreground">Persisted invoice payment reports</p></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardDescription>Total confirmed</CardDescription><Receipt className="size-5 text-muted-foreground" /></CardHeader><CardContent><CardTitle className="text-2xl tabular-nums">{loading ? "—" : formatKES(totalRecorded)}</CardTitle><p className="mt-1 text-sm text-muted-foreground">Confirmed ERP receipts; provider verification is separate</p></CardContent></Card>
      </section>
      {actionError && <div role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{actionError}</div>}
      <Card><CardHeader><CardTitle>Payment activity</CardTitle><CardDescription>{invoiceCount} invoice(s) checked. Pending manual reports do not update invoice balances or accounting until an authorized user confirms them. Daraja STK requests are tracked separately and verified callbacks reconcile automatically when they match.</CardDescription></CardHeader><CardContent>
        {loading ? <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading payment records…</div> : error ? <div className="py-8 text-sm text-muted-foreground">Payment activity could not be loaded.</div> : payments.length === 0 ? <EmptyState icon={Banknote} title="No payment records yet" description="When a payment is recorded against an invoice, its persisted details will appear here. No sample transactions are shown." /> :
          <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Customer</TableHead><TableHead>Date recorded</TableHead><TableHead>Method</TableHead><TableHead>Reference</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{payments.map((payment) => <TableRow key={payment.id}><TableCell className="font-medium">{payment.invoice_number}</TableCell><TableCell className="max-w-48 truncate">{payment.customer_name}</TableCell><TableCell>{formatDateTime(payment.status === "pending" ? payment.created_at : payment.paid_at || payment.created_at)}</TableCell><TableCell>{methodLabel[payment.method] ?? payment.method}</TableCell><TableCell className="max-w-40 truncate">{payment.reference || "—"}</TableCell><TableCell className="text-right font-medium tabular-nums">{formatKES(Number(payment.amount))}</TableCell><TableCell><span className="inline-flex rounded-full border px-2 py-1 text-xs capitalize">{payment.status.replaceAll("_", " ")}</span></TableCell><TableCell className="text-right"><div className="flex items-center justify-end gap-2">{(payment.status === "confirmed" || payment.status === "reconciled") && <Button size="icon-sm" variant="outline" onClick={() => printReceipt(payment)} aria-label="Download or print payment receipt"><Download className="size-4" /></Button>}{payment.status === "pending" && canVerifyPayments ? <div className="flex items-center justify-end gap-2"><Button size="sm" variant="outline" disabled={confirmingId !== null || reconcilingId !== null} onClick={() => void confirmPayment(payment)}>{confirmingId === payment.id ? <Loader2 className="mr-2 size-3.5 animate-spin" /> : <CheckCircle2 className="mr-2 size-3.5" />}Confirm</Button><Button size="sm" variant="ghost" disabled={confirmingId !== null || reconcilingId !== null} onClick={() => void rejectPayment(payment)} aria-label="Reject payment report"><XCircle className="size-4" /></Button></div> : payment.status === "confirmed" && canReconcilePayments ? <div className="flex min-w-56 items-center justify-end gap-2"><input aria-label="Bank statement reference" className="h-9 w-36 rounded-md border bg-background px-2 text-xs" placeholder="Statement ref" maxLength={120} value={statementReferences[payment.id] || ""} onChange={(event) => setStatementReferences((current) => ({ ...current, [payment.id]: event.target.value }))} /><Button size="sm" variant="outline" disabled={reconcilingId !== null || confirmingId !== null} onClick={() => void reconcilePayment(payment)}>{reconcilingId === payment.id ? <Loader2 className="mr-2 size-3.5 animate-spin" /> : null}Reconcile</Button></div> : payment.status === "reconciled" ? <span className="text-xs text-muted-foreground">{payment.reconciliation_reference || "Reconciled"}{payment.reconciled_at ? ` · ${formatDateTime(payment.reconciled_at)}` : ""}</span> : payment.verified_at ? <span className="text-xs text-muted-foreground">Verified {formatDateTime(payment.verified_at)}</span> : payment.status === "pending" ? <span className="text-xs text-muted-foreground">Awaiting verification</span> : "—"}</div></TableCell></TableRow>)}</TableBody></Table></div>}
      </CardContent></Card>
      <p className="text-xs text-muted-foreground">M-Pesa STK Push callbacks are verified against Daraja STK Query before automatic reconciliation. Manual payment reports still require an authorized user to verify them; bank-statement imports are not integrated.</p>
    </div>
  </BaseLayout>;
}
