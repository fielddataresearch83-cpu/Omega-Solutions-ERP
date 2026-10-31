import * as React from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle, ArrowDownRight, ArrowUpRight, Banknote, Boxes, FilePlus2,
  Loader2, Package, Receipt, RefreshCw, Store, Users,
} from "lucide-react";
import { BaseLayout } from "@/components/layouts/base-layout";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api-client";
import { useAuth } from "@/contexts/auth-context";
import { formatDate, formatKES, formatNumber } from "@/lib/format";
import type { CustomerRow, InvoiceApiRow, ProductRow } from "@/lib/api-types";

type SalesData = { invoices: InvoiceApiRow[]; customers: CustomerRow[]; products: ProductRow[] };
type TeamMember = { user_id: string; full_name: string; role: string; invoice_count: number; sales_total: number | string; collected_total: number | string; outstanding_total: number | string };
type SalespersonAssignment = { warehouse_id: string; warehouse_name: string; warehouse_code: string; salesperson_name: string } | null;
function message(error: unknown) {
  return error && typeof error === "object" && "message" in error && typeof error.message === "string"
    ? error.message : "Unable to load sales data. Please try again.";
}
function Metric({ title, value, detail, icon: Icon, href }: {
  title: string; value: string; detail: string; icon: React.ElementType; href: string;
}) {
  return <Card className="min-w-0">
    <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-2">
      <div className="min-w-0 space-y-1"><CardDescription>{title}</CardDescription><CardTitle className="break-words text-2xl tabular-nums">{value}</CardTitle></div>
      <div className="shrink-0 rounded-lg bg-muted p-2"><Icon className="size-5 text-muted-foreground" aria-hidden="true" /></div>
    </CardHeader>
    <CardContent className="flex items-center justify-between gap-2"><p className="text-sm text-muted-foreground">{detail}</p><Link to={href} className={buttonVariants({ variant: "ghost", size: "sm" })}>Open <ArrowUpRight className="ml-1 size-3.5" /></Link></CardContent>
  </Card>;
}

