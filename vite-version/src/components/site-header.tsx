"use client"

import * as React from "react"
import { Bell, Building2, Check, ChevronsUpDown } from "lucide-react"
import { useLocation, useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { CommandSearch, SearchTrigger } from "@/components/command-search"
import { ModeToggle } from "@/components/mode-toggle"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "cn"
import { api } from "@/lib/api-client"
import { useAuth } from "@/contexts/auth-context"

const routeLabels: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/customers": "Customers",
  "/quotations": "Quotations",
  "/sales-orders": "Sales Orders",
  "/invoices": "Invoices",
  "/payments": "Payments",
  "/suppliers": "Suppliers",
  "/purchase-orders": "Purchase Orders",
  "/supplier-bills": "Supplier Bills",
  "/products": "Products",
  "/stock-levels": "Stock Levels",
  "/warehouses": "Warehouses",
  "/stock-movements": "Stock Movements",
  "/chart-of-accounts": "Chart of Accounts",
  "/expenses": "Expenses",
  "/financial-reports": "Financial Reports",
  "/employees": "Employees",
  "/payroll": "Payroll",
  "/leave-management": "Leave Management",
  "/companies": "Companies & Branches",
  "/users-roles": "Users & Roles",
  "/audit-logs": "Audit Logs",
  "/settings": "Settings",
}

function Breadcrumb() {
  const location = useLocation()
  const label = routeLabels[location.pathname] ?? "Page"
  return (
    <nav aria-label="Breadcrumb" className="hidden sm:flex items-center text-sm text-muted-foreground">
      <span>Omega Solutions</span>
      <span className="mx-1.5 text-border">/</span>
      <span className="font-medium text-foreground">{label}</span>
    </nav>
  )
}

