"use client"

import * as React from "react"
import type { LucideIcon } from "lucide-react"
import {
  LayoutDashboard,
  ChartNoAxesCombined,
  Users,
  FileText,
  ShoppingCart,
  Store,
  Package,
  Receipt,
  Wallet,
  BookOpen,
  Building2,
  ScrollText,
  Settings,
  UserCog,
  Boxes,
  ArrowLeftRight,
  Banknote,
  ClipboardList,
  Building,
  UserCircle,
  Briefcase,
  CalendarDays,
  FileBarChart,
  Megaphone,
  UserRound,
  Headset,
  Factory,
  ShieldCheck,
  CreditCard,
  FileSignature,
  Layers3,
} from "lucide-react"
import { Link } from "react-router-dom"
import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { useMyCompany } from "@/hooks/use-company"
import { useAuth } from "@/contexts/auth-context"
import { api } from "@/lib/api-client"
import { Logo } from "@/components/logo"

type NavItem = { title: string; url: string; icon: LucideIcon; module?: string }
type NavGroup = { label: string; module: string; items: NavItem[] }
type SubscriptionAccess = { subscription: null | { status: string }; accessMode?: string; modules?: Record<string, boolean> | Array<{ code: string; enabled: boolean }> }

const navGroups: NavGroup[] = [
  {
    label: "Overview",
    module: "core",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
      { title: "Sales Dashboard", url: "/sales-dashboard", icon: ChartNoAxesCombined, module: "sales" },
    ],
  },
  {
    label: "CRM",
    module: "crm",
    items: [
      { title: "Leads & Pipeline", url: "/crm", icon: Users },
      { title: "Campaigns", url: "/crm/campaigns", icon: Megaphone },
      { title: "Customer Segments", url: "/crm/segments", icon: UserRound },
      { title: "Support Tickets", url: "/crm/tickets", icon: Headset },
    ],
  },
  {
    label: "Sales",
    module: "sales",
    items: [
      { title: "Customers", url: "/customers", icon: Users },
      { title: "Point of Sale", url: "/pos", icon: Store, module: "pos" },
      { title: "My Assigned Stock", url: "/salesperson-stock", icon: Boxes, module: "pos" },
      { title: "Quotations", url: "/quotations", icon: FileText },
      { title: "Sales Orders", url: "/sales-orders", icon: ShoppingCart },
      { title: "Invoices", url: "/invoices", icon: Receipt },
      { title: "Credit Notes", url: "/credit-notes", icon: FileText },
      { title: "Payments", url: "/payments", icon: Banknote },
    ],
  },
  {
    label: "Purchasing",
    module: "procurement",
    items: [
      { title: "Suppliers", url: "/suppliers", icon: Briefcase },
      { title: "Contracts", url: "/contracts", icon: FileSignature },
      { title: "Requisitions", url: "/requisitions", icon: ClipboardList },
      { title: "Purchase Orders", url: "/purchase-orders", icon: ClipboardList },
      { title: "Supplier Bills", url: "/supplier-bills", icon: FileText },
    ],
  },
  {
    label: "Inventory",
    module: "inventory",
    items: [
      { title: "Products", url: "/products", icon: Package },
      { title: "Stock Levels", url: "/stock-levels", icon: Boxes },
      { title: "Stocktakes", url: "/stocktakes", icon: ClipboardList },
      { title: "Warehouses", url: "/warehouses", icon: Building },
      { title: "Stock Movements", url: "/stock-movements", icon: ArrowLeftRight },
      { title: "Manufacturing", url: "/manufacturing", icon: Factory, module: "manufacturing" },
    ],
  },
  {
    label: "Finance",
    module: "accounting",
    items: [
      { title: "Chart of Accounts", url: "/chart-of-accounts", icon: BookOpen },
      { title: "Expenses", url: "/expenses", icon: Wallet },
      { title: "Financial Reports", url: "/financial-reports", icon: FileBarChart },
      { title: "Reports", url: "/reports", icon: FileBarChart, module: "reports" },
    ],
  },
  {
    label: "People",
    module: "hr_workforce",
    items: [
      { title: "Employees", url: "/employees", icon: UserCircle },
      { title: "Workforce", url: "/workforce", icon: ClipboardList },
      { title: "Payroll", url: "/payroll", icon: Banknote },
      { title: "Leave Management", url: "/leave-management", icon: CalendarDays },
    ],
  },
  {
    label: "Administration",
    module: "core",
    items: [
      { title: "Approval Inbox", url: "/approvals", icon: ShieldCheck, module: "procurement" },
      { title: "Companies & Branches", url: "/companies", icon: Building2 },
      { title: "Users & Roles", url: "/users-roles", icon: UserCog },
      { title: "Audit Logs", url: "/audit-logs", icon: ScrollText },
      { title: "Settings", url: "/settings", icon: Settings },
      { title: "Modules", url: "/settings/modules", icon: Layers3 },
      { title: "Plans & Billing", url: "/settings/billing", icon: CreditCard },
    ],
  },
]

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { company } = useMyCompany()
  const { user } = useAuth()
  const isSalesperson = user?.role === "salesperson"
  const [access, setAccess] = React.useState<SubscriptionAccess | null>(null)
  const [loadedCompanyId, setLoadedCompanyId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!company?.id) return
    let active = true
    void api.get<SubscriptionAccess>("/subscriptions/modules")
      .then((result) => { if (active) { setAccess(result); setLoadedCompanyId(company.id) } })
      .catch(() => {
        // Fail closed in the navigation when subscription data cannot be loaded.
        if (active) { setAccess({ subscription: { status: "unknown" }, modules: {} }); setLoadedCompanyId(company.id) }
      })
    return () => { active = false }
  }, [company?.id])

  const accessLoaded = Boolean(company?.id) && loadedCompanyId === company?.id
  const canShowModule = (moduleCode: string) => {
    if (!accessLoaded) return moduleCode === "core"
    if (moduleCode === "core") return true
    // Optional modules are visible only when the API explicitly confirms an active entitlement.
    if (!access?.subscription || !["active", "trialing"].includes(access.subscription.status)) return false
    if (Array.isArray(access.modules)) return access.modules.some((module) => module.code === moduleCode && module.enabled)
    return access.modules?.[moduleCode] === true
  }

  const visibleGroups = isSalesperson
    ? [
        {
          label: "My Workspace",
          module: "core",
          items: [
            { title: "Sales Dashboard", url: "/sales-dashboard", icon: ChartNoAxesCombined, module: "sales" },
            { title: "Point of Sale", url: "/pos", icon: Store, module: "pos" },
            { title: "My Assigned Stock", url: "/salesperson-stock", icon: Boxes, module: "inventory" },
            { title: "Customers", url: "/customers", icon: Users, module: "sales" },
          ].filter((item) => canShowModule(item.module)),
        },
      ]
    : navGroups.map((group) => ({
        ...group,
        items: group.items.filter((item) => canShowModule(item.module ?? group.module)),
      })).filter((group) => group.items.length > 0)

  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to={isSalesperson ? "/sales-dashboard" : "/dashboard"} />}>
              <div className="flex aspect-square size-10 shrink-0 items-center justify-center rounded-xl border border-white/70 bg-white p-1.5 shadow-sm">
                <Logo size={31} className="shrink-0" />
              </div>
              <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                <span className="truncate font-bold tracking-tight text-sidebar-foreground">Omega Solutions</span>
                <span className="truncate text-xs text-sidebar-foreground/75">
                  {company ? company.name : "ERP Platform"}
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {visibleGroups.map((group) => (
          <NavMain key={group.label} label={group.label} items={group.items} />
        ))}
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  )
}
