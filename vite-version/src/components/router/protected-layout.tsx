import { Navigate, Outlet, useLocation } from "react-router-dom"
import { useEffect, useState } from "react"
import { useAuth } from "@/contexts/auth-context"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api-client"

type SubscriptionAccess = {
  subscription: null | { status: string }
  modules?: Record<string, boolean>
}

function requiredModule(pathname: string): string {
  if (pathname === "/settings/billing") return "core"
  if (pathname === "/crm" || pathname.startsWith("/crm/")) return "crm"
  if (pathname === "/pos" || pathname.startsWith("/pos/") || pathname === "/salesperson-stock") return "pos"
  if (["/sales-dashboard", "/customers", "/quotations", "/sales-orders", "/invoices", "/credit-notes", "/payments"].some((path) => pathname === path || pathname.startsWith(path + "/"))) return "sales"
  if (["/suppliers", "/requisitions", "/purchase-orders", "/contracts", "/supplier-bills", "/approvals"].some((path) => pathname === path || pathname.startsWith(path + "/"))) return "procurement"
  if (["/products", "/stock-levels", "/warehouses", "/stock-movements"].some((path) => pathname === path || pathname.startsWith(path + "/"))) return "inventory"
  if (pathname === "/manufacturing" || pathname.startsWith("/manufacturing/")) return "manufacturing"
  if (["/chart-of-accounts", "/expenses", "/financial-reports"].some((path) => pathname === path || pathname.startsWith(path + "/"))) return "accounting"
  if (["/employees", "/workforce", "/payroll", "/leave-management"].some((path) => pathname === path || pathname.startsWith(path + "/"))) return "hr_workforce"
  if (pathname === "/reports" || pathname.startsWith("/reports/")) return "reports"
  return "core"
}

export function ProtectedLayout() {
  const { user, loading } = useAuth()
  const location = useLocation()
  const [access, setAccess] = useState<SubscriptionAccess | null>(null)
  const [loadedRequestKey, setLoadedRequestKey] = useState("")
  const [errorRequestKey, setErrorRequestKey] = useState("")
  const [accessRetry, setAccessRetry] = useState(0)
  const requestKey = user ? `${user.userId}:${user.companyId}:${accessRetry}` : ""

  useEffect(() => {
    if (!user) return
    let active = true
    void api.get<SubscriptionAccess>("/subscriptions/current")
      .then((result) => { if (active) { setAccess(result); setLoadedRequestKey(requestKey); setErrorRequestKey("") } })
      .catch(() => { if (active) { setAccess(null); setErrorRequestKey(requestKey) } })
    return () => { active = false }
  }, [user?.userId, user?.companyId, accessRetry])

  const accessLoaded = Boolean(requestKey) && loadedRequestKey === requestKey
  const accessError = Boolean(requestKey) && errorRequestKey === requestKey
  const currentAccess = accessLoaded ? access : null
  const required = requiredModule(location.pathname)
  const hasSubscription = !!currentAccess?.subscription
  const moduleAllowed = required === "core" ||
    (!!currentAccess?.subscription &&
      ["active", "trialing"].includes(currentAccess.subscription.status) &&
      currentAccess.modules?.[required] === true)

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <LoadingSpinner />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (user.role === "salesperson" && location.pathname === "/dashboard") {
    return <Navigate to="/sales-dashboard" replace />
  }

  if (accessLoaded && accessError) {
    return (
      <div className="flex min-h-svh items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-xl border bg-card p-6 text-card-foreground shadow-sm">
          <h1 className="text-lg font-semibold">Could not verify module access</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Omega could not load this company’s subscription and module access. For your protection, retry before continuing.
          </p>
          <Button className="mt-4" onClick={() => setAccessRetry((attempt) => attempt + 1)}>
            Retry verification
          </Button>
        </div>
      </div>
    )
  }

  if (accessLoaded && hasSubscription && !moduleAllowed) {
    return <Navigate to="/settings/billing" replace state={{ blockedModule: required }} />
  }

  return <Outlet />
}
