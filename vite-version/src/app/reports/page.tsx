import * as React from "react";
import { AlertCircle, Download, FileBarChart, Loader2, Printer, RefreshCw } from "lucide-react";
import { BaseLayout } from "@/components/layouts/base-layout";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api-client";
import { formatDate, formatKES } from "@/lib/format";
import type { InvoiceApiRow } from "@/lib/api-types";

function errorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") return (error as { message: string }).message;
  return "The request failed. Please try again.";
}
function csvCell(value: unknown) {
  let text = value == null ? "" : String(value);
  // Prevent spreadsheet formula execution when business-entered text is opened in Excel/Sheets.
  if (/^[=+@\t\r]/.test(text) || /^-/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); };

export default function ReportsPage() {
  const [invoices, setInvoices] = React.useState<InvoiceApiRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [fromDate, setFromDate] = React.useState(monthStart);
  const [toDate, setToDate] = React.useState(today);

  const load = React.useCallback(async () => {
    setLoading(true); setError("");
    try { setInvoices(await api.get<InvoiceApiRow[]>("/invoices")); }
    catch (e) { setError(errorMessage(e)); }
    finally { setLoading(false); }
  }, []);
  React.useEffect(() => { let active=true; void api.get<InvoiceApiRow[]>("/invoices").then(result=>{if(active)setInvoices(result);}).catch(e=>{if(active)setError(errorMessage(e));}).finally(()=>{if(active)setLoading(false);}); return()=>{active=false;}; }, []);

  const filtered = React.useMemo(() => invoices.filter((invoice) => {
    const date = String(invoice.issue_date).slice(0, 10);
    return (!fromDate || date >= fromDate) && (!toDate || date <= toDate);
  }), [invoices, fromDate, toDate]);
  const total = filtered.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
  const paid = filtered.reduce((sum, invoice) => sum + Number(invoice.amount_paid || 0), 0);
  const outstanding = filtered.filter((invoice) => invoice.status !== "cancelled").reduce((sum, invoice) => sum + Math.max(0, Number(invoice.total || 0) - Number(invoice.amount_paid || 0) - Number(invoice.credited_amount || 0)), 0);
  const exportCsv = () => downloadCsv("omega-invoices-quickbooks-export.csv", [
    ["Invoice No", "Customer", "Invoice Date", "Due Date", "Subtotal", "Tax Amount", "Total", "Amount Paid", "Balance", "Status", "Currency", "Memo"],
    ...filtered.map((invoice) => [
      invoice.invoice_number, invoice.customer_name, String(invoice.issue_date).slice(0, 10), String(invoice.due_date).slice(0, 10),
      Number(invoice.subtotal), Number(invoice.tax_amount), Number(invoice.total), Number(invoice.amount_paid),
      Math.max(0, Number(invoice.total) - Number(invoice.amount_paid) - Number(invoice.credited_amount || 0)), invoice.status, invoice.currency || "KES", invoice.notes || "",
    ]),
  ]);
  const printReport = () => window.print();

  return <BaseLayout>
    <div className="print-report flex flex-col gap-6 px-4 lg:px-6">
      <PageHeader title="Reports" description="Review invoice activity for a date range and export accounting-friendly reports from your company's live records." action={<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={printReport}><Printer className="size-4" />Print report</Button><Button onClick={exportCsv} disabled={loading || filtered.length === 0}><Download className="size-4" />Export invoices CSV</Button></div>} />
      {error && <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 p-3 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" /><span>{error}</span><Button variant="outline" size="sm" className="ml-auto" onClick={() => void load()}><RefreshCw className="size-4" />Retry</Button></div>}
      <Card><CardContent className="flex flex-col gap-4 p-4">
        <h2 className="font-semibold">Report filters</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5"><label htmlFor="report-from" className="text-sm text-muted-foreground">Invoice date from</label><Input id="report-from" type="date" value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} /></div>
          <div className="flex flex-col gap-1.5"><label htmlFor="report-to" className="text-sm text-muted-foreground">Invoice date to</label><Input id="report-to" type="date" value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} /></div>
        </div>
      </CardContent></Card>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Invoices in range</p><p className="mt-2 text-2xl font-semibold tabular-nums">{loading ? "—" : filtered.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Invoice total</p><p className="mt-2 text-2xl font-semibold tabular-nums">{loading ? "—" : formatKES(total)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Amount paid</p><p className="mt-2 text-2xl font-semibold tabular-nums">{loading ? "—" : formatKES(paid)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Outstanding balance</p><p className="mt-2 text-2xl font-semibold tabular-nums">{loading ? "—" : formatKES(outstanding)}</p></CardContent></Card>
      </div>
      <Card><CardContent className="flex flex-col gap-4 p-4">
        <div><h2 className="font-semibold">Invoice report</h2><p className="text-sm text-muted-foreground">Export a clean invoice register for spreadsheet review and accounting reconciliation. This is a report export, not a direct QuickBooks invoice-import file.</p></div>
        {loading ? <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading invoice records…</div> : filtered.length === 0 ? <EmptyState icon={FileBarChart} title={invoices.length ? "No invoices in this date range" : "No invoice records yet"} description={invoices.length ? "Change the date range to view other invoices." : "Invoices will appear here once your company records them."} /> : <>
          <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Invoice #</TableHead><TableHead>Customer</TableHead><TableHead>Issue date</TableHead><TableHead>Due date</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Balance</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{filtered.map((invoice) => <TableRow key={invoice.id}><TableCell className="font-medium">{invoice.invoice_number}</TableCell><TableCell>{invoice.customer_name}</TableCell><TableCell>{formatDate(invoice.issue_date)}</TableCell><TableCell>{formatDate(invoice.due_date)}</TableCell><TableCell className="text-right tabular-nums">{formatKES(Number(invoice.total))}</TableCell><TableCell className="text-right tabular-nums">{formatKES(Number(invoice.amount_paid))}</TableCell><TableCell className="text-right tabular-nums">{formatKES(Math.max(0, Number(invoice.total) - Number(invoice.amount_paid) - Number(invoice.credited_amount || 0)))}</TableCell><TableCell className="capitalize">{invoice.status.replaceAll("_", " ")}</TableCell></TableRow>)}</TableBody></Table></div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm text-muted-foreground"><span>{filtered.length} invoice(s)</span><span>Showing issue dates {fromDate || "any time"} to {toDate || "any time"}</span></div>
        </>}
      </CardContent></Card>
    </div>
    <style>{'@media print { body * { visibility: hidden; } .print-report, .print-report * { visibility: visible; } button, input { display: none !important; } .print-report { position: absolute; left: 0; top: 0; width: 100%; padding: 0; } }'}</style>
  </BaseLayout>;
}
