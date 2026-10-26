import * as React from "react"
import { Link } from "react-router-dom"
import {
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  BriefcaseBusiness,
  CircleAlert,
  CalendarClock,
  TrendingUp,
  Package,
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
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"

type DashboardSummary = {
  currency: string
  accessMode: "legacy_unmetered" | "subscription"
  subscription: null | { status: string }
  modules: Record<string, boolean>
  customers: null | { count: number; receivables: number | null }
  suppliers: null | { count: number; payables: number }
  inventory: null | { activeProducts: number; lowStock: number; costValue: number; lowStockProducts: Array<{ id: string; name: string; sku: string; stock_quantity: number; reorder_level: number }> }
  invoiceTrend: null | Array<{ key: string; total: number }>
  overdueInvoices: null | Array<{ id: string; invoice_number: string; customer_name: string; due_date: string; currency: string; balance: number }>
}

function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  href,
}: {
  label: string
  value: string
  detail: string
  icon: React.ElementType
  href: string
}) {
  return (
    <Card className="group min-w-0 overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="h-1 w-full bg-primary/80" aria-hidden="true" />
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-2 pt-5">
        <div className="min-w-0 space-y-1">
          <CardDescription>{label}</CardDescription>
          <CardTitle className="break-words text-2xl font-semibold tabular-nums">{value}</CardTitle>
        </div>
        <div className="shrink-0 rounded-xl border border-primary/15 bg-primary/10 p-3 transition-colors group-hover:bg-primary/15">
          <Icon className="size-5 text-primary" aria-hidden="true" />
        </div>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-sm text-muted-foreground">{detail}</p>
        <Link to={href} className={buttonVariants({ variant: "ghost", size: "sm", className: "shrink-0" })}>View <ArrowUpRight className="ml-1 size-3.5" /></Link>
      </CardContent>
    </Card>
  )
}

