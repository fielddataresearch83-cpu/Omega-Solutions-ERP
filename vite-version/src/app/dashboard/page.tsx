import * as React from "react"
import { Link } from "react-router-dom"
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  FilePlus2,
  Package,
  ReceiptText,
  RefreshCw,
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
}

type MetricTone = "emerald" | "sky" | "violet" | "amber"

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
  const tones: Record<MetricTone, string> = {
    emerald: "bg-emerald-500/10 text-emerald-600 ring-emerald-500/15 dark:text-emerald-400",
    sky: "bg-sky-500/10 text-sky-600 ring-sky-500/15 dark:text-sky-400",
    violet: "bg-violet-500/10 text-violet-600 ring-violet-500/15 dark:text-violet-400",
    amber: "bg-amber-500/10 text-amber-700 ring-amber-500/15 dark:text-amber-300",
  }

  return (
    <Card className="group min-w-0 overflow-hidden rounded-2xl border-slate-200 bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg hover:shadow-slate-200/50 dark:border-white/[0.07] dark:bg-[#121826] dark:hover:border-white/[0.13] dark:hover:shadow-black/20">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-3 pt-5">
        <div className="min-w-0 space-y-2">
          <CardDescription className="text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400">{label}</CardDescription>
          <CardTitle className="break-words text-2xl font-extrabold tracking-tight text-slate-950 dark:text-slate-50 sm:text-[28px]">{value}</CardTitle>
        </div>
        <div className={"flex size-11 shrink-0 items-center justify-center rounded-full ring-1 transition duration-200 group-hover:scale-105 " + tones[tone]}>
          <Icon className="size-5" strokeWidth={1.9} aria-hidden="true" />
        </div>
      </CardHeader>
      <CardContent className="flex min-h-11 items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-white/[0.06]">
        <span className="min-w-0 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{detail}</span>
        <Link
          to={href}
          aria-label={"View " + label.toLowerCase()}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-slate-500 transition hover:text-emerald-600 dark:text-slate-400 dark:hover:text-emerald-400"
        >
          View <ArrowUpRight className="size-3.5" />
        </Link>
      </CardContent>
    </Card>
  )
}

