import { Navigate, Outlet, useLocation } from "react-router-dom"
import { useEffect, useState } from "react"
import { useAuth } from "@/contexts/auth-context"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
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
  const [accessLoaded, setAccessLoaded] = useState(false)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    setAccessLoaded(false)
    api.get<SubscriptionAccess>("/subscriptions/current")
      .then((result) => { if (!cancelled) setAccess(result) })
      .catch(() => { if (!cancelled) setAccess(null) })
      .finally(() => { if (!cancelled) setAccessLoaded(true) })
    return () => { cancelled = true }
  }, [user])

  const required = requiredModule(location.pathname)
  const hasSubscription = !!access?.subscription
  const moduleAllowed = required === "core" ||
    (!!access?.subscription &&
      ["active", "trialing"].includes(access.subscription.status) &&
      access.modules?.[required] === true)

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

  if (accessLoaded && hasSubscription && !moduleAllowed) {
    return <Navigate to="/settings/billing" replace state={{ blockedModule: required }} />
  }

  return <Outlet />
}
