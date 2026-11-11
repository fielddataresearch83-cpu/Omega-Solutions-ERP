import * as React from "react"
import { Link } from "react-router-dom"
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  BriefcaseBusiness,
  CalendarDays,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  FilePlus2,
  Package,
  ReceiptText,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { buttonVariants } from "@/components/ui/button"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { api } from "@/lib/api-client"
import { formatNumber } from "@/lib/format"
import { useMyCompany } from "@/hooks/use-company"
import { useAuth } from "@/contexts/auth-context"
import {
  Bar,
  BarChart,
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

type DashboardSummary = {
  currency: string
  accessMode: "legacy_unmetered" | "subscription"
  subscription: null | { status: string }
  modules: Record<string, boolean>
  customers: null | { count: number; receivables: number | null }
  suppliers: null | { count: number; payables: number }
  inventory: null | {
    activeProducts: number
    lowStock: number
    costValue: number
    lowStockProducts: Array<{
      id: string
      name: string
      sku: string
      stock_quantity: number
      reorder_level: number
    }>
  }
  invoiceTrend: null | Array<{ key: string; total: number }>
  overdueInvoices: null | Array<{
    id: string
    invoice_number: string
    customer_name: string
    due_date: string
    currency: string
    balance: number
  }>
  sales: null | {
    currentPeriodInvoiced: number
    previousPeriodInvoiced: number
    currentPeriodCollected: number
    previousPeriodCollected: number
    creditNotesCurrentPeriod: number
    periodStart: string
    periodEnd: string
    previousPeriodStart: string
    previousPeriodEnd: string
  }
  expenses: null | {
    currentPeriod: number
    previousPeriod: number
    periodStart: string
    periodEnd: string
    previousPeriodStart: string
    previousPeriodEnd: string
  }
  topProducts: null | Array<{ id: string; name: string; sku: string; quantity: number; revenue: number }>
  categoryBreakdown: null | Array<{ category: string; revenue: number }>
}

type MetricTone = "emerald" | "blue" | "violet" | "amber"

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  href,
  tone,
}: {
  label: string
  value: string
  detail: string
  icon: React.ElementType
  href: string
  tone: MetricTone
}) {
  const tones: Record<MetricTone, { icon: string; accent: string }> = {
    emerald: { icon: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", accent: "from-emerald-500 to-teal-400" },
    blue: { icon: "bg-sky-500/10 text-sky-600 dark:text-sky-400", accent: "from-sky-500 to-cyan-400" },
    violet: { icon: "bg-violet-500/10 text-violet-600 dark:text-violet-400", accent: "from-violet-500 to-indigo-400" },
    amber: { icon: "bg-amber-500/10 text-amber-600 dark:text-amber-400", accent: "from-amber-500 to-orange-400" },
  }
  const style = tones[tone]

  return (
    <Card className="group relative min-w-0 overflow-hidden rounded-2xl border-border/70 bg-card shadow-[0_2px_12px_rgb(15_23_42/0.035)] transition-all duration-200 hover:-translate-y-1 hover:border-primary/25 hover:shadow-[0_14px_34px_rgb(15_23_42/0.09)] dark:shadow-[0_8px_24px_rgb(0_0_0/0.12)] dark:hover:shadow-[0_16px_36px_rgb(0_0_0/0.25)]">
      <div className={"absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r " + style.accent} />
      <CardContent className="flex min-h-[158px] flex-col justify-between p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
            <p className="mt-3 break-words text-[1.85rem] font-bold leading-none tracking-[-0.055em] text-foreground sm:text-[2rem]">{value}</p>
          </div>
          <div className={"flex size-11 shrink-0 items-center justify-center rounded-2xl " + style.icon}>
            <Icon className="size-[19px]" strokeWidth={1.9} aria-hidden="true" />
          </div>
        </div>
        <div className="mt-5 flex items-center justify-between gap-2 border-t border-border/70 pt-3">
          <span className="min-w-0 text-[11px] leading-relaxed text-muted-foreground">{detail}</span>
          <Link to={href} aria-label={"Open " + label.toLowerCase()} className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-primary transition group-hover:gap-1.5">
            Open <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}

function SectionHeading({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-[15px] font-bold tracking-tight text-foreground">{title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </div>
      {action}
    </div>
  )
}

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <Card className={"min-w-0 overflow-hidden rounded-2xl border-border/70 bg-card shadow-[0_2px_14px_rgb(15_23_42/0.035)] dark:shadow-[0_8px_28px_rgb(0_0_0/0.13)] " + className}>{children}</Card>
}

export default function Page() {
  const { company, loading: companyLoading } = useMyCompany()
  const { user, loading: authLoading } = useAuth()
  const permissions = new Set(user?.permissions ?? [])
  const [retryKey, setRetryKey] = React.useState(0)
  const [dashboard, setDashboard] = React.useState<{
    data: DashboardSummary | null
    loading: boolean
    error: string | null
  }>({ data: null, loading: true, error: null })

  const requestKey = `${user?.userId ?? ""}:${company?.id ?? ""}:${retryKey}`
  const [loadedRequestKey, setLoadedRequestKey] = React.useState("")
  const dashboardLoading = authLoading || companyLoading || !user?.userId || loadedRequestKey !== requestKey

  React.useEffect(() => {
    if (authLoading || companyLoading || !user?.userId) return
    let active = true
    void api.get<DashboardSummary>("/dashboard/summary")
      .then((data) => {
        if (active) {
          setDashboard({ data, loading: false, error: null })
          setLoadedRequestKey(requestKey)
        }
      })
      .catch((error: { message?: string }) => {
        if (active) {
          setDashboard({ data: null, loading: false, error: error.message ?? "Could not load dashboard summary." })
          setLoadedRequestKey(requestKey)
        }
      })
    return () => { active = false }
  }, [authLoading, companyLoading, user?.userId, company?.id, retryKey, requestKey])

  const canUseModule = (moduleCode: string) => {
    if (dashboardLoading || !dashboard.data) return false
    if (!dashboard.data.subscription || !["active", "trialing"].includes(dashboard.data.subscription.status)) return false
    return dashboard.data.modules?.[moduleCode] === true
  }
  const canReadSales = canUseModule("sales") && permissions.has("sales:read")
  const canReadCustomers = canUseModule("sales") && permissions.has("customers:read")
  const canReadProcurement = canUseModule("procurement") && permissions.has("suppliers:read") && Boolean(dashboard.data?.suppliers)
  const canReadProducts = canUseModule("inventory") && permissions.has("products:read") && Boolean(dashboard.data?.inventory)
  const canReadExpenses = canUseModule("accounting") && permissions.has("expenses:read")

  const sales = dashboard.data?.sales ?? null
  const expenses = dashboard.data?.expenses ?? null
  const topProducts = dashboard.data?.topProducts ?? null
  const categoryBreakdown = dashboard.data?.categoryBreakdown ?? null
  const invoicedDelta = sales && sales.previousPeriodInvoiced > 0
    ? ((sales.currentPeriodInvoiced - sales.previousPeriodInvoiced) / sales.previousPeriodInvoiced) * 100
    : null
  const collectedDelta = sales && sales.previousPeriodCollected > 0
    ? ((sales.currentPeriodCollected - sales.previousPeriodCollected) / sales.previousPeriodCollected) * 100
    : null
  const expenseDelta = expenses && expenses.previousPeriod > 0
    ? ((expenses.currentPeriod - expenses.previousPeriod) / expenses.previousPeriod) * 100
    : null
  const monthLabel = sales ? new Date(sales.periodStart + "T00:00:00").toLocaleDateString(undefined, { month: "long" }) : ""

  const loading = authLoading || companyLoading || dashboardLoading
  const activeProducts = dashboard.data?.inventory?.activeProducts ?? 0
  const lowStockCount = dashboard.data?.inventory?.lowStock ?? 0
  const lowStockProducts = dashboard.data?.inventory?.lowStockProducts ?? []
  const inventoryCost = dashboard.data?.inventory?.costValue ?? 0
  const receivables = dashboard.data?.customers?.receivables ?? null
  const payables = dashboard.data?.suppliers?.payables ?? null
  const currency = dashboard.data?.currency || company?.currency || "KES"

  const formatCompanyCurrency = (value: number) => new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value)

  const invoiceTrend = React.useMemo(() => {
    const months: { key: string; label: string; total: number }[] = []
    const now = new Date()
    for (let offset = 5; offset >= 0; offset -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - offset, 1)
      const key = String(date.getFullYear()) + "-" + String(date.getMonth() + 1).padStart(2, "0")
      months.push({ key, label: date.toLocaleDateString(undefined, { month: "short" }), total: 0 })
    }
    const byMonth = new Map(months.map((month) => [month.key, month]))
    for (const month of dashboard.data?.invoiceTrend ?? []) {
      const bucket = byMonth.get(month.key)
      if (bucket) bucket.total = month.total
    }
    return months
  }, [dashboard.data?.invoiceTrend])

  const overdueInvoices = dashboard.data?.overdueInvoices ?? []
  const greeting = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening"
  const today = new Date().toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })

  return (
    <BaseLayout>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-7 px-4 pb-8 pt-3 sm:px-6 lg:gap-8 lg:px-8">
        <section className="relative isolate overflow-hidden rounded-[1.65rem] bg-[#102A43] px-5 py-6 text-white shadow-[0_16px_44px_rgb(16_42_67/0.18)] sm:px-8 sm:py-8 lg:px-9">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_82%_10%,rgb(52_213_154/0.24),transparent_35%),radial-gradient(ellipse_at_8%_100%,rgb(42_104_145/0.35),transparent_42%)]" />
          <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-28 -z-10 size-[22rem] rounded-full border border-white/[0.07]" />
          <div aria-hidden="true" className="pointer-events-none absolute -right-2 -top-14 -z-10 size-[17rem] rounded-full border border-white/[0.07]" />
          <div className="flex flex-col gap-7 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-2xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.17em] text-emerald-200">
                <Sparkles className="size-3.5" /> Business overview
              </div>
              <p className="text-sm font-medium text-slate-300">{today}</p>
              <h1 className="mt-2 text-[2rem] font-bold leading-tight tracking-[-0.055em] sm:text-[2.65rem]">
                {greeting}{user?.firstName ? ", " + user.firstName : ""}.
              </h1>
              <p className="mt-3 max-w-xl text-[13px] leading-6 text-slate-300 sm:text-sm">
                {companyLoading ? "Preparing your business overview…" : company ? "Here’s what’s happening at " + company.name + ". Your key records and priorities, all in one place." : "Your key business records and priorities, all in one place."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canReadSales && (
                <Link to="/invoices" className={buttonVariants({ className: "h-10 rounded-xl border border-emerald-300/30 bg-emerald-400 px-4 text-xs font-bold text-[#102A43] shadow-lg shadow-emerald-950/15 hover:bg-emerald-300" })}>
                  <FilePlus2 className="mr-2 size-4" /> Create invoice
                </Link>
              )}
              {canReadProducts && (
                <Link to="/products" className={buttonVariants({ variant: "outline", className: "h-10 rounded-xl border-white/20 bg-white/[0.07] px-4 text-xs font-semibold text-white hover:bg-white/[0.13] hover:text-white" })}>
                  <Package className="mr-2 size-4" /> View inventory
                </Link>
              )}
            </div>
          </div>
          <div className="mt-7 grid grid-cols-1 gap-3 border-t border-white/10 pt-5 sm:grid-cols-3">
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-xl bg-white/10 text-emerald-200"><CalendarDays className="size-4" /></span>
              <div><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Workspace</p><p className="mt-0.5 text-xs font-semibold text-white">{company?.name ?? "Your company"}</p></div>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-xl bg-white/10 text-emerald-200"><TrendingUp className="size-4" /></span>
              <div><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Reporting currency</p><p className="mt-0.5 text-xs font-semibold text-white">{currency}</p></div>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-xl bg-white/10 text-emerald-200"><CheckCircle2 className="size-4" /></span>
              <div><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Data scope</p><p className="mt-0.5 text-xs font-semibold text-white">Current company</p></div>
            </div>
          </div>
        </section>

        {dashboard.error && !loading && (
          <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-destructive/20 bg-destructive/[0.05] p-4 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div className="rounded-xl bg-destructive/10 p-2 text-destructive"><CircleAlert className="size-5" /></div>
              <div><p className="text-sm font-semibold text-foreground">Dashboard data needs attention</p><p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">{dashboard.error}</p></div>
            </div>
            <button type="button" onClick={() => setRetryKey((value) => value + 1)} className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-destructive/20 px-3 text-xs font-semibold text-destructive transition hover:bg-destructive/10">
              <RefreshCw className="size-3.5" /> Retry
            </button>
          </div>
        )}

        <section aria-label="Business summary">
          <SectionHeading title="Business snapshot" detail="Your accessible business records at a glance" />
          {loading ? (
            <div className="flex min-h-44 items-center justify-center rounded-2xl border border-border bg-card"><LoadingSpinner /></div>
          ) : (
            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {canReadCustomers && <MetricCard label="Customers" value={formatNumber(dashboard.data?.customers?.count ?? 0)} detail="In your customer directory" icon={Users} href="/customers" tone="emerald" />}
              {canReadProcurement && dashboard.data?.suppliers && <MetricCard label="Suppliers" value={formatNumber(dashboard.data.suppliers.count)} detail="In your supplier directory" icon={BriefcaseBusiness} href="/suppliers" tone="blue" />}
              {canReadProducts && <MetricCard label="Active products" value={formatNumber(activeProducts)} detail={lowStockCount + " at or below reorder level"} icon={Boxes} href="/products" tone="violet" />}
              {canReadProducts && <MetricCard label="Inventory value" value={formatCompanyCurrency(inventoryCost)} detail="Recorded stock cost value" icon={Package} href="/products" tone="amber" />}
              {!canReadCustomers && !canReadProcurement && !canReadProducts && (
                <div className="col-span-full rounded-2xl border border-dashed border-border bg-card px-5 py-8 text-center">
                  <div className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground"><Wallet className="size-5" /></div>
                  <p className="mt-3 text-sm font-semibold text-foreground">Your overview is being kept private</p>
                  <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">Your current role or subscription does not provide access to these summary metrics.</p>
                </div>
              )}
            </div>
          )}
        </section>

        {canReadSales && (
          <section className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.9fr)]" aria-label="Sales and invoices">
            <Panel>
              <CardHeader className="flex flex-row items-start justify-between gap-3 border-b border-border/70 px-5 pb-4 pt-5 sm:px-6">
                <div>
                  <div className="flex items-center gap-2"><span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgb(16_185_129/0.12)]" /><CardTitle className="text-sm font-bold">Invoice performance</CardTitle></div>
                  <CardDescription className="mt-1.5 text-xs">Monthly invoice totals · last six months · {currency}</CardDescription>
                </div>
                <Link to="/invoices" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[11px] font-semibold text-foreground transition hover:border-primary/30 hover:bg-primary/[0.04] hover:text-primary">All invoices <ArrowUpRight className="size-3.5" /></Link>
              </CardHeader>
              <CardContent className="px-3 pb-4 pt-5 sm:px-5">
                {invoiceTrend.every((month) => month.total === 0) ? (
                  <div className="flex min-h-60 flex-col items-center justify-center gap-2 text-center">
                    <div className="rounded-2xl bg-primary/10 p-3 text-primary"><TrendingUp className="size-5" /></div>
                    <p className="text-sm font-semibold text-foreground">No invoice activity yet</p>
                    <p className="text-xs text-muted-foreground">Monthly totals will appear here as invoices are recorded.</p>
                  </div>
                ) : (
                  <div className="h-[270px] w-full" role="img" aria-label="Monthly invoice totals chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={invoiceTrend} margin={{ top: 12, right: 12, bottom: 0, left: -12 }}>
                        <defs><linearGradient id="omegaInvoiceArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.28} /><stop offset="75%" stopColor="var(--chart-1)" stopOpacity={0.04} /><stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} /></linearGradient></defs>
                        <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="3 6" />
                        <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickMargin={12} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} tickMargin={8} width={58} tickFormatter={(value: number) => value >= 1000000 ? (value / 1000000).toFixed(1) + "m" : value >= 1000 ? Math.round(value / 1000) + "k" : String(value)} />
                        <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--popover-foreground)", fontSize: 12, boxShadow: "0 8px 24px rgb(0 0 0 / 10%)" }} formatter={(value) => [formatCompanyCurrency(Number(value)), "Invoice total"]} labelFormatter={(label) => "Month: " + label} />
                        <Area type="monotone" dataKey="total" stroke="none" fill="url(#omegaInvoiceArea)" isAnimationActive animationDuration={550} />
                        <Line type="monotone" dataKey="total" name="Invoice total" stroke="var(--chart-1)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" dot={false} activeDot={{ r: 5, fill: "var(--chart-1)", stroke: "var(--background)", strokeWidth: 2 }} isAnimationActive animationDuration={650} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/70 px-2 pt-3 text-[10px] text-muted-foreground"><span>Based on invoice totals returned by your dashboard API</span><span className="inline-flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-400"><span className="size-1.5 rounded-full bg-emerald-500" /> Live company data</span></div>
              </CardContent>
            </Panel>

            <Panel>
              <CardHeader className="border-b border-border/70 px-5 pb-4 pt-5">
                <div className="flex items-center justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-sm font-bold"><CalendarClock className="size-4 text-amber-500" /> Receivables to review</CardTitle><CardDescription className="mt-1.5 text-xs">Invoices past their due date</CardDescription></div><span className={"rounded-full px-2.5 py-1 text-[10px] font-bold " + (overdueInvoices.length ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400")}>{overdueInvoices.length} overdue</span></div>
              </CardHeader>
              <CardContent className="px-5 pb-5 pt-2">
                {overdueInvoices.length === 0 ? (
                  <div className="flex min-h-52 flex-col items-center justify-center gap-2 text-center"><span className="flex size-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="size-6" /></span><p className="text-sm font-semibold text-foreground">You’re all caught up</p><p className="max-w-[220px] text-xs leading-relaxed text-muted-foreground">No overdue balances were returned for this company.</p></div>
                ) : (
                  <div className="divide-y divide-border/70">
                    {overdueInvoices.slice(0, 5).map((invoice) => (
                      <div key={invoice.id} className="flex min-w-0 items-center justify-between gap-3 py-3.5">
                        <div className="min-w-0"><Link to="/invoices" className="text-xs font-bold text-foreground underline-offset-4 hover:text-primary hover:underline">{invoice.invoice_number}</Link><p className="mt-1 truncate text-[11px] text-muted-foreground">{invoice.customer_name}</p><p className="mt-1 text-[10px] text-muted-foreground">Due {invoice.due_date}</p></div>
                        <p className="shrink-0 text-right text-xs font-bold tabular-nums text-destructive">{new Intl.NumberFormat("en-KE", { style: "currency", currency: invoice.currency || currency, maximumFractionDigits: 0 }).format(invoice.balance)}</p>
                      </div>
                    ))}
                    <Link to="/invoices" className="inline-flex items-center gap-1.5 pt-3 text-[11px] font-bold text-primary">Review all invoices <ArrowRight className="size-3.5" /></Link>
                  </div>
                )}
              </CardContent>
            </Panel>
          </section>
        )}

        {(canReadCustomers || canReadProcurement) && (
          <section aria-label="Financial balances">
            <SectionHeading title="Working capital" detail="Outstanding balances recorded in your company" />
            <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
              {canReadCustomers && dashboard.data?.customers && (
                <Panel className="relative">
                  <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-14 size-48 rounded-full bg-emerald-500/[0.07] blur-3xl" />
                  <CardContent className="relative p-5 sm:p-6">
                    <div className="flex items-start justify-between gap-4"><div><p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Customer receivables</p><p className="mt-3 break-words text-2xl font-bold tracking-[-0.045em] text-foreground sm:text-3xl">{receivables === null ? "—" : formatCompanyCurrency(receivables)}</p><p className="mt-2 text-xs text-muted-foreground">Outstanding balances due from customers</p></div><span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"><Wallet className="size-5" /></span></div>
                    <Link to="/customers" className="mt-5 inline-flex items-center gap-1.5 border-t border-border/70 pt-3 text-[11px] font-bold text-primary">Review customers <ChevronRight className="size-3.5" /></Link>
                  </CardContent>
                </Panel>
              )}
              {canReadProcurement && dashboard.data?.suppliers && (
                <Panel className="relative">
                  <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-14 size-48 rounded-full bg-amber-500/[0.07] blur-3xl" />
                  <CardContent className="relative p-5 sm:p-6">
                    <div className="flex items-start justify-between gap-4"><div><p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Supplier payables</p><p className="mt-3 break-words text-2xl font-bold tracking-[-0.045em] text-foreground sm:text-3xl">{payables === null ? "—" : formatCompanyCurrency(payables)}</p><p className="mt-2 text-xs text-muted-foreground">Outstanding balances owed to suppliers</p></div><span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400"><ArrowDownRight className="size-5" /></span></div>
                    <Link to="/suppliers" className="mt-5 inline-flex items-center gap-1.5 border-t border-border/70 pt-3 text-[11px] font-bold text-primary">Review suppliers <ChevronRight className="size-3.5" /></Link>
                  </CardContent>
                </Panel>
              )}
            </div>
          </section>
        )}

        {canReadProducts && (
          <section className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.85fr)]" aria-label="Inventory and quick actions">
            <Panel>
              <CardHeader className="flex flex-row items-start justify-between gap-3 border-b border-border/70 px-5 pb-4 pt-5 sm:px-6">
                <div><CardTitle className="flex items-center gap-2 text-sm font-bold"><Package className="size-4 text-primary" /> Stock requiring attention</CardTitle><CardDescription className="mt-1.5 text-xs">Products at or below their configured reorder level</CardDescription></div>
                <span className={"shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold tabular-nums " + (lowStockCount > 0 ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400")}>{lowStockCount} flagged</span>
              </CardHeader>
              <CardContent className="px-5 pb-5 pt-3 sm:px-6">
                {lowStockCount === 0 ? (
                  <div className="flex min-h-28 items-center gap-3 rounded-xl bg-emerald-500/[0.06] px-4 py-4 text-xs text-muted-foreground"><CheckCircle2 className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />No low-stock products in the records currently available.</div>
                ) : (
                  <div className="overflow-x-auto"><table className="w-full min-w-[27rem] text-xs"><thead><tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.08em] text-muted-foreground"><th className="py-3 pr-4 font-bold">Product</th><th className="py-3 pr-4 font-bold">SKU</th><th className="py-3 pr-4 text-right font-bold">On hand</th><th className="py-3 text-right font-bold">Reorder at</th></tr></thead><tbody>{lowStockProducts.slice(0, 6).map((product) => (<tr key={product.id} className="border-b border-border/70 last:border-0"><td className="max-w-52 truncate py-3.5 pr-4 font-semibold text-foreground">{product.name}</td><td className="py-3.5 pr-4 text-muted-foreground">{product.sku || "—"}</td><td className="py-3.5 pr-4 text-right font-bold tabular-nums text-amber-600 dark:text-amber-400">{formatNumber(Number(product.stock_quantity))}</td><td className="py-3.5 text-right tabular-nums text-muted-foreground">{formatNumber(Number(product.reorder_level))}</td></tr>))}</tbody></table></div>
                )}
                <Link to="/products" className="mt-4 inline-flex items-center gap-1.5 text-[11px] font-bold text-primary">Open product catalogue <ArrowRight className="size-3.5" /></Link>
              </CardContent>
            </Panel>

            <Panel>
              <CardHeader className="border-b border-border/70 px-5 pb-4 pt-5"><CardTitle className="text-sm font-bold">Quick actions</CardTitle><CardDescription className="mt-1.5 text-xs">Shortcuts to your everyday work</CardDescription></CardHeader>
              <CardContent className="divide-y divide-border/70 px-5 py-1">
                {canReadSales && <Link to="/invoices" className="group flex items-center gap-3 rounded-xl py-3.5 transition hover:bg-muted/70"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"><ReceiptText className="size-[18px]" /></span><span className="min-w-0 flex-1"><span className="block text-xs font-bold text-foreground">Sales invoices</span><span className="mt-1 block text-[10px] text-muted-foreground">Manage customer billing</span></span><ChevronRight className="size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" /></Link>}
                {canReadCustomers && <Link to="/customers" className="group flex items-center gap-3 rounded-xl py-3.5 transition hover:bg-muted/70"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400"><Users className="size-[18px]" /></span><span className="min-w-0 flex-1"><span className="block text-xs font-bold text-foreground">Manage customers</span><span className="mt-1 block text-[10px] text-muted-foreground">Open your customer directory</span></span><ChevronRight className="size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" /></Link>}
                {canReadProcurement && <Link to="/suppliers" className="group flex items-center gap-3 rounded-xl py-3.5 transition hover:bg-muted/70"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400"><BriefcaseBusiness className="size-[18px]" /></span><span className="min-w-0 flex-1"><span className="block text-xs font-bold text-foreground">Manage suppliers</span><span className="mt-1 block text-[10px] text-muted-foreground">Review supplier records</span></span><ChevronRight className="size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" /></Link>}
                {canReadProducts && <Link to="/products" className="group flex items-center gap-3 rounded-xl py-3.5 transition hover:bg-muted/70"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400"><Boxes className="size-[18px]" /></span><span className="min-w-0 flex-1"><span className="block text-xs font-bold text-foreground">Product catalogue</span><span className="mt-1 block text-[10px] text-muted-foreground">Check products and stock levels</span></span><ChevronRight className="size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" /></Link>}
                {!canReadSales && !canReadCustomers && !canReadProcurement && !canReadProducts && <p className="py-5 text-xs leading-relaxed text-muted-foreground">No quick actions are available for the current role and enabled modules.</p>}
                {lowStockCount > 0 && <div className="flex items-center gap-2 py-3 text-[11px] font-semibold text-amber-600 dark:text-amber-400"><ArrowDownRight className="size-4 shrink-0" />{lowStockCount} product{lowStockCount === 1 ? "" : "s"} need stock review.</div>}
              </CardContent>
            </Panel>
          </section>
        )}

        {canReadSales && sales && (
          <section aria-label="Sales performance this month">
            <SectionHeading title={"Sales performance · " + monthLabel} detail="Invoiced sales, collected payments and credit notes for the current month" />
            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Panel className="relative">
                <div aria-hidden className="pointer-events-none absolute -right-8 -top-12 size-40 rounded-full bg-emerald-500/[0.06] blur-3xl" />
                <CardContent className="relative p-5">
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Invoiced sales</p>
                  <p className="mt-3 break-words text-2xl font-bold tracking-[-0.045em] text-foreground sm:text-3xl">{formatCompanyCurrency(sales.currentPeriodInvoiced)}</p>
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    {invoicedDelta === null ? (
                      <span className="text-muted-foreground">No prior-month data</span>
                    ) : (
                      <span className={"inline-flex items-center gap-1 font-semibold " + (invoicedDelta >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
                        {invoicedDelta >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
                        {Math.abs(invoicedDelta).toFixed(1)}% vs last month
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">Excludes draft and cancelled invoices</p>
                </CardContent>
              </Panel>
              <Panel className="relative">
                <div aria-hidden className="pointer-events-none absolute -right-8 -top-12 size-40 rounded-full bg-sky-500/[0.06] blur-3xl" />
                <CardContent className="relative p-5">
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Collected payments</p>
                  <p className="mt-3 break-words text-2xl font-bold tracking-[-0.045em] text-foreground sm:text-3xl">{formatCompanyCurrency(sales.currentPeriodCollected)}</p>
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    {collectedDelta === null ? (
                      <span className="text-muted-foreground">No prior-month data</span>
                    ) : (
                      <span className={"inline-flex items-center gap-1 font-semibold " + (collectedDelta >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
                        {collectedDelta >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
                        {Math.abs(collectedDelta).toFixed(1)}% vs last month
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">Confirmed and reconciled payments only</p>
                </CardContent>
              </Panel>
              <Panel className="relative">
                <div aria-hidden className="pointer-events-none absolute -right-8 -top-12 size-40 rounded-full bg-amber-500/[0.06] blur-3xl" />
                <CardContent className="relative p-5">
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Credit notes</p>
                  <p className="mt-3 break-words text-2xl font-bold tracking-[-0.045em] text-foreground sm:text-3xl">{formatCompanyCurrency(sales.creditNotesCurrentPeriod)}</p>
                  <p className="mt-2 text-xs text-muted-foreground">Issued this month, tracked separately</p>
                </CardContent>
              </Panel>
              <Panel className="relative">
                <div aria-hidden className="pointer-events-none absolute -right-8 -top-12 size-40 rounded-full bg-violet-500/[0.06] blur-3xl" />
                <CardContent className="relative p-5">
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Net collected</p>
                  <p className="mt-3 break-words text-2xl font-bold tracking-[-0.045em] text-foreground sm:text-3xl">{formatCompanyCurrency(sales.currentPeriodCollected - sales.creditNotesCurrentPeriod)}</p>
                  <p className="mt-2 text-xs text-muted-foreground">Collected payments minus credit notes</p>
                </CardContent>
              </Panel>
            </div>
          </section>
        )}

        {canReadExpenses && expenses && (
          <section aria-label="Expenses this month">
            <SectionHeading title={"Expenses · " + monthLabel} detail="Operating expenses recorded this month" />
            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
              <Panel>
                <CardContent className="p-5 sm:p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">This month</p>
                      <p className="mt-3 break-words text-2xl font-bold tracking-[-0.045em] text-foreground sm:text-3xl">{formatCompanyCurrency(expenses.currentPeriod)}</p>
                      <div className="mt-2 flex items-center gap-2 text-xs">
                        {expenseDelta === null ? (
                          <span className="text-muted-foreground">No prior-month data</span>
                        ) : (
                          <span className={"inline-flex items-center gap-1 font-semibold " + (expenseDelta >= 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400")}>
                            {expenseDelta >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
                            {Math.abs(expenseDelta).toFixed(1)}% vs last month
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400"><Wallet className="size-5" /></span>
                  </div>
                  <Link to="/expenses" className="mt-5 inline-flex items-center gap-1.5 border-t border-border/70 pt-3 text-[11px] font-bold text-primary">Review expenses <ChevronRight className="size-3.5" /></Link>
                </CardContent>
              </Panel>
              <Panel>
                <CardContent className="p-5 sm:p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Last month</p>
                      <p className="mt-3 break-words text-2xl font-bold tracking-[-0.045em] text-foreground sm:text-3xl">{formatCompanyCurrency(expenses.previousPeriod)}</p>
                      <p className="mt-2 text-xs text-muted-foreground">Prior month for comparison</p>
                    </div>
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-muted text-muted-foreground"><CalendarDays className="size-5" /></span>
                  </div>
                </CardContent>
              </Panel>
            </div>
          </section>
        )}

        {canReadSales && (topProducts || categoryBreakdown) && (
          <section className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-2" aria-label="Top products and category breakdown">
            {topProducts && (
              <Panel>
                <CardHeader className="border-b border-border/70 px-5 pb-4 pt-5">
                  <CardTitle className="flex items-center gap-2 text-sm font-bold"><Package className="size-4 text-primary" /> Top products · {monthLabel}</CardTitle>
                  <CardDescription className="mt-1.5 text-xs">By invoiced revenue this month</CardDescription>
                </CardHeader>
                <CardContent className="px-5 pb-5 pt-3">
                  {topProducts.length === 0 ? (
                    <div className="flex min-h-32 flex-col items-center justify-center gap-2 text-center">
                      <div className="rounded-2xl bg-primary/10 p-3 text-primary"><Package className="size-5" /></div>
                      <p className="text-sm font-semibold text-foreground">No product sales yet</p>
                      <p className="text-xs text-muted-foreground">Top products will appear here once invoices are recorded this month.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto"><table className="w-full min-w-[24rem] text-xs"><thead><tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.08em] text-muted-foreground"><th className="py-3 pr-4 font-bold">Product</th><th className="py-3 pr-4 font-bold">SKU</th><th className="py-3 pr-4 text-right font-bold">Qty</th><th className="py-3 text-right font-bold">Revenue</th></tr></thead><tbody>{topProducts.map((product) => (<tr key={product.id} className="border-b border-border/70 last:border-0"><td className="max-w-44 truncate py-3.5 pr-4 font-semibold text-foreground">{product.name}</td><td className="py-3.5 pr-4 text-muted-foreground">{product.sku || "—"}</td><td className="py-3.5 pr-4 text-right font-bold tabular-nums">{formatNumber(product.quantity)}</td><td className="py-3.5 text-right font-bold tabular-nums text-foreground">{formatCompanyCurrency(product.revenue)}</td></tr>))}</tbody></table></div>
                  )}
                </CardContent>
              </Panel>
            )}
            {categoryBreakdown && (
              <Panel>
                <CardHeader className="border-b border-border/70 px-5 pb-4 pt-5">
                  <CardTitle className="flex items-center gap-2 text-sm font-bold"><Boxes className="size-4 text-primary" /> Category breakdown · {monthLabel}</CardTitle>
                  <CardDescription className="mt-1.5 text-xs">Invoiced revenue by product category</CardDescription>
                </CardHeader>
                <CardContent className="px-5 pb-5 pt-3">
                  {categoryBreakdown.length === 0 ? (
                    <div className="flex min-h-32 flex-col items-center justify-center gap-2 text-center">
                      <div className="rounded-2xl bg-primary/10 p-3 text-primary"><Boxes className="size-5" /></div>
                      <p className="text-sm font-semibold text-foreground">No category data yet</p>
                      <p className="text-xs text-muted-foreground">Categories will appear here once product sales are recorded this month.</p>
                    </div>
                  ) : (
                    <div className="h-[220px] w-full" role="img" aria-label="Category revenue breakdown chart">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={categoryBreakdown} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                          <CartesianGrid horizontal={false} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="3 6" />
                          <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} tickFormatter={(value: number) => value >= 1000000 ? (value / 1000000).toFixed(1) + "m" : value >= 1000 ? Math.round(value / 1000) + "k" : String(value)} />
                          <YAxis type="category" dataKey="category" axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} width={96} />
                          <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--popover-foreground)", fontSize: 12, boxShadow: "0 8px 24px rgb(0 0 0 / 10%)" }} formatter={(value) => [formatCompanyCurrency(Number(value)), "Revenue"]} />
                          <Bar dataKey="revenue" fill="var(--chart-2)" radius={[0, 6, 6, 0]} isAnimationActive animationDuration={550} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </CardContent>
              </Panel>
            )}
          </section>
        )}

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-5 text-[10px] text-muted-foreground">
          <span>Omega Solutions · One platform for your business</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-emerald-500" /> Secure, company-scoped overview</span>
        </footer>
      </div>
    </BaseLayout>
  )
}
