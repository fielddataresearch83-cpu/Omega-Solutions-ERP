import * as React from "react"
import { Download, FileBarChart, Printer, RefreshCw, TrendingUp, Scale, Wallet, BookOpen, Percent } from "lucide-react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { api } from "@/lib/api-client"
import { formatKES } from "@/lib/format"
import { downloadCsv, escapeDocumentText, printBusinessDocument } from "@/lib/printable-document"
import { useAuth } from "@/contexts/auth-context"

type TrialBalanceAccount = { id: string; code: string; name: string; account_type: string; total_debits: number; total_credits: number; debit_balance: number; credit_balance: number }
type TrialBalance = { asOfDate: string; accounts: TrialBalanceAccount[]; totalDebits: number; totalCredits: number; variance: number; balanced: boolean }

type PnLAccount = { id: string; code: string; name: string; account_type: string; system_code: string | null; balance: number }
type ProfitAndLoss = {
  currency: string; startDate: string; endDate: string
  incomeAccounts: PnLAccount[]; expenseAccounts: PnLAccount[]
  totalIncome: number; costOfSales: number; grossProfit: number
  operatingExpenses: number; totalExpenses: number; netProfit: number
}

type BalanceSheetAccount = { id: string; code: string; name: string; account_type: string; system_code: string | null; balance: number }
type BalanceSheet = {
  currency: string; asOfDate: string
  assetAccounts: BalanceSheetAccount[]; liabilityAccounts: BalanceSheetAccount[]; equityAccounts: BalanceSheetAccount[]
  totalAssets: number; totalLiabilities: number; totalEquity: number
  totalLiabilitiesAndEquity: number; variance: number; balanced: boolean
}

type CashFlowAccount = { account_code: string; account_name: string; opening_balance: number; closing_balance: number; net_movement: number }
type CashFlow = {
  currency: string; startDate: string; endDate: string
  cashAccounts: CashFlowAccount[]
  totalOpeningBalance: number; totalClosingBalance: number; netCashMovement: number
  method: string; limitation: string
}

type VatSummary = { currency: string; startDate: string; endDate: string; inputVat: number; outputVat: number; netVatPayable: number }
type ReportTab = "trial-balance" | "profit-and-loss" | "balance-sheet" | "cash-flow" | "vat"

const message = (e: unknown) => e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "The request failed. Please try again."

const tabs: { id: ReportTab; label: string; icon: React.ElementType }[] = [
  { id: "trial-balance", label: "Trial balance", icon: BookOpen },
  { id: "profit-and-loss", label: "Profit & loss", icon: TrendingUp },
  { id: "balance-sheet", label: "Balance sheet", icon: Scale },
  { id: "cash-flow", label: "Cash movement", icon: Wallet },
  { id: "vat", label: "VAT summary", icon: Percent },
]