export default function SalesDashboardPage() {
  const { user } = useAuth();
  const canViewTeam = Boolean(user?.permissions.includes("sales:team-read"));
  const [data, setData] = React.useState<SalesData>({ invoices: [], customers: [], products: [] });
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [team, setTeam] = React.useState<TeamMember[]>([]);
  const [assignment, setAssignment] = React.useState<SalespersonAssignment>(null);
  const load = React.useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [invoices, customers, products, teamSummary, salespersonAssignment] = await Promise.all([
        canViewTeam ? api.get<InvoiceApiRow[]>("/invoices") : Promise.resolve([] as InvoiceApiRow[]),
        canViewTeam ? api.get<CustomerRow[]>("/customers") : Promise.resolve([] as CustomerRow[]),
        canViewTeam ? api.get<ProductRow[]>("/products") : Promise.resolve([] as ProductRow[]),
        canViewTeam ? api.get<TeamMember[]>("/invoices/team-summary") : Promise.resolve([] as TeamMember[]),
        canViewTeam ? Promise.resolve(null) : api.get<SalespersonAssignment>("/pos/salesperson-assignment/me"),
      ]);
      setData({ invoices, customers, products });
      setTeam(teamSummary);
      setAssignment(salespersonAssignment);
    } catch (err) { setError(message(err)); }
    finally { setLoading(false); }
  }, [canViewTeam]);
  React.useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const activeCustomers = data.customers.filter((customer) => customer.is_active);
  const activeProducts = data.products.filter((product) => product.is_active && !product.is_service);
  const lowStock = activeProducts.filter((product) => Number(product.stock_quantity) <= Number(product.reorder_level));
  const openInvoices = data.invoices.filter((invoice) => !["paid", "cancelled", "draft"].includes(invoice.status));
  const outstanding = openInvoices.reduce((sum, invoice) => sum + Math.max(0, Number(invoice.total) - Number(invoice.amount_paid)), 0);
  const collected = data.invoices.reduce((sum, invoice) => sum + Number(invoice.amount_paid || 0), 0);
  const recent = [...data.invoices].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 8);

  return <BaseLayout>
    <div className="mx-auto flex w-full max-w-screen-2xl min-w-0 flex-col gap-6 px-4 sm:px-6 lg:px-8">
      <PageHeader title="Sales Dashboard" description="Work with live company customers, invoices, collections and stock alerts." action={<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-2 size-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button>{canViewTeam ? <Link to="/invoices" className={buttonVariants()}><FilePlus2 className="mr-2 size-4" />Create invoice</Link> : <Link to="/pos" className={buttonVariants()}><Store className="mr-2 size-4" />Open POS</Link>}{canViewTeam && <Link to="/salesperson-stock" className={buttonVariants({variant:"outline"})}><Boxes className="mr-2 size-4"/>Salesperson stock</Link>}</div>} />
      {error && <div role="alert" className="flex flex-col gap-3 rounded-lg border border-destructive/30 p-4 text-sm text-destructive sm:flex-row sm:items-center"><AlertCircle className="size-4 shrink-0" /><span className="flex-1">{error}</span><Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button></div>}
      {loading ? <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading live sales data…</div> : !error && <>
        {!canViewTeam && <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Store className="size-5" />Your selling workspace</CardTitle><CardDescription>Sell from the stock location assigned to you. Your assigned warehouse is enforced by the API.</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              {assignment ? <><p className="font-medium">{assignment.warehouse_name}</p><p className="text-sm text-muted-foreground">Warehouse code: {assignment.warehouse_code}</p></> : <p className="text-sm text-muted-foreground">No warehouse has been assigned to your account yet. Ask your manager to assign your stock before starting a sale.</p>}
            </div>
            <Link to="/pos" className={buttonVariants({ className: "shrink-0" })}><Store className="mr-2 size-4" />Open point of sale</Link>
          </CardContent>
        </Card>}
        {canViewTeam && <>
        <section className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric title="Invoices" value={formatNumber(data.invoices.filter((invoice) => invoice.status !== "cancelled").length)} detail="All invoice statuses" icon={Receipt} href="/invoices" />
          <Metric title="Outstanding" value={formatKES(outstanding)} detail="Unpaid balance on sent invoices" icon={Banknote} href="/payments" />
          <Metric title="Recorded collections" value={formatKES(collected)} detail="Amounts recorded against invoices" icon={ArrowUpRight} href="/payments" />
          <Metric title="Active customers" value={formatNumber(activeCustomers.length)} detail="Available to sell to" icon={Users} href="/customers" />
        </section>
        <section className="grid min-w-0 gap-4 xl:grid-cols-3">
          <Card className="min-w-0 xl:col-span-2">
            <CardHeader><CardTitle>Recent invoices</CardTitle><CardDescription>Latest invoice records from your company account. Managers can use the invoice status to monitor follow-up.</CardDescription></CardHeader>
            <CardContent>
              {recent.length === 0 ? <div className="flex min-h-32 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground"><Receipt className="size-6" />No invoices yet. Create an invoice when you are ready to record a sale.<Link to="/invoices" className={buttonVariants({ variant: "outline", size: "sm" })}>Create first invoice</Link></div> :
                <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Customer</TableHead><TableHead className="hidden sm:table-cell">Due</TableHead><TableHead className="text-right">Balance</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{recent.map((invoice) => {
                  const balance = Math.max(0, Number(invoice.total) - Number(invoice.amount_paid));
                  return <TableRow key={invoice.id}><TableCell><Link to="/invoices" className="font-medium underline-offset-4 hover:underline">{invoice.invoice_number}</Link></TableCell><TableCell className="max-w-40 truncate">{invoice.customer_name}</TableCell><TableCell className="hidden sm:table-cell text-muted-foreground">{formatDate(invoice.due_date)}</TableCell><TableCell className="text-right tabular-nums">{formatKES(balance)}</TableCell><TableCell><span className="inline-flex rounded-full border px-2 py-1 text-xs capitalize">{invoice.status.replaceAll("_", " ")}</span></TableCell></TableRow>;
                })}</TableBody></Table></div>}
              <div className="mt-4 flex flex-wrap gap-2"><Link to="/invoices" className={buttonVariants({ variant: "outline", size: "sm" })}>All invoices</Link><Link to="/payments" className={buttonVariants({ variant: "outline", size: "sm" })}>Payment records</Link></div>
            </CardContent>
          </Card>
          <div className="flex min-w-0 flex-col gap-4">
            <Card><CardHeader><CardTitle className="flex items-center gap-2"><Boxes className="size-5" />Stock alerts</CardTitle><CardDescription>Active physical products at or below reorder level</CardDescription></CardHeader><CardContent>
              {lowStock.length === 0 ? <p className="py-3 text-sm text-muted-foreground">No products currently meet the configured low-stock threshold.</p> : <><p className="text-2xl font-semibold tabular-nums">{lowStock.length}</p><p className="mt-1 text-sm text-muted-foreground">Products need stock review before fulfilling more sales.</p><ul className="mt-3 space-y-2">{lowStock.slice(0, 5).map((product) => <li key={product.id} className="flex items-start justify-between gap-3 border-t pt-2 text-sm"><span className="min-w-0 truncate">{product.name}</span><span className="shrink-0 tabular-nums">{formatNumber(Number(product.stock_quantity))} on hand</span></li>)}</ul></>}
              <Link to="/stock-levels" className={buttonVariants({ variant: "outline", size: "sm", className: "mt-4 w-full" })}><Package className="mr-2 size-4" />Review stock</Link>
            </CardContent></Card>
            <Card><CardHeader><CardTitle className="flex items-center gap-2"><ArrowDownRight className="size-5" />Sales shortcuts</CardTitle><CardDescription>Common tasks</CardDescription></CardHeader><CardContent className="grid gap-2"><Link to="/customers" className={buttonVariants({ variant: "outline", className: "justify-start" })}><Users className="mr-2 size-4" />Find a customer</Link><Link to="/invoices" className={buttonVariants({ variant: "outline", className: "justify-start" })}><Receipt className="mr-2 size-4" />Create / view invoices</Link><Link to="/payments" className={buttonVariants({ variant: "outline", className: "justify-start" })}><Banknote className="mr-2 size-4" />Track payment records</Link></CardContent></Card>
          </div>
        </section>
        {canViewTeam && <Card>
          <CardHeader><CardTitle>Team sales performance</CardTitle><CardDescription>Company-wide performance grouped by the user who created each invoice. Drafts and cancelled invoices are excluded from sales totals.</CardDescription></CardHeader>
          <CardContent>{team.length === 0 ? <p className="py-6 text-sm text-muted-foreground">No active team members or invoice activity yet.</p> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Team member</TableHead><TableHead>Role</TableHead><TableHead className="text-right">Invoices</TableHead><TableHead className="text-right">Sales</TableHead><TableHead className="text-right">Collected</TableHead><TableHead className="text-right">Outstanding</TableHead></TableRow></TableHeader><TableBody>{team.map((member) => <TableRow key={member.user_id}><TableCell className="font-medium">{member.full_name}</TableCell><TableCell className="capitalize">{member.role}</TableCell><TableCell className="text-right tabular-nums">{formatNumber(member.invoice_count)}</TableCell><TableCell className="text-right tabular-nums">{formatKES(Number(member.sales_total))}</TableCell><TableCell className="text-right tabular-nums">{formatKES(Number(member.collected_total))}</TableCell><TableCell className="text-right tabular-nums">{formatKES(Number(member.outstanding_total))}</TableCell></TableRow>)}</TableBody></Table></div>}</CardContent>
        </Card>}
        </>}
        <p className="text-xs text-muted-foreground">Figures are based on company-scoped records. Collection totals represent confirmed ERP receipts; automatic M-Pesa verification and bank reconciliation are separate integrations.</p>
      </>}
    </div>
  </BaseLayout>;
}
