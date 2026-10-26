import type { ComponentType } from "react"
import { type RouteObject } from "react-router-dom"
import { ProtectedLayout } from "@/components/router/protected-layout"

function page(load: () => Promise<{ default: ComponentType }>) {
  return async () => ({ Component: (await load()).default })
}

export const routes: RouteObject[] = [
  { path: "/", lazy: page(() => import("@/app/landing/page")) },
  { path: "/login", lazy: page(() => import("@/app/login/page")) },
  { path: "/accept-invitation", lazy: page(() => import("@/app/accept-invitation/page")) },
  {
    element: <ProtectedLayout />,
    children: [
      { path: "/dashboard", lazy: page(() => import("@/app/dashboard/page")) },
      { path: "/sales-dashboard", lazy: page(() => import("@/app/sales-dashboard/page")) },
      { path: "/salesperson-stock", lazy: page(() => import("@/app/salesperson-stock/page")) },
      { path: "/crm", lazy: page(() => import("@/app/crm/page")) },
      { path: "/crm/campaigns", lazy: page(() => import("@/app/crm/campaigns/page")) },
      { path: "/crm/segments", lazy: page(() => import("@/app/crm/segments/page")) },
      { path: "/crm/tickets", lazy: page(() => import("@/app/crm/tickets/page")) },
      { path: "/customers", lazy: page(() => import("@/app/customers/page")) },
      { path: "/pos", lazy: page(() => import("@/app/pos/page")) },
      { path: "/quotations", lazy: page(() => import("@/app/quotations/page")) },
      { path: "/sales-orders", lazy: page(() => import("@/app/sales-orders/page")) },
      { path: "/invoices", lazy: page(() => import("@/app/invoices/page")) },
      { path: "/credit-notes", lazy: page(() => import("@/app/credit-notes/page")) },
      { path: "/reports", lazy: page(() => import("@/app/reports/page")) },
      { path: "/payments", lazy: page(() => import("@/app/payments/page")) },
      { path: "/suppliers", lazy: page(() => import("@/app/suppliers/page")) },
      { path: "/purchase-orders", lazy: page(() => import("@/app/purchase-orders/page")) },
      { path: "/requisitions", lazy: page(() => import("@/app/requisitions/page")) },
      { path: "/contracts", lazy: page(() => import("@/app/contracts/page")) },
      { path: "/approvals", lazy: page(() => import("@/app/approvals/page")) },
      { path: "/supplier-bills", lazy: page(() => import("@/app/supplier-bills/page")) },
      { path: "/products", lazy: page(() => import("@/app/products/page")) },
      { path: "/stock-levels", lazy: page(() => import("@/app/stock-levels/page")) },
      { path: "/warehouses", lazy: page(() => import("@/app/warehouses/page")) },
      { path: "/stock-movements", lazy: page(() => import("@/app/stock-movements/page")) },
      { path: "/manufacturing", lazy: page(() => import("@/app/manufacturing/page")) },
      { path: "/chart-of-accounts", lazy: page(() => import("@/app/chart-of-accounts/page")) },
      { path: "/expenses", lazy: page(() => import("@/app/expenses/page")) },
      { path: "/financial-reports", lazy: page(() => import("@/app/financial-reports/page")) },
      { path: "/employees", lazy: page(() => import("@/app/employees/page")) },
      { path: "/workforce", lazy: page(() => import("@/app/workforce/page")) },
      { path: "/payroll", lazy: page(() => import("@/app/payroll/page")) },
      { path: "/leave-management", lazy: page(() => import("@/app/leave-management/page")) },
      { path: "/companies", lazy: page(() => import("@/app/companies/page")) },
      { path: "/users-roles", lazy: page(() => import("@/app/users-roles/page")) },
      { path: "/audit-logs", lazy: page(() => import("@/app/audit-logs/page")) },
      { path: "/settings", lazy: page(() => import("@/app/settings/page")) },
      { path: "/settings/billing", lazy: page(() => import("@/app/settings/billing/page")) },
      { path: "/settings/modules", lazy: page(() => import("@/app/settings/modules/page")) },
      { path: "/settings/tax", lazy: page(() => import("@/app/settings/tax/page")) },
    ],
  },
  { path: "*", lazy: page(() => import("@/app/errors/not-found/page")) },
]