export default function FinancialReportsPage() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = React.useState<ReportTab>("trial-balance")

  const today = new Date().toISOString().slice(0, 10)
  const firstOfMonth = new Date(); firstOfMonth.setDate(1); firstOfMonth.setHours(0, 0, 0, 0)
  const firstOfYear = new Date(new Date().getFullYear(), 0, 1)

  const [asOfDate, setAsOfDate] = React.useState(today)
  const [startDate, setStartDate] = React.useState(firstOfYear.toISOString().slice(0, 10))
  const [endDate, setEndDate] = React.useState(today)

  const [trialBalance, setTrialBalance] = React.useState<TrialBalance | null>(null)
  const [pnl, setPnl] = React.useState<ProfitAndLoss | null>(null)
  const [balanceSheet, setBalanceSheet] = React.useState<BalanceSheet | null>(null)
  const [cashFlow, setCashFlow] = React.useState<CashFlow | null>(null)
  const [vatSummary, setVatSummary] = React.useState<VatSummary | null>(null)

  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [retryKey, setRetryKey] = React.useState(0)

  const loadTrialBalance = React.useCallback(async () => {
    const q = new URLSearchParams()
    if (asOfDate) q.set("asOfDate", asOfDate)
    return api.get<TrialBalance>("/accounting/reports/trial-balance?" + q.toString())
  }, [asOfDate])

  const loadPnL = React.useCallback(async () => {
    const q = new URLSearchParams({ startDate, endDate })
    return api.get<ProfitAndLoss>("/accounting/reports/profit-and-loss?" + q.toString())
  }, [startDate, endDate])

  const loadBalanceSheet = React.useCallback(async () => {
    const q = new URLSearchParams({ asOfDate })
    return api.get<BalanceSheet>("/accounting/reports/balance-sheet?" + q.toString())
  }, [asOfDate])

  const loadCashFlow = React.useCallback(async () => {
    const q = new URLSearchParams({ startDate, endDate })
    return api.get<CashFlow>("/accounting/reports/cash-flow?" + q.toString())
  }, [startDate, endDate])

  const loadVatSummary = React.useCallback(async () => {
    const q = new URLSearchParams({ startDate, endDate })
    return api.get<VatSummary>("/accounting/reports/vat?" + q.toString())
  }, [startDate, endDate])

  React.useEffect(() => {
    let active = true
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        if (activeTab === "trial-balance") {
          const r = await loadTrialBalance(); if (active) setTrialBalance(r)
        } else if (activeTab === "profit-and-loss") {
          const r = await loadPnL(); if (active) setPnl(r)
        } else if (activeTab === "balance-sheet") {
          const r = await loadBalanceSheet(); if (active) setBalanceSheet(r)
        } else if (activeTab === "vat") {
          const r = await loadVatSummary(); if (active) setVatSummary(r)
        } else {
          const r = await loadCashFlow(); if (active) setCashFlow(r)
        }
      } catch (e) { if (active) setError(message(e)) }
      finally { if (active) setLoading(false) }
    }
    void load()
    return () => { active = false }
  }, [activeTab, loadTrialBalance, loadPnL, loadBalanceSheet, loadCashFlow, loadVatSummary, retryKey])

  const refresh = () => setRetryKey(k => k + 1)

  const fmt = (v: number) => formatKES(v, true)

  const exportCsv = () => {
    if (activeTab === "trial-balance" && trialBalance) {
      downloadCsv("omega-trial-balance-" + asOfDate + ".csv", [["Account code", "Account name", "Account type", "Debit balance", "Credit balance"], ...trialBalance.accounts.map(a => [a.code, a.name, a.account_type, a.debit_balance, a.credit_balance]), ["", "", "Totals", trialBalance.totalDebits, trialBalance.totalCredits]])
    } else if (activeTab === "profit-and-loss" && pnl) {
      downloadCsv("omega-profit-and-loss-" + startDate + "-to-" + endDate + ".csv", [["Section", "Account code", "Account name", "Amount"], ...pnl.incomeAccounts.map(a => ["Income", a.code, a.name, a.balance]), ["", "", "Total income", pnl.totalIncome], ...pnl.expenseAccounts.map(a => ["Expense", a.code, a.name, a.balance]), ["", "", "Total expenses", pnl.totalExpenses], ["", "", "Net profit", pnl.netProfit]])
    } else if (activeTab === "balance-sheet" && balanceSheet) {
      downloadCsv("omega-balance-sheet-" + asOfDate + ".csv", [["Section", "Account code", "Account name", "Amount"], ...balanceSheet.assetAccounts.map(a => ["Asset", a.code, a.name, a.balance]), ["", "", "Total assets", balanceSheet.totalAssets], ...balanceSheet.liabilityAccounts.map(a => ["Liability", a.code, a.name, a.balance]), ["", "", "Total liabilities", balanceSheet.totalLiabilities], ...balanceSheet.equityAccounts.map(a => ["Equity", a.code, a.name, a.balance]), ["", "", "Total equity", balanceSheet.totalEquity]])
    } else if (activeTab === "cash-flow" && cashFlow) {
      downloadCsv("omega-cash-movement-" + startDate + "-to-" + endDate + ".csv", [["Account code", "Account name", "Opening balance", "Closing balance", "Net movement"], ...cashFlow.cashAccounts.map(a => [a.account_code, a.account_name, a.opening_balance, a.closing_balance, a.net_movement]), ["", "Totals", cashFlow.totalOpeningBalance, cashFlow.totalClosingBalance, cashFlow.netCashMovement]])
    } else if (activeTab === "vat" && vatSummary) {
      downloadCsv("omega-vat-summary-" + startDate + "-to-" + endDate + ".csv", [["Period start", "Period end", "Currency", "Output VAT", "Recoverable input VAT", "Net VAT payable"], [startDate, endDate, vatSummary.currency, vatSummary.outputVat, vatSummary.inputVat, vatSummary.netVatPayable]])
    }
  }

  const printReport = () => {
    if (activeTab === "trial-balance" && trialBalance) {
      const rows = trialBalance.accounts.map(a => `<tr><td>${escapeDocumentText(a.code)}</td><td>${escapeDocumentText(a.name)}</td><td>${escapeDocumentText(a.account_type)}</td><td class="num">${formatKES(Number(a.debit_balance), true)}</td><td class="num">${formatKES(Number(a.credit_balance), true)}</td></tr>`).join("")
      printBusinessDocument("Trial balance", asOfDate, `<header class="top"><div><div class="brand">${escapeDocumentText(user?.fullName ?? "Your business")}</div><h1>Trial balance</h1></div><div class="meta"><strong>As of ${escapeDocumentText(asOfDate)}</strong><div>${trialBalance.balanced ? "Balanced" : "Out of balance"}</div></div></header><table><thead><tr><th>Code</th><th>Account</th><th>Type</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead><tbody>${rows}</tbody></table><div class="totals"><div><span>Total debits</span><strong>${formatKES(trialBalance.totalDebits, true)}</strong></div><div><span>Total credits</span><strong>${formatKES(trialBalance.totalCredits, true)}</strong></div></div>`)
    } else if (activeTab === "profit-and-loss" && pnl) {
      const incomeRows = pnl.incomeAccounts.map(a => `<tr><td>${escapeDocumentText(a.code)}</td><td>${escapeDocumentText(a.name)}</td><td class="num">${fmt(a.balance)}</td></tr>`).join("")
      const expenseRows = pnl.expenseAccounts.map(a => `<tr><td>${escapeDocumentText(a.code)}</td><td>${escapeDocumentText(a.name)}</td><td class="num">${fmt(a.balance)}</td></tr>`).join("")
      printBusinessDocument("Profit and loss", startDate + " to " + endDate, `<header class="top"><div><div class="brand">${escapeDocumentText(user?.fullName ?? "Your business")}</div><h1>Profit and loss</h1></div><div class="meta"><strong>${escapeDocumentText(startDate)} to ${escapeDocumentText(endDate)}</strong></div></header><table><thead><tr><th colspan="2">Income</th><th class="num">Amount</th></tr></thead><tbody>${incomeRows}<tr class="subtotal"><td colspan="2">Total income</td><td class="num">${fmt(pnl.totalIncome)}</td></tr></tbody><thead><tr><th colspan="2">Expenses</th><th class="num">Amount</th></tr></thead><tbody>${expenseRows}<tr class="subtotal"><td colspan="2">Total expenses</td><td class="num">${fmt(pnl.totalExpenses)}</td></tr></tbody></table><div class="totals"><div><span>Net profit</span><strong>${fmt(pnl.netProfit)}</strong></div></div>`)
    } else if (activeTab === "balance-sheet" && balanceSheet) {
      const assetRows = balanceSheet.assetAccounts.map(a => `<tr><td>${escapeDocumentText(a.code)}</td><td>${escapeDocumentText(a.name)}</td><td class="num">${fmt(a.balance)}</td></tr>`).join("")
      const liabRows = balanceSheet.liabilityAccounts.map(a => `<tr><td>${escapeDocumentText(a.code)}</td><td>${escapeDocumentText(a.name)}</td><td class="num">${fmt(a.balance)}</td></tr>`).join("")
      const eqRows = balanceSheet.equityAccounts.map(a => `<tr><td>${escapeDocumentText(a.code)}</td><td>${escapeDocumentText(a.name)}</td><td class="num">${fmt(a.balance)}</td></tr>`).join("")
      printBusinessDocument("Balance sheet", asOfDate, `<header class="top"><div><div class="brand">${escapeDocumentText(user?.fullName ?? "Your business")}</div><h1>Balance sheet</h1></div><div class="meta"><strong>As of ${escapeDocumentText(asOfDate)}</strong><div>${balanceSheet.balanced ? "Balanced" : "Out of balance: " + formatKES(Math.abs(balanceSheet.variance), true)}</div></div></header><table><thead><tr><th colspan="2">Assets</th><th class="num">Amount</th></tr></thead><tbody>${assetRows}<tr class="subtotal"><td colspan="2">Total assets</td><td class="num">${fmt(balanceSheet.totalAssets)}</td></tr></tbody><thead><tr><th colspan="2">Liabilities</th><th class="num">Amount</th></tr></thead><tbody>${liabRows}<tr class="subtotal"><td colspan="2">Total liabilities</td><td class="num">${fmt(balanceSheet.totalLiabilities)}</td></tr></tbody><thead><tr><th colspan="2">Equity</th><th class="num">Amount</th></tr></thead><tbody>${eqRows}<tr class="subtotal"><td colspan="2">Total equity</td><td class="num">${fmt(balanceSheet.totalEquity)}</td></tr></tbody></table><div class="totals"><div><span>Total liabilities + equity</span><strong>${fmt(balanceSheet.totalLiabilitiesAndEquity)}</strong></div></div>`)
    } else if (activeTab === "cash-flow" && cashFlow) {
      const rows = cashFlow.cashAccounts.map(a => `<tr><td>${escapeDocumentText(a.account_code)}</td><td>${escapeDocumentText(a.account_name)}</td><td class="num">${fmt(a.opening_balance)}</td><td class="num">${fmt(a.closing_balance)}</td><td class="num">${fmt(a.net_movement)}</td></tr>`).join("")
      printBusinessDocument("Cash movement summary", startDate + " to " + endDate, `<header class="top"><div><div class="brand">${escapeDocumentText(user?.fullName ?? "Your business")}</div><h1>Cash movement summary</h1></div><div class="meta"><strong>${escapeDocumentText(startDate)} to ${escapeDocumentText(endDate)}</strong><div>Direct method</div></div></header><table><thead><tr><th>Code</th><th>Account</th><th class="num">Opening</th><th class="num">Closing</th><th class="num">Movement</th></tr></thead><tbody>${rows}<tr class="subtotal"><td colspan="2">Totals</td><td class="num">${fmt(cashFlow.totalOpeningBalance)}</td><td class="num">${fmt(cashFlow.totalClosingBalance)}</td><td class="num">${fmt(cashFlow.netCashMovement)}</td></tr></tbody></table>`)
    } else if (activeTab === "vat" && vatSummary) {
      printBusinessDocument("VAT summary", startDate + " to " + endDate, `<header class="top"><div><div class="brand">${escapeDocumentText(user?.fullName ?? "Your business")}</div><h1>VAT summary</h1></div><div class="meta"><strong>${escapeDocumentText(startDate)} to ${escapeDocumentText(endDate)}</strong></div></header><table><tbody><tr><td>Output VAT</td><td class="num">${fmt(vatSummary.outputVat)}</td></tr><tr><td>Recoverable input VAT</td><td class="num">${fmt(vatSummary.inputVat)}</td></tr><tr class="subtotal"><td>Net VAT payable</td><td class="num">${fmt(vatSummary.netVatPayable)}</td></tr></tbody></table>`)
    }
  }

  const showDateFilter = activeTab === "trial-balance" || activeTab === "balance-sheet"
  const showRangeFilter = activeTab === "profit-and-loss" || activeTab === "cash-flow" || activeTab === "vat"

  return (
    <BaseLayout>
      <div className="flex flex-col gap-6 px-4 lg:px-6">
        <PageHeader title="Financial reports" description="Profit and loss, balance sheet, cash movement and trial balance — from posted journal entries only." />

        <div className="flex flex-wrap gap-2">
          {tabs.map(tab => {
            const TabIcon = tab.icon
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => { setActiveTab(tab.id); setError(null) }}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${activeTab === tab.id ? "bg-primary text-primary-foreground" : "border border-border bg-card text-muted-foreground hover:bg-muted"}`}
              >
                <TabIcon className="size-4" />
                {tab.label}
              </button>
            )
          })}
        </div>

        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            {showDateFilter && (
              <div className="grid gap-2">
                <label className="text-sm font-medium">As of date</label>
                <Input type="date" value={asOfDate} onChange={e => setAsOfDate(e.target.value)} />
              </div>
            )}
            {showRangeFilter && (
              <>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Start date</label>
                  <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">End date</label>
                  <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
              </>
            )}
            <Button variant="outline" onClick={refresh} disabled={loading}><RefreshCw className="mr-2 size-4" />Refresh</Button>
            <Button variant="outline" onClick={exportCsv} disabled={loading || error !== null}><Download className="mr-2 size-4" />Export CSV</Button>
            <Button variant="outline" onClick={printReport} disabled={loading || error !== null}><Printer className="mr-2 size-4" />Print / Save PDF</Button>
          </CardContent>
        </Card>

        {error && (
          <div className="flex flex-col gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4 sm:flex-row sm:items-center" role="alert">
            <div className="flex-1 text-sm text-destructive">{error}</div>
            <Button variant="outline" size="sm" onClick={refresh}><RefreshCw className="mr-2 size-4" />Retry</Button>
          </div>
        )}

        {loading ? (
          <Card><CardContent className="flex justify-center p-12"><LoadingSpinner /></CardContent></Card>
        ) : error ? null : activeTab === "trial-balance" && trialBalance ? (
          <TrialBalanceReport report={trialBalance} />
        ) : activeTab === "profit-and-loss" && pnl ? (
          <ProfitAndLossReport report={pnl} />
        ) : activeTab === "balance-sheet" && balanceSheet ? (
          <BalanceSheetReport report={balanceSheet} />
        ) : activeTab === "cash-flow" && cashFlow ? (
          <CashFlowReport report={cashFlow} />
        ) : activeTab === "vat" && vatSummary ? (
          <VatSummaryReport report={vatSummary} />
        ) : (
          <EmptyState icon={FileBarChart} title="No data to report" description="The report will show posted account balances when the company has a chart of accounts and ledger activity." />
        )}
      </div>
    </BaseLayout>
  )
}

function VatSummaryReport({ report }: { report: VatSummary }) {
  const fmt = (v: number) => formatKES(v, true)
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Output VAT collected</p><p className="mt-2 text-2xl font-semibold tabular-nums">{fmt(report.outputVat)}</p></CardContent></Card>
      <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Recoverable input VAT</p><p className="mt-2 text-2xl font-semibold tabular-nums">{fmt(report.inputVat)}</p></CardContent></Card>
      <Card className="border-2"><CardContent className="p-4"><p className="text-sm text-muted-foreground">Net VAT payable / (credit)</p><p className="mt-2 text-2xl font-semibold tabular-nums">{fmt(report.netVatPayable)}</p><p className="mt-2 text-xs text-muted-foreground">Calculated from posted input and output VAT control-account movements for the selected period.</p></CardContent></Card>
    </div>
  )
}

function ReportSection({ title, accounts, totalLabel, totalAmount }: { title: string; accounts: { code: string; name: string; balance: number }[]; totalLabel: string; totalAmount: number }) {
  const fmt = (v: number) => formatKES(v, true)
  return (
    <Card>
      <CardContent className="p-0">
        <div className="border-b bg-muted/40 px-4 py-3"><h3 className="text-sm font-semibold">{title}</h3></div>
        {accounts.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">No accounts in this section.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground"><th className="p-3">Code</th><th className="p-3">Account</th><th className="p-3 text-right">Amount</th></tr></thead>
              <tbody>{accounts.map(a => <tr key={a.code + a.name} className="border-b last:border-0"><td className="p-3 tabular-nums">{a.code}</td><td className="p-3 font-medium">{a.name}</td><td className="p-3 text-right tabular-nums">{fmt(a.balance)}</td></tr>)}</tbody>
              <tfoot><tr className="bg-muted/40 font-semibold"><td className="p-3" colSpan={2}>{totalLabel}</td><td className="p-3 text-right tabular-nums">{fmt(totalAmount)}</td></tr></tfoot>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function TrialBalanceReport({ report }: { report: TrialBalance }) {
  const fmt = (v: number) => formatKES(v, true)
  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 p-4">
          <h2 className="font-semibold">Trial balance</h2>
          <span className={report.balanced ? "text-sm text-emerald-600" : "text-sm text-destructive"}>{report.balanced ? "Debits and credits balance" : "Out of balance: " + fmt(Math.abs(report.variance))}</span>
        </div>
        {report.accounts.length === 0 ? (
          <EmptyState icon={FileBarChart} title="No accounts to report" description="The trial balance will show posted account balances when the company has a chart of accounts and ledger activity." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-y bg-muted/40 text-left"><th className="p-3">Code</th><th className="p-3">Account</th><th className="p-3">Type</th><th className="p-3 text-right">Debit balance</th><th className="p-3 text-right">Credit balance</th></tr></thead>
              <tbody>{report.accounts.map(a => <tr key={a.id} className="border-b last:border-0"><td className="p-3 tabular-nums">{a.code}</td><td className="p-3 font-medium">{a.name}</td><td className="p-3 capitalize">{a.account_type}</td><td className="p-3 text-right tabular-nums">{fmt(a.debit_balance)}</td><td className="p-3 text-right tabular-nums">{fmt(a.credit_balance)}</td></tr>)}</tbody>
              <tfoot><tr className="bg-muted/40 font-semibold"><td className="p-3" colSpan={3}>Totals</td><td className="p-3 text-right tabular-nums">{fmt(report.totalDebits)}</td><td className="p-3 text-right tabular-nums">{fmt(report.totalCredits)}</td></tr></tfoot>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ProfitAndLossReport({ report }: { report: ProfitAndLoss }) {
  const fmt = (v: number) => formatKES(v, true)
  return (
    <div className="flex flex-col gap-4">
      <ReportSection title="Income" accounts={report.incomeAccounts} totalLabel="Total income" totalAmount={report.totalIncome} />
      <ReportSection title="Cost of sales" accounts={report.expenseAccounts.filter(a => a.system_code === "purchases_expense" || a.system_code === "cost_of_sales")} totalLabel="Total cost of sales" totalAmount={report.costOfSales} />
      <Card><CardContent className="flex items-center justify-between p-4"><span className="text-sm font-semibold text-muted-foreground">Gross profit</span><span className="text-lg font-bold tabular-nums">{fmt(report.grossProfit)}</span></CardContent></Card>
      <ReportSection title="Operating expenses" accounts={report.expenseAccounts.filter(a => a.system_code !== "purchases_expense" && a.system_code !== "cost_of_sales")} totalLabel="Total operating expenses" totalAmount={report.operatingExpenses} />
      <Card className="border-2"><CardContent className="flex items-center justify-between p-4"><div><span className="text-sm font-semibold text-muted-foreground">Net profit</span><p className="text-xs text-muted-foreground">Total income minus total expenses</p></div><span className={`text-xl font-bold tabular-nums ${report.netProfit >= 0 ? "text-emerald-600" : "text-destructive"}`}>{fmt(report.netProfit)}</span></CardContent></Card>
    </div>
  )
}

function BalanceSheetReport({ report }: { report: BalanceSheet }) {
  const fmt = (v: number) => formatKES(v, true)
  return (
    <div className="flex flex-col gap-4">
      <ReportSection title="Assets" accounts={report.assetAccounts} totalLabel="Total assets" totalAmount={report.totalAssets} />
      <ReportSection title="Liabilities" accounts={report.liabilityAccounts} totalLabel="Total liabilities" totalAmount={report.totalLiabilities} />
      <ReportSection title="Equity" accounts={report.equityAccounts} totalLabel="Total equity" totalAmount={report.totalEquity} />
      <Card className="border-2">
        <CardContent className="p-4">
          <div className="flex items-center justify-between"><span className="text-sm font-semibold text-muted-foreground">Total liabilities + equity</span><span className="text-lg font-bold tabular-nums">{fmt(report.totalLiabilitiesAndEquity)}</span></div>
          <div className={`mt-3 flex items-center justify-between border-t pt-3 ${report.balanced ? "text-emerald-600" : "text-destructive"}`}>
            <span className="text-sm font-semibold">{report.balanced ? "Balanced: assets = liabilities + equity" : "Out of balance"}</span>
            <span className="text-sm font-bold tabular-nums">{report.balanced ? "" : "Variance: " + fmt(Math.abs(report.variance))}</span>
          </div>
          {!report.balanced && <p className="mt-2 text-xs text-muted-foreground">The variance reflects unclassified accounts, rounding differences, or incomplete double-entry postings. It is reported as-is and never forced to zero.</p>}
        </CardContent>
      </Card>
    </div>
  )
}

function CashFlowReport({ report }: { report: CashFlow }) {
  const fmt = (v: number) => formatKES(v, true)
  return (
    <div className="flex flex-col gap-4">
      <Card><CardContent className="p-4">
        <div className="flex items-center gap-2 text-sm text-amber-600"><Wallet className="size-4" /><span className="font-medium">Cash movement summary (direct method)</span></div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{report.limitation}</p>
      </CardContent></Card>
      <Card><CardContent className="p-0">
        {report.cashAccounts.length === 0 ? (
          <EmptyState icon={Wallet} title="No cash accounts" description="Cash, bank, or M-Pesa accounts with posted journal entries will appear here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><th className="p-3">Code</th><th className="p-3">Account</th><th className="p-3 text-right">Opening</th><th className="p-3 text-right">Closing</th><th className="p-3 text-right">Movement</th></tr></thead>
              <tbody>{report.cashAccounts.map(a => <tr key={a.account_code} className="border-b last:border-0"><td className="p-3 tabular-nums">{a.account_code}</td><td className="p-3 font-medium">{a.account_name}</td><td className="p-3 text-right tabular-nums">{fmt(a.opening_balance)}</td><td className="p-3 text-right tabular-nums">{fmt(a.closing_balance)}</td><td className={`p-3 text-right tabular-nums font-semibold ${a.net_movement >= 0 ? "text-emerald-600" : "text-destructive"}`}>{fmt(a.net_movement)}</td></tr>)}</tbody>
              <tfoot><tr className="bg-muted/40 font-semibold"><td className="p-3" colSpan={2}>Totals</td><td className="p-3 text-right tabular-nums">{fmt(report.totalOpeningBalance)}</td><td className="p-3 text-right tabular-nums">{fmt(report.totalClosingBalance)}</td><td className={`p-3 text-right tabular-nums ${report.netCashMovement >= 0 ? "text-emerald-600" : "text-destructive"}`}>{fmt(report.netCashMovement)}</td></tr></tfoot>
            </table>
          </div>
        )}
      </CardContent></Card>
    </div>
  )
}
