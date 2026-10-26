"use client"

import * as React from "react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { PricingPlans } from "@/components/pricing-plans"
import { api } from "@/lib/api-client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Loader2, PlusCircle } from "lucide-react"
import { Button } from "@/components/ui/button"

type Plan = {
  code: string
  name: string
  description: string
  monthlyPriceKes: number
  isCustomPricing?: boolean
  currency: string
  limits: { users: number; branches: number }
  modules: { code: string; name: string }[]
}

type Current = {
  subscription: null | { planCode: string; planName: string; status: string; monthlyPriceKes: number }
  accessMode: string
  modules?: Record<string, boolean>
  message?: string
}

export default function BillingSettings() {
  const [plans, setPlans] = React.useState<Plan[]>([])
  const [current, setCurrent] = React.useState<Current | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [requesting, setRequesting] = React.useState(false)
  const [requestingModule, setRequestingModule] = React.useState<string | null>(null)
  const [paymentReference, setPaymentReference] = React.useState<string | null>(null)
  const [checkingPayment, setCheckingPayment] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    Promise.all([
      api.get<Plan[]>("/subscriptions/plans"),
      api.get<Current>("/subscriptions/current"),
    ]).then(([available, active]) => {
      if (cancelled) return
      setPlans(available)
      setCurrent(active)
    }).catch((err: { message?: string }) => {
      if (!cancelled) setError(err.message ?? "Could not load subscription information.")
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const handlePlanSelect = async (planCode: string) => {
    setRequesting(true)
    setError(null)
    setNotice(null)
    try {
      if (planCode === "enterprise_custom") {
        const result = await api.post<{ message: string }>(
          "/subscriptions/change-requests",
          { planCode, note: "Enterprise custom pricing quote requested." },
        )
        setNotice(result.message)
        return
      }
      if (!current?.subscription) {
        const checkout = await api.post<{
          authorizationUrl: string
          reference: string
          amountKes: number
          currency: string
        }>("/subscriptions/checkout", { planCode })
        setNotice("Opening secure Paystack test checkout…")
        window.location.assign(checkout.authorizationUrl)
        return
      }
      const result = await api.post<{ message: string }>("/subscriptions/change-requests", { planCode })
      setNotice(result.message)
    } catch (err) {
      setError((err as { message?: string }).message ?? "Could not start subscription checkout or submit the plan request.")
    } finally {
      setRequesting(false)
    }
  }

  const checkPaymentStatus = React.useCallback(async (reference: string) => {
    setCheckingPayment(true)
    setError(null)
    try {
      const payment = await api.get<{
        status: string
        plan_code: string
        amount_kes: number
      }>(`/subscriptions/payments/${encodeURIComponent(reference)}`)
      if (payment.status === "success") {
        setNotice("Payment confirmed. Your Omega subscription is active.")
        const refreshed = await api.get<Current>("/subscriptions/current")
        setCurrent(refreshed)
      } else if (payment.status === "pending") {
        setNotice("Payment is awaiting server-side confirmation. Omega will not activate the subscription until Paystack verification succeeds.")
      } else {
        setNotice(`Payment status: ${payment.status}. No subscription access was activated by this payment.`)
      }
    } catch (err) {
      setError((err as { message?: string }).message ?? "Could not check payment status.")
    } finally {
      setCheckingPayment(false)
    }
  }, [])

  React.useEffect(() => {
    const reference = new URLSearchParams(window.location.search).get("reference")
    if (!reference) return
    setPaymentReference(reference)
    window.history.replaceState({}, "", window.location.pathname)
    void checkPaymentStatus(reference)
  }, [checkPaymentStatus])

  const handleModuleSelect = async (moduleCode: string) => {
    setRequestingModule(moduleCode)
    setError(null)
    setNotice(null)
    try {
      const result = await api.post<{ message: string }>("/subscriptions/module-requests", { moduleCode })
      setNotice(result.message)
    } catch (err) {
      setError((err as { message?: string }).message ?? "Could not submit the add-on request.")
    } finally {
      setRequestingModule(null)
    }
  }

  const moduleBenefits: Record<string, string> = {
    core: "Company users, roles and access controls",
    inventory: "Stock levels, warehouses and stock movements",
    sales: "Quotations, orders, invoices and customer sales",
    pos: "Fast checkout and salesperson workflows",
    reports: "Business performance reports",
    accounting: "Accounts, journals and financial reconciliation",
    procurement: "Requisitions, purchase orders, supplier bills and contracts",
    crm: "Lead pipeline, opportunities and customer follow-up",
    manufacturing: "Bills of materials, production orders and costing",
    hr_workforce: "Employee records, attendance and payroll workflows",
  }

  const formattedPlans = plans.map((plan) => ({
    id: plan.code,
    name: plan.name,
    description: plan.description,
    price: plan.isCustomPricing ? "Custom quote" : `KSh ${plan.monthlyPriceKes.toLocaleString("en-KE")}`,
    frequency: plan.isCustomPricing ? "" : "/month",
    customPricing: plan.isCustomPricing,
    popular: plan.code === "medium",
    features: [
      ...plan.modules.map((module) => moduleBenefits[module.code] ?? module.name),
      ...(plan.isCustomPricing ? ["Tailored user and branch limits", "Custom integrations and onboarding", "Agreed support and service scope"] : [
        `${plan.limits.users} users`,
        `${plan.limits.branches} branch${plan.limits.branches === 1 ? "" : "es"}`,
      ]),
    ],
  }))

  const allOptionalModules = [
    { code: "accounting", name: "Finance & Accounting", description: "Accounts, expenses and financial control" },
    { code: "procurement", name: "Procurement", description: "Purchase orders, supplier bills and approvals" },
    { code: "crm", name: "CRM", description: "Sales pipeline and customer follow-ups" },
    { code: "manufacturing", name: "Manufacturing", description: "Production orders, bills of materials and costing" },
    { code: "hr_workforce", name: "HR & Workforce", description: "Employees, attendance and payroll workflows" },
  ]
  const addOnModules = current?.subscription
    ? allOptionalModules.filter((module) => current.modules?.[module.code] !== true)
    : []

  return (
    <BaseLayout>
      <div className="flex flex-col gap-6 px-4 lg:px-6">
        <div>
          <h1 className="text-3xl font-bold">Plans & Billing</h1>
          <p className="text-muted-foreground">Choose the Omega ERP package that fits your business.</p>
        </div>

        {error && <Alert variant="destructive"><AlertTitle>Subscription information</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
        {notice && <Alert><AlertTitle>{paymentReference ? "Payment status" : "Request submitted"}</AlertTitle><AlertDescription>{notice}</AlertDescription></Alert>}
        {current?.subscription && ["business", "enterprise"].includes(current.subscription.planCode) && (
          <Alert>
            <AlertTitle>Existing subscription protected</AlertTitle>
            <AlertDescription>
              Your existing plan remains at its current price and terms. The new four-tier catalogue applies to new subscriptions and approved plan changes; no automatic repricing has occurred.
            </AlertDescription>
          </Alert>
        )}
        {paymentReference && <div className="flex flex-wrap items-center gap-3"><span className="text-sm text-muted-foreground">Reference: {paymentReference}</span><Button type="button" variant="outline" disabled={checkingPayment} onClick={() => void checkPaymentStatus(paymentReference)}>{checkingPayment && <Loader2 className="mr-2 size-4 animate-spin" />}{checkingPayment ? "Checking…" : "Check payment status"}</Button></div>}

        <Card>
          <CardHeader>
            <CardTitle>Current subscription</CardTitle>
            <CardDescription>Your company subscription status. First-time plan checkout uses Paystack test mode when configured. Plan changes for an existing subscription still require review.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading subscription…</div>
            ) : current?.subscription ? (
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-xl font-semibold">{current.subscription.planName}</span>
                <span>KSh {current.subscription.monthlyPriceKes.toLocaleString("en-KE")}/month</span>
                <span className="text-sm text-muted-foreground">Status: {current.subscription.status.replaceAll("_", " ")}</span>
              </div>
            ) : (
              <p className="text-muted-foreground">No paid plan is recorded yet. Existing company access remains unchanged while billing is being configured.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Available plans</CardTitle>
            <CardDescription>Prices are in Kenyan shillings and billed monthly.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading plans…</div>
            ) : (
              <PricingPlans
                plans={formattedPlans}
                mode="billing"
                currentPlanId={current?.subscription?.planCode === "business" ? "medium" : current?.subscription?.planCode}
                onPlanSelect={handlePlanSelect}
              />
            )}
            {requesting && <p className="mt-4 text-sm text-muted-foreground">Submitting your request…</p>}
            <p className="mt-4 text-sm text-muted-foreground">First-time subscription checkout uses Paystack test mode while billing is being validated. Existing plan changes remain requests until reviewed. Never enter real card or M-Pesa payment details in a test transaction.</p>
          </CardContent>
        </Card>
        {current?.subscription && addOnModules.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Optional modules</CardTitle>
              <CardDescription>Request an add-on for your current plan. Requests are reviewed before activation; no charge or access change happens automatically.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {addOnModules.map((module) => (
                <div key={module.code} className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">{module.name}</p>
                    <p className="text-sm text-muted-foreground">{module.description}</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={requestingModule !== null}
                    onClick={() => handleModuleSelect(module.code)}
                  >
                    {requestingModule === module.code ? <Loader2 className="mr-2 size-4 animate-spin" /> : <PlusCircle className="mr-2 size-4" />}
                    Request module
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </BaseLayout>
  )
}