function SectionHeading({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100">{title}</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{detail}</p>
      </div>
    </div>
  )
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

  React.useEffect(() => {
    if (authLoading || companyLoading || !user) return
    let cancelled = false
    setDashboard((current) => ({ ...current, loading: true, error: null }))
    api.get<DashboardSummary>("/dashboard/summary")
      .then((data) => {
        if (!cancelled) setDashboard({ data, loading: false, error: null })
      })
      .catch((error: { message?: string }) => {
        if (!cancelled) {
          setDashboard({
            data: null,
            loading: false,
            error: error.message ?? "Could not load dashboard summary.",
          })
        }
      })
    return () => { cancelled = true }
  }, [authLoading, companyLoading, user?.userId, company?.id, retryKey])

  const canUseModule = (moduleCode: string) => {
    if (dashboard.loading || !dashboard.data) return false
    if (!dashboard.data.subscription) return true
    return ["active", "trialing"].includes(dashboard.data.subscription.status) &&
      dashboard.data.modules?.[moduleCode] === true
  }
  const canReadSales = canUseModule("sales") && permissions.has("sales:read")
  const canReadCustomers = canUseModule("sales") && permissions.has("customers:read")
  const canReadProcurement = canUseModule("procurement") &&
    permissions.has("suppliers:read") && Boolean(dashboard.data?.suppliers)
  const canReadProducts = canUseModule("inventory") && permissions.has("products:read")

  const loading = authLoading || companyLoading || dashboard.loading
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

  return (
    <BaseLayout>
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-7 px-4 py-3 sm:px-6 lg:px-8">
        <section className="relative isolate overflow-hidden rounded-2xl border border-slate-200 bg-white px-5 py-6 shadow-sm dark:border-white/[0.07] dark:bg-[#121826] sm:px-7 sm:py-8">
          <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-24 -z-10 size-72 rounded-full bg-emerald-400/10 blur-3xl dark:bg-emerald-400/[0.12]" />
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 right-1/4 -z-10 size-56 rounded-full bg-sky-400/[0.08] blur-3xl" />
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/[0.07] px-3 py-1.5 text-[10px] font-bold tracking-[0.16em] text-emerald-700 dark:text-emerald-300">
                <span className="size-1.5 rounded-full bg-emerald-500 shadow-[0_0_9px_rgba(16,185,129,0.75)]" />
                BUSINESS OVERVIEW
              </div>
              <h1 className="text-2xl font-extrabold tracking-tight text-slate-950 dark:text-white sm:text-3xl">
                One platform for your business.
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                {companyLoading
                  ? "Loading your business workspace…"
                  : company
                    ? "A clear view of " + company.name + " — sales, stock, balances and the work that needs attention."
                    : "Monitor sales, stock, balances and the work that needs attention."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canReadSales && (
                <Link to="/invoices" className={buttonVariants({ className: "h-10 rounded-xl bg-emerald-500 px-4 text-xs font-bold text-white shadow-md shadow-emerald-600/15 hover:bg-emerald-400" })}>
                  <FilePlus2 className="mr-2 size-4" /> Sales invoices
                </Link>
              )}
              {canReadProducts && (
                <Link to="/products" className={buttonVariants({ variant: "outline", className: "h-10 rounded-xl border-slate-200 bg-white/80 text-xs dark:border-white/10 dark:bg-white/[0.03]" })}>
                  <Package className="mr-2 size-4" /> Products
                </Link>
              )}
            </div>
          </div>
        </section>

        {dashboard.error && !loading && (
          <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/[0.05] p-4 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div className="rounded-xl bg-rose-500/10 p-2 text-rose-600 dark:text-rose-400"><CircleAlert className="size-5" /></div>
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Some dashboard data could not be loaded</p>
                <p className="mt-1 break-words text-xs leading-relaxed text-slate-500 dark:text-slate-400">{dashboard.error}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setRetryKey((value) => value + 1)}
              className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-rose-500/20 px-3 text-xs font-semibold text-rose-700 transition hover:bg-rose-500/10 dark:text-rose-300"
            >
              <RefreshCw className="size-3.5" /> Try again
            </button>
          </div>
        )}

        <section aria-label="Business summary">
          <SectionHeading title="At a glance" detail="Live figures from your current company records" />
          {loading ? (
            <div className="flex min-h-44 items-center justify-center rounded-2xl border border-slate-200 bg-white dark:border-white/[0.07] dark:bg-[#121826]">
              <LoadingSpinner />
            </div>
          ) : (
            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {canReadCustomers && (
                <MetricCard label="Customers" value={formatNumber(dashboard.data?.customers?.count ?? 0)} detail="Customer directory" icon={Users} href="/customers" tone="emerald" />
              )}
              {canReadProcurement && dashboard.data?.suppliers && (
                <MetricCard label="Suppliers" value={formatNumber(dashboard.data.suppliers.count)} detail="Supplier directory" icon={BriefcaseBusiness} href="/suppliers" tone="sky" />
              )}
              {canReadProducts && (
                <MetricCard label="Active products" value={formatNumber(activeProducts)} detail={String(lowStockCount) + " at or below reorder level"} icon={Boxes} href="/products" tone="violet" />
              )}
              {canReadProducts && (
                <MetricCard label="Inventory value" value={formatCompanyCurrency(inventoryCost)} detail="Recorded stock cost value" icon={Package} href="/products" tone="amber" />
              )}
              {!canReadCustomers && !canReadProcurement && !canReadProducts && (
                <div className="col-span-full rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500 dark:border-white/[0.07] dark:bg-[#121826] dark:text-slate-400">
                  Your current role or subscription does not have access to these summary metrics.
                </div>
              )}
            </div>
          )}
        </section>

        {canReadSales && (
          <section className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.85fr)]" aria-label="Sales and invoices">
            <Card className="min-w-0 overflow-hidden rounded-2xl border-slate-200 bg-white shadow-sm dark:border-white/[0.07] dark:bg-[#121826]">
              <CardHeader className="flex flex-col gap-3 space-y-0 pb-0 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_9px_rgba(16,185,129,0.65)]" />
                    <CardTitle className="text-sm font-bold text-slate-900 dark:text-slate-100">Invoice trend</CardTitle>
                  </div>
                  <CardDescription className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    Monthly invoice totals · last six months · {currency}
                  </CardDescription>
                </div>
                <Link to="/invoices" className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 transition hover:text-emerald-600 dark:text-emerald-400">
                  View invoices <ArrowUpRight className="size-3.5" />
                </Link>
              </CardHeader>
              <CardContent className="pt-5">
                {invoiceTrend.every((month) => month.total === 0) ? (
                  <div className="flex min-h-56 flex-col items-center justify-center gap-2 text-center">
                    <div className="rounded-full bg-emerald-500/10 p-3 text-emerald-600 dark:text-emerald-400"><TrendingUp className="size-5" /></div>
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">No invoice activity in this period</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Invoice totals will appear here when records are available.</p>
                  </div>
                ) : (
                  <div className="h-[260px] w-full" role="img" aria-label="Monthly invoice totals chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={invoiceTrend} margin={{ top: 14, right: 8, bottom: 0, left: -12 }}>
                        <defs>
                          <linearGradient id="omegaInvoiceArea" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#10B981" stopOpacity={0.24} />
                            <stop offset="68%" stopColor="#10B981" stopOpacity={0.06} />
                            <stop offset="100%" stopColor="#10B981" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.09} strokeDasharray="3 6" />
                        <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#94A3B8", fontSize: 11 }} tickMargin={12} />
                        <YAxis
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: "#94A3B8", fontSize: 10 }}
                          tickMargin={8}
                          width={62}
                          tickFormatter={(value: number) => value >= 1000000 ? (value / 1000000).toFixed(1) + "m" : value >= 1000 ? Math.round(value / 1000) + "k" : String(value)}
                        />
                        <Tooltip
                          contentStyle={{ background: "var(--background)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }}
                          formatter={(value) => [formatCompanyCurrency(Number(value)), "Invoice total"]}
                          labelFormatter={(label) => "Month: " + label}
                        />
                        <Area type="monotone" dataKey="total" stroke="none" fill="url(#omegaInvoiceArea)" isAnimationActive animationDuration={550} />
                        <Line
                          type="monotone"
                          dataKey="total"
                          name="Invoice total"
                          stroke="#10B981"
                          strokeWidth={3}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          dot={false}
                          activeDot={{ r: 5, fill: "#10B981", stroke: "var(--background)", strokeWidth: 2 }}
                          style={{ filter: "drop-shadow(0 0 5px rgba(16,185,129,0.35))" }}
                          isAnimationActive
                          animationDuration={650}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4 dark:border-white/[0.06]">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">Based on invoice totals returned by your dashboard API</span>
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400"><span className="size-1.5 rounded-full bg-emerald-500" /> Live company data</span>
                </div>
              </CardContent>
            </Card>

            <Card className="min-w-0 rounded-2xl border-slate-200 bg-white shadow-sm dark:border-white/[0.07] dark:bg-[#121826]">
              <CardHeader className="space-y-1">
                <CardTitle className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
                  <CalendarClock className="size-4 text-amber-600 dark:text-amber-400" /> Overdue invoices
                </CardTitle>
                <CardDescription className="text-xs text-slate-500 dark:text-slate-400">Past-due invoices with an outstanding balance</CardDescription>
              </CardHeader>
              <CardContent>
                {overdueInvoices.length === 0 ? (
                  <div className="flex min-h-36 flex-col items-center justify-center gap-2 text-center">
                    <CheckCircle2 className="size-6 text-emerald-500" />
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">No overdue invoices returned</p>
                    <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">There are no overdue balances in the records available to this account.</p>
                  </div>
                ) : (
                  <div className="space-y-0">
                    {overdueInvoices.slice(0, 5).map((invoice) => (
                      <div key={invoice.id} className="flex min-w-0 items-start justify-between gap-3 border-b border-slate-100 py-3.5 last:border-0 dark:border-white/[0.06]">
                        <div className="min-w-0">
                          <Link to="/invoices" className="text-xs font-bold text-slate-800 underline-offset-4 hover:text-emerald-600 hover:underline dark:text-slate-100 dark:hover:text-emerald-400">{invoice.invoice_number}</Link>
                          <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{invoice.customer_name}</p>
                          <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">Due {invoice.due_date}</p>
                        </div>
                        <p className="shrink-0 text-right text-xs font-bold tabular-nums text-rose-600 dark:text-rose-300">
                          {new Intl.NumberFormat("en-KE", { style: "currency", currency: invoice.currency || currency, maximumFractionDigits: 0 }).format(invoice.balance)}
                        </p>
                      </div>
                    ))}
                    <Link to="/invoices" className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-600 dark:text-emerald-400">
                      Review all invoices <ArrowRight className="size-3.5" />
                    </Link>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        )}

        <section aria-label="Financial balances" className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
          {canReadCustomers && dashboard.data?.customers && (
            <Card className="relative overflow-hidden rounded-2xl border border-emerald-500/15 bg-white shadow-sm dark:bg-[#121826]">
              <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-12 size-40 rounded-full bg-emerald-400/[0.08] blur-3xl" />
              <CardHeader className="relative flex flex-row items-start justify-between gap-3 space-y-0">
                <div className="space-y-2">
                  <CardDescription className="text-xs font-semibold text-slate-500 dark:text-slate-400">Customer receivables</CardDescription>
                  <CardTitle className="break-words text-2xl font-extrabold tracking-tight text-emerald-600 dark:text-emerald-400 sm:text-3xl">{receivables === null ? "—" : formatCompanyCurrency(receivables)}</CardTitle>
                </div>
                <div className="rounded-xl bg-emerald-500/10 p-3 text-emerald-600 dark:text-emerald-400"><Wallet className="size-5" /></div>
              </CardHeader>
              <CardContent className="relative flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-white/[0.06]">
                <p className="text-xs text-slate-500 dark:text-slate-400">Outstanding balances recorded against customers</p>
                <Link to="/customers" className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-600 dark:text-emerald-400">Review customers <ChevronRight className="size-3.5" /></Link>
              </CardContent>
            </Card>
          )}
          {canReadProcurement && dashboard.data?.suppliers && (
            <Card className="relative overflow-hidden rounded-2xl border border-amber-500/15 bg-white shadow-sm dark:bg-[#121826]">
              <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-12 size-40 rounded-full bg-amber-400/[0.08] blur-3xl" />
              <CardHeader className="relative flex flex-row items-start justify-between gap-3 space-y-0">
                <div className="space-y-2">
                  <CardDescription className="text-xs font-semibold text-slate-500 dark:text-slate-400">Supplier payables</CardDescription>
                  <CardTitle className="break-words text-2xl font-extrabold tracking-tight text-amber-700 dark:text-amber-300 sm:text-3xl">{payables === null ? "—" : formatCompanyCurrency(payables)}</CardTitle>
                </div>
                <div className="rounded-xl bg-amber-500/10 p-3 text-amber-700 dark:text-amber-300"><ArrowDownRight className="size-5" /></div>
              </CardHeader>
              <CardContent className="relative flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-white/[0.06]">
                <p className="text-xs text-slate-500 dark:text-slate-400">Outstanding balances recorded against suppliers</p>
                <Link to="/suppliers" className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 hover:text-amber-600 dark:text-amber-300">Review suppliers <ChevronRight className="size-3.5" /></Link>
              </CardContent>
            </Card>
          )}
        </section>

        {canReadProducts && (
          <section className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.85fr)]" aria-label="Inventory and quick actions">
            <Card className="min-w-0 rounded-2xl border-slate-200 bg-white shadow-sm dark:border-white/[0.07] dark:bg-[#121826]">
              <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                <div>
                  <CardTitle className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100"><Package className="size-4 text-emerald-600 dark:text-emerald-400" /> Stock requiring attention</CardTitle>
                  <CardDescription className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">Products at or below their configured reorder level</CardDescription>
                </div>
                <span className={"shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold tabular-nums " + (lowStockCount > 0 ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300")}>{lowStockCount} flagged</span>
              </CardHeader>
              <CardContent>
                {lowStockCount === 0 ? (
                  <div className="flex min-h-28 items-center gap-3 rounded-xl bg-emerald-500/[0.05] px-4 py-5 text-sm text-slate-600 dark:text-slate-300">
                    <CheckCircle2 className="size-5 shrink-0 text-emerald-500" />
                    No low-stock products in the records currently available.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[27rem] text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 text-left text-slate-500 dark:border-white/[0.06] dark:text-slate-400">
                          <th className="py-3 pr-4 font-semibold">Product</th>
                          <th className="py-3 pr-4 font-semibold">SKU</th>
                          <th className="py-3 pr-4 text-right font-semibold">On hand</th>
                          <th className="py-3 text-right font-semibold">Reorder at</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lowStockProducts.slice(0, 6).map((product) => (
                          <tr key={product.id} className="border-b border-slate-100 last:border-0 dark:border-white/[0.06]">
                            <td className="max-w-52 truncate py-3 pr-4 font-semibold text-slate-800 dark:text-slate-100">{product.name}</td>
                            <td className="py-3 pr-4 text-slate-500 dark:text-slate-400">{product.sku || "—"}</td>
                            <td className="py-3 pr-4 text-right font-semibold tabular-nums text-amber-700 dark:text-amber-300">{formatNumber(Number(product.stock_quantity))}</td>
                            <td className="py-3 text-right tabular-nums text-slate-500 dark:text-slate-400">{formatNumber(Number(product.reorder_level))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <Link to="/products" className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-600 dark:text-emerald-400">Open product catalogue <ArrowRight className="size-3.5" /></Link>
              </CardContent>
            </Card>

            <Card className="min-w-0 rounded-2xl border-slate-200 bg-white shadow-sm dark:border-white/[0.07] dark:bg-[#121826]">
              <CardHeader>
                <CardTitle className="text-sm font-bold text-slate-900 dark:text-slate-100">Quick actions</CardTitle>
                <CardDescription className="text-xs text-slate-500 dark:text-slate-400">Jump straight into common tasks</CardDescription>
              </CardHeader>
              <CardContent className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                {canReadSales && (
                  <Link to="/invoices" className="group -mx-2 flex items-center gap-3 rounded-xl px-2 py-3.5 transition hover:bg-slate-50 dark:hover:bg-white/[0.035]">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"><ReceiptText className="size-[18px]" /></span>
                    <span className="min-w-0 flex-1"><span className="block text-xs font-bold text-slate-800 dark:text-slate-100">Sales invoices</span><span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">Review and manage customer billing</span></span>
                    <ChevronRight className="size-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-emerald-500" />
                  </Link>
                )}
                {canReadCustomers && (
                  <Link to="/customers" className="group -mx-2 flex items-center gap-3 rounded-xl px-2 py-3.5 transition hover:bg-slate-50 dark:hover:bg-white/[0.035]">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400"><Users className="size-[18px]" /></span>
                    <span className="min-w-0 flex-1"><span className="block text-xs font-bold text-slate-800 dark:text-slate-100">Manage customers</span><span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">Open your customer directory</span></span>
                    <ChevronRight className="size-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-emerald-500" />
                  </Link>
                )}
                {canReadProcurement && (
                  <Link to="/suppliers" className="group -mx-2 flex items-center gap-3 rounded-xl px-2 py-3.5 transition hover:bg-slate-50 dark:hover:bg-white/[0.035]">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-300"><BriefcaseBusiness className="size-[18px]" /></span>
                    <span className="min-w-0 flex-1"><span className="block text-xs font-bold text-slate-800 dark:text-slate-100">Manage suppliers</span><span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">Review supplier records and balances</span></span>
                    <ChevronRight className="size-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-emerald-500" />
                  </Link>
                )}
                {canReadProducts && (
                  <Link to="/products" className="group -mx-2 flex items-center gap-3 rounded-xl px-2 py-3.5 transition hover:bg-slate-50 dark:hover:bg-white/[0.035]">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400"><Boxes className="size-[18px]" /></span>
                    <span className="min-w-0 flex-1"><span className="block text-xs font-bold text-slate-800 dark:text-slate-100">Product catalogue</span><span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">Check products and stock levels</span></span>
                    <ChevronRight className="size-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-emerald-500" />
                  </Link>
                )}
                {!canReadSales && !canReadCustomers && !canReadProcurement && !canReadProducts && (
                  <p className="py-4 text-xs leading-relaxed text-slate-500 dark:text-slate-400">No quick actions are available for the current role and enabled modules.</p>
                )}
                {lowStockCount > 0 && (
                  <div className="flex items-center gap-2 py-3 text-xs font-medium text-amber-700 dark:text-amber-300">
                    <ArrowDownRight className="size-4 shrink-0" />
                    {lowStockCount} product{lowStockCount === 1 ? "" : "s"} need stock review.
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        )}

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-5 text-[11px] text-slate-500 dark:border-white/[0.06] dark:text-slate-500">
          <span>Omega Solutions · One platform for your business</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-emerald-500" /> Company-scoped dashboard</span>
        </footer>
      </div>
    </BaseLayout>
  )
}