export function SiteHeader() {
  const navigate = useNavigate()
  const { user, switchCompany } = useAuth()
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [notifications, setNotifications] = React.useState<{ id: string; title: string; message: string; time: string; read: boolean; href?: string | null }[]>([])
  const [notificationsLoading, setNotificationsLoading] = React.useState(true)
  const [notificationsError, setNotificationsError] = React.useState("")
  const [unreadCount, setUnreadCount] = React.useState(0)
  const [companies, setCompanies] = React.useState<{ id: string; name: string; role: string; branchId: string | null }[]>([])
  const [companiesLoadedFor, setCompaniesLoadedFor] = React.useState("")
  const companyLoading = Boolean(user?.userId) && companiesLoadedFor !== user?.userId
  const [companyError, setCompanyError] = React.useState("")
  const [switchingCompanyId, setSwitchingCompanyId] = React.useState<string | null>(null)

  const loadRequestId = React.useRef(0)
  const loadNotifications = React.useCallback(async () => {
    const requestId = ++loadRequestId.current
    setNotificationsLoading(true)
    // Clear previous-company data while reloading so a failed request cannot leave
    // stale notifications visible after a company switch or token refresh.
    setNotifications([])
    setUnreadCount(0)
    setNotificationsError("")
    try {
      const data = await api.get<{ items: { id: string; title: string; message: string; href?: string | null; read_at: string | null; created_at: string }[]; unreadCount: number }>("/notifications")
      if (requestId !== loadRequestId.current) return
      setNotifications(data.items.map((n) => ({
        id: n.id, title: n.title, message: n.message,
        time: new Date(n.created_at).toLocaleString(), read: Boolean(n.read_at), href: n.href,
      })))
      setUnreadCount(data.unreadCount ?? 0)
      setNotificationsError("")
    } catch (error) {
      if (requestId !== loadRequestId.current) return
      setNotifications([])
      setUnreadCount(0)
      setNotificationsError(error instanceof Error ? error.message : (error as { message?: string })?.message ?? "Notifications could not be loaded.")
    } finally {
      if (requestId === loadRequestId.current) setNotificationsLoading(false)
    }
  }, [])

  React.useEffect(() => {
    let active = true
    const requestId = ++loadRequestId.current
    void api.get<{ items: { id: string; title: string; message: string; href?: string | null; read_at: string | null; created_at: string }[]; unreadCount: number }>("/notifications")
      .then((data) => {
        if (!active || requestId !== loadRequestId.current) return
        setNotifications(data.items.map((n) => ({
          id: n.id, title: n.title, message: n.message,
          time: new Date(n.created_at).toLocaleString(), read: Boolean(n.read_at), href: n.href,
        })))
        setUnreadCount(data.unreadCount ?? 0)
        setNotificationsError("")
      })
      .catch((error) => {
        if (!active || requestId !== loadRequestId.current) return
        setNotifications([])
        setUnreadCount(0)
        setNotificationsError(error instanceof Error ? error.message : (error as { message?: string })?.message ?? "Notifications could not be loaded.")
      })
      .finally(() => { if (active && requestId === loadRequestId.current) setNotificationsLoading(false) })
    return () => { active = false }
  }, [])

  React.useEffect(() => {
    if (!user?.userId) return
    let active = true
    void api.get<{ id: string; name: string; role: string; branchId: string | null }[]>("/auth/companies")
      .then((items) => {
        if (active) {
          setCompanies(items)
          setCompanyError("")
          setCompaniesLoadedFor(user.userId)
        }
      })
      .catch((error) => {
        if (active) {
          setCompanies([])
          setCompanyError(error instanceof Error ? error.message : (error as { message?: string })?.message ?? "Companies could not be loaded.")
          setCompaniesLoadedFor(user.userId)
        }
      })
    return () => { active = false }
  }, [user?.userId, user?.companyId])

  const changeCompany = async (companyId: string) => {
    if (!companyId || companyId === user?.companyId || switchingCompanyId) return
    setSwitchingCompanyId(companyId)
    setCompanyError("")
    try {
      await switchCompany(companyId)
      navigate("/dashboard")
      void loadNotifications()
    } catch (error) {
      setCompanyError(error instanceof Error ? error.message : (error as { message?: string })?.message ?? "Company switch failed.")
    } finally {
      setSwitchingCompanyId(null)
    }
  }

  const markAllRead = async () => {
    try {
      await api.post("/notifications/read-all")
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
      setUnreadCount(0)
      setNotificationsError("")
    } catch (error) {
      setNotificationsError(error instanceof Error ? error.message : "Could not mark notifications as read.")
    }
  }

  const markRead = async (id: string): Promise<boolean> => {
    const notification = notifications.find((n) => n.id === id)
    if (!notification) return false
    if (notification.read) return true
    try {
      await api.patch(`/notifications/${id}/read`)
      setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n))
      setUnreadCount((count) => Math.max(0, count - 1))
      setNotificationsError("")
      return true
    } catch (error) {
      setNotificationsError(error instanceof Error ? error.message : "Could not mark notification as read.")
      return false
    }
  }

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setSearchOpen((open) => !open)
      }
    }
    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [])

  return (
    <>
      <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
        <div className="flex w-full items-center gap-1 px-4 py-3 lg:gap-2 lg:px-6">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mx-2 data-vertical:self-center data-vertical:h-4"
          />
          <Breadcrumb />
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden md:block max-w-sm flex-1">
              <SearchTrigger onClick={() => setSearchOpen(true)} />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" className="max-w-56 gap-2 cursor-pointer" disabled={companyLoading || !user?.userId}>
                    <Building2 className="size-4 shrink-0" />
                    <span className="hidden truncate sm:inline">
                      {companies.find((company) => company.id === user?.companyId)?.name ?? (companyLoading ? "Loading company…" : "Company")}
                    </span>
                    <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-72 rounded-lg">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Switch company</DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                {companyError && <div role="alert" className="px-2 py-2 text-xs text-destructive">{companyError}</div>}
                {companyLoading && <div className="px-2 py-2 text-sm text-muted-foreground">Loading companies…</div>}
                {!companyLoading && companies.map((company) => (
                  <DropdownMenuItem
                    key={company.id}
                    disabled={Boolean(switchingCompanyId)}
                    onClick={() => { void changeCompany(company.id) }}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <Building2 className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{company.name}</span>
                      <span className="block text-xs capitalize text-muted-foreground">{company.role.replaceAll("_", " ")}</span>
                    </span>
                    {switchingCompanyId === company.id
                      ? <span className="text-xs text-muted-foreground">Switching…</span>
                      : company.id === user?.companyId ? <Check className="size-4 text-primary" /> : null}
                  </DropdownMenuItem>
                ))}
                {!companyLoading && companies.length === 0 && !companyError && (
                  <div className="px-2 py-3 text-sm text-muted-foreground">No active company memberships found.</div>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu onOpenChange={(open) => { if (open) void loadNotifications() }}>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="icon" className="relative cursor-pointer" />
                }
              >
                <Bell className="size-[1.2rem]" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
                    {unreadCount}
                  </span>
                )}
                <span className="sr-only">Notifications</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-80 rounded-lg"
                align="end"
                sideOffset={8}
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="flex items-center justify-between">
                    <span>Notifications</span>
                    {unreadCount > 0 && (
                      <button
                        onClick={markAllRead}
                        className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        Mark all read
                      </button>
                    )}
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                {notificationsError && <div className="px-3 py-2 text-xs text-destructive">{notificationsError}</div>}
                {notificationsLoading && <div className="px-3 py-3 text-sm text-muted-foreground">Loading notifications…</div>}
                {!notificationsLoading && notifications.map((n) => (
                  <DropdownMenuItem
                    key={n.id}
                    className={cn(
                      "flex flex-col items-start gap-0.5 py-2.5 cursor-default",
                      !n.read && "bg-primary/5"
                    )}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      {n.href && /^\/(?!\/)/.test(n.href) ? (
                        <a href={n.href || "#"} className="text-sm font-medium hover:underline" onClick={async (event) => { event.preventDefault(); if (await markRead(n.id) && n.href) navigate(n.href) }}>{n.title}</a>
                      ) : (
                        <span className="text-sm font-medium">{n.title}</span>
                      )}
                      {!n.read && (
                        <button
                          type="button"
                          aria-label={`Mark ${n.title} as read`}
                          title="Mark as read"
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            void markRead(n.id)
                          }}
                          className="inline-flex size-7 items-center justify-center rounded hover:bg-muted"
                        >
                          <Check className="size-4" />
                        </button>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">{n.message}</span>
                    <span className="text-xs text-muted-foreground/70">{n.time}</span>
                  </DropdownMenuItem>
                ))}
                {!notificationsLoading && notifications.length === 0 && !notificationsError && (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    <Check className="mx-auto mb-2 size-5" />
                    All caught up
                  </div>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <ModeToggle />
          </div>
        </div>
      </header>
      <CommandSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  )
}