export default function Page() {
  const { company, loading: companyLoading } = useMyCompany()
  const { user, loading: authLoading } = useAuth()
  const permissions = new Set(user?.permissions ?? [])
  const [dashboard, setDashboard] = React.useState<{ data: DashboardSummary | null; loading: boolean; error: string | null }>({
    data: null, loading: true, error: null,
  })

  React.useEffect(() => {
    if (authLoading || companyLoading || !user) return
    let cancelled = false
    setDashboard((current) => ({ ...current, loading: true, error: null }))
    api.get<DashboardSummary>("/dashboard/summary")
      .then((data) => { if (!cancelled) setDashboard({ data, loading: false, error: null }) })
      .catch((error: { message?: string }) => {
        if (!cancelled) setDashboard({ data: null, loading: false, error: error.message ?? "Could not load dashboard summary." })
      })
    return () => { cancelled = true }
  }, [authLoading, companyLoading, user?.userId, company?.id])

  const canUseModule = (moduleCode: string) => {
    if (dashboard.loading || !dashboard.data) return false
    if (!dashboard.data.subscription) return true
    return ["active", "trialing"].includes(dashboard.data.subscription.status) &&
      dashboard.data.modules?.[moduleCode] === true
  }
  const canReadSales = canUseModule("sales") && permissions.has("sales:read")
  const canReadCustomers = canUseModule("sales") && permissions.has("customers:read")
  const canReadProcurement = canUseModule("procurement") && permissions.has("suppliers:read")
  const canReadProducts = canUseModule("inventory") && permissions.has("products:read")
  const canReadInventory = canUseModule("inventory") && permissions.has("inventory:read")

  const loading = authLoading || dashboard.loading
  const errors = dashboard.error ? [dashboard.error] : []
  const activeProducts = dashboard.data?.inventory?.activeProducts ?? 0
  const lowStockCount = dashboard.data?.inventory?.lowStock ?? 0
  const lowStockProducts = dashboard.data?.inventory?.lowStockProducts ?? []
  const inventoryCost = dashboard.data?.inventory?.costValue ?? 0
  const receivables = dashboard.data?.customers?.receivables ?? null
  const payables = dashboard.data?.suppliers?.payables ?? null
  const formatCompanyCurrency = (value: number) => new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: dashboard.data?.currency || company?.currency || "KES",
    maximumFractionDigits: 2,
  }).format(value)
  const invoiceTrend = React.useMemo(() => {
    const months: { key: string; label: string; total: number }[] = []
    const now = new Date()
    for (let offset = 5; offset >= 0; offset -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - offset, 1)
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
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
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-6 px-4 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-white via-white to-primary/10 p-5 shadow-sm sm:p-7 dark:from-card dark:via-card dark:to-primary/10">
          <div className="pointer-events-none absolute -right-10 -top-16 size-56 rounded-full bg-primary/10 blur-3xl" aria-hidden="true" />
          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-2">
              <p className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-semibold tracking-wide text-foreground">
                <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
                BUSINESS OVERVIEW
              </p>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Good to see you back</h1>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                {companyLoading
                  ? "Loading your business workspace…"
                  : company
                    ? `Here is the latest view of ${company.name}. Keep track of stock, balances and the work that needs attention.`
                    : "Your business at a glance. Keep track of stock, balances and the work that needs attention."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canReadSales && <Link to="/invoices" className={buttonVariants({ className: "shadow-sm" })}><Wallet className="mr-2 size-4" />Sales invoices</Link>}
              {canReadProducts && <Link to="/products" className={buttonVariants({ variant: "outline", className: "bg-background/80" })}><Package className="mr-2 size-4" />View inventory</Link>}
              {canReadInventory && <Link to="/stock-levels" className={buttonVariants({ variant: "outline", className: "bg-background/80" })}>Stock levels</Link>}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold tracking-tight">At a glance</h2>
            <p className="text-sm text-muted-foreground">Live figures from your current company records</p>
          </div>
        </div>

        {errors.length > 0 && (
          <div role="alert" className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="space-y-1">
              <p className="font-medium">Some dashboard data could not be loaded</p>
              {errors.map((error) => <p key={error} className="text-muted-foreground">{error}</p>)}
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex min-h-48 items-center justify-center rounded-xl border">
            <LoadingSpinner />
          </div>
        ) : (
          <>
            <section aria-label="Business summary" className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {canReadCustomers && <StatCard
                label="Customers"
                value={formatNumber(dashboard.data?.customers?.count ?? 0)}
                detail="Customer records"
                icon={Users}
                href="/customers"
              />}
              {canReadProcurement && dashboard.data?.suppliers && <StatCard
                label="Suppliers"
                value={formatNumber(dashboard.data?.suppliers?.count ?? 0)}
                detail="Supplier records"
                icon={BriefcaseBusiness}
                href="/suppliers"
              />}
              {canReadProducts && <StatCard
                label="Active products"
                value={formatNumber(activeProducts)}
                detail={`${lowStockCount} at or below reorder level`}
                icon={Package}
                href="/products"
              />}
              {canReadProducts && <StatCard
                label="Inventory cost value"
                value={formatCompanyCurrency(inventoryCost)}
                detail="Current stock × recorded cost price"
                icon={Boxes}
                href="/products"
              />}
            </section>

            {canReadSales && <section className="grid min-w-0 gap-4 xl:grid-cols-5" aria-label="Invoice activity">
              <Card className="min-w-0 xl:col-span-3">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><TrendingUp className="size-5 text-primary" />Invoice trend</CardTitle>
                  <CardDescription>Monthly invoice totals in {company?.currency || "KES"} for the last six months, excluding drafts and cancelled invoices</CardDescription>
                </CardHeader>
                <CardContent>
                  {invoiceTrend.every((month) => month.total === 0) ? (
                    <div className="flex min-h-52 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                      <TrendingUp className="size-6" />
                      No invoice activity in this period.
                    </div>
                  ) : (
                    <div className="h-56 w-full" role="img" aria-label="Monthly invoice totals chart">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={invoiceTrend} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="label" tickLine={false} axisLine={false} />
                          <YAxis tickLine={false} axisLine={false} width={64} tickFormatter={(value: number) => value >= 1000000 ? `${dashboard.data?.currency || company?.currency || "KES"} ${(value / 1000000).toFixed(1)}m` : value >= 1000 ? `${dashboard.data?.currency || company?.currency || "KES"} ${(value / 1000).toFixed(0)}k` : `${dashboard.data?.currency || company?.currency || "KES"} ${value}`} />
                          <Tooltip formatter={(value) => [new Intl.NumberFormat("en-KE", { style: "currency", currency: company?.currency || "KES", maximumFractionDigits: 0 }).format(Number(value)), "Invoice total"]} labelFormatter={(label) => `Month: ${label}`} />
                          <Line type="monotone" dataKey="total" name="Invoice total" stroke="var(--color-primary, #51BC8F)" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card className="min-w-0 xl:col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><CalendarClock className="size-5 text-amber-600" />Overdue invoices</CardTitle>
                  <CardDescription>Past-due invoices with a remaining balance</CardDescription>
                </CardHeader>
                <CardContent>
                  {overdueInvoices.length === 0 ? (
                    <p className="flex min-h-24 items-center gap-2 text-sm text-muted-foreground">No overdue balances found in the available invoice records.</p>
                  ) : (
                    <div className="space-y-3">
                      {overdueInvoices.map((invoice) => (
                        <div key={invoice.id} className="flex min-w-0 items-start justify-between gap-3 border-b pb-3 last:border-0 last:pb-0">
                          <div className="min-w-0">
                            <Link to="/invoices" className="font-medium underline-offset-4 hover:underline">{invoice.invoice_number}</Link>
                            <p className="truncate text-sm text-muted-foreground">{invoice.customer_name}</p>
                            <p className="text-xs text-muted-foreground">Due {invoice.due_date}</p>
                          </div>
                          <p className="shrink-0 text-right text-sm font-semibold tabular-nums">{new Intl.NumberFormat("en-KE", { style: "currency", currency: invoice.currency || company?.currency || "KES" }).format(invoice.balance)}</p>
                        </div>
                      ))}
                      <Link to="/invoices" className={buttonVariants({ variant: "outline", size: "sm", className: "w-full" })}>Review invoices</Link>
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>}

            <section className="grid min-w-0 gap-4 lg:grid-cols-2" aria-label="Balances">
              {canReadCustomers && dashboard.data?.customers && <Card className="relative overflow-hidden border-l-4 border-l-primary">
                <CardHeader className="flex flex-row items-start justify-between gap-3">
                  <div className="space-y-1">
                    <CardDescription>Customer receivables</CardDescription>
                    <CardTitle className="text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">{receivables === null ? "—" : formatCompanyCurrency(receivables)}</CardTitle>
                  </div>
                  <div className="rounded-xl bg-primary/10 p-3"><ArrowUpRight className="size-5 text-primary" aria-hidden="true" /></div>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center justify-between gap-3">
                  <p className="max-w-sm text-sm text-muted-foreground">Outstanding balances recorded against customers</p>
                  <Link to="/customers" className={buttonVariants({ variant: "outline", size: "sm" })}>Review customers</Link>
                </CardContent>
              </Card>}
              {canReadProcurement && dashboard.data?.suppliers && <Card className="relative overflow-hidden border-l-4 border-l-amber-500/70">
                <CardHeader className="flex flex-row items-start justify-between gap-3">
                  <div className="space-y-1">
                    <CardDescription>Supplier payables</CardDescription>
                    <CardTitle className="text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">{payables === null ? "—" : formatCompanyCurrency(payables)}</CardTitle>
                  </div>
                  <div className="rounded-xl bg-amber-500/10 p-3"><ArrowDownRight className="size-5 text-amber-700 dark:text-amber-300" aria-hidden="true" /></div>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center justify-between gap-3">
                  <p className="max-w-sm text-sm text-muted-foreground">Outstanding balances recorded against suppliers</p>
                  <Link to="/suppliers" className={buttonVariants({ variant: "outline", size: "sm" })}>Review suppliers</Link>
                </CardContent>
              </Card>}
            </section>

            {canReadProducts && <section className="grid min-w-0 gap-4 xl:grid-cols-5">
              <Card className="min-w-0 xl:col-span-3">
                <CardHeader className="flex flex-row items-start justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2"><Package className="size-5 text-primary" />Stock requiring attention</CardTitle>
                    <CardDescription>Products at or below their configured reorder level</CardDescription>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums ${lowStockCount ? "bg-amber-500/10 text-amber-800 dark:text-amber-300" : "bg-primary/10 text-foreground"}`}>{lowStockCount} flagged</span>
                </CardHeader>
                <CardContent>
                  {lowStockCount === 0 ? (
                    <div className="flex min-h-24 items-center gap-3 text-sm text-muted-foreground">
                      <Package className="size-5 shrink-0" />
                      No low-stock products in the records currently available.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[28rem] text-sm">
                        <thead>
                          <tr className="border-b text-left text-muted-foreground">
                            <th className="py-2 pr-4 font-medium">Product</th>
                            <th className="py-2 pr-4 font-medium">SKU</th>
                            <th className="py-2 pr-4 text-right font-medium">On hand</th>
                            <th className="py-2 text-right font-medium">Reorder at</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lowStockProducts.map((product) => (
                            <tr key={product.id} className="border-b last:border-0">
                              <td className="max-w-56 truncate py-3 pr-4 font-medium">{product.name}</td>
                              <td className="py-3 pr-4 text-muted-foreground">{product.sku}</td>
                              <td className="py-3 pr-4 text-right tabular-nums">{formatNumber(Number(product.stock_quantity))}</td>
                              <td className="py-3 text-right tabular-nums">{formatNumber(Number(product.reorder_level))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <Link to="/products" className={buttonVariants({ variant: "outline", size: "sm", className: "mt-4" })}>Open products</Link>
                </CardContent>
              </Card>

              <Card className="min-w-0 xl:col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><ArrowUpRight className="size-5 text-primary" />Quick actions</CardTitle>
                  <CardDescription>Jump straight into common tasks</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                  {canReadCustomers && <Link to="/customers" className={buttonVariants({ variant: "outline", className: "justify-start" })}><Users className="mr-2 size-4" />Manage customers</Link>}
                  {canReadProcurement && <Link to="/suppliers" className={buttonVariants({ variant: "outline", className: "justify-start" })}><BriefcaseBusiness className="mr-2 size-4" />Manage suppliers</Link>}
                  {canReadProducts && <Link to="/products" className={buttonVariants({ variant: "outline", className: "justify-start" })}><Package className="mr-2 size-4" />Manage products</Link>}
                  {canReadSales && <Link to="/invoices" className={buttonVariants({ variant: "outline", className: "justify-start" })}><Wallet className="mr-2 size-4" />Sales invoices</Link>}
                  {lowStockCount > 0 && (
                    <p className="flex items-center gap-2 text-sm text-amber-700 sm:col-span-2 xl:col-span-1">
                      <ArrowDownRight className="size-4 shrink-0" />
                      {lowStockCount} product{lowStockCount === 1 ? "" : "s"} need stock review.
                    </p>
                  )}
                </CardContent>
              </Card>
            </section>}
          </>
        )}
      </div>
    </BaseLayout>
  )
}
