"use client"

import { useEffect, useState } from "react"
import {
  Building2,
  Check,
  CreditCard,
  EllipsisVertical,
  LoaderCircle,
  LogOut,
  CircleUser,
  Settings,
} from "lucide-react"
import { Link, useNavigate } from "react-router-dom"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { useAuth } from "@/contexts/auth-context"
import { api } from "@/lib/api-client"

interface CompanyMembership {
  id: string
  name: string
  role: string
  branchId: string | null
}

export function NavUser() {
  const { isMobile } = useSidebar()
  const { user, logout, switchCompany } = useAuth()
  const navigate = useNavigate()
  const [companies, setCompanies] = useState<CompanyMembership[]>([])
  const [companiesLoading, setCompaniesLoading] = useState(false)
  const [switchingCompanyId, setSwitchingCompanyId] = useState<string | null>(null)
  const [companyError, setCompanyError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    void Promise.resolve().then(() => {
      if (cancelled) return null
      setCompaniesLoading(true)
      return api.get<CompanyMembership[]>("/auth/companies")
    }).then((items) => {
        if (!cancelled) setCompanies(Array.isArray(items) ? items : [])
      })
      .catch(() => {
        if (!cancelled) setCompanyError("Company list could not be loaded.")
      })
      .finally(() => {
        if (!cancelled) setCompaniesLoading(false)
      })
    return () => { cancelled = true }
  }, [user?.userId, user?.companyId])

  if (!user) return null

  const initials = user.fullName
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")

  const handleLogout = () => {
    logout()
    navigate("/login", { replace: true })
  }

  const handleCompanySwitch = async (companyId: string) => {
    if (companyId === user.companyId || switchingCompanyId) return
    setCompanyError(null)
    setSwitchingCompanyId(companyId)
    try {
      await switchCompany(companyId)
      // Reload the active route so company-scoped caches, details and module state
      // from the previous tenant cannot remain visible after the token changes.
      window.location.reload()
    } catch (error) {
      setCompanyError(error instanceof Error ? error.message : "Could not switch company. Please try again.")
      setSwitchingCompanyId(null)
    }
  }

  const showCompanySwitcher = companiesLoading || companies.length > 1

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground cursor-pointer"
              />
            }
          >
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold text-primary">
              {initials}
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{user.fullName}</span>
              <span className="text-muted-foreground truncate text-xs capitalize">
                {user.role}
              </span>
            </div>
            <EllipsisVertical className="ml-auto" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--anchor-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal text-foreground">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold text-primary">
                    {initials}
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{user.fullName}</span>
                    <span className="text-muted-foreground truncate text-xs">
                      {user.email}
                    </span>
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            {showCompanySwitcher && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="flex items-center gap-2 text-xs">
                    <Building2 className="size-3.5" />
                    Switch company
                  </DropdownMenuLabel>
                  {companiesLoading ? (
                    <DropdownMenuItem disabled>
                      <LoaderCircle className="animate-spin" />
                      Loading companies…
                    </DropdownMenuItem>
                  ) : (
                    companies.map((company) => (
                      <DropdownMenuItem
                        key={company.id}
                        disabled={Boolean(switchingCompanyId)}
                        className="cursor-pointer"
                        onClick={() => void handleCompanySwitch(company.id)}
                      >
                        <Building2 />
                        <span className="min-w-0 flex-1 truncate">{company.name}</span>
                        {company.id === user.companyId ? (
                          <Check className="ml-auto text-primary" />
                        ) : switchingCompanyId === company.id ? (
                          <LoaderCircle className="ml-auto animate-spin" />
                        ) : null}
                      </DropdownMenuItem>
                    ))
                  )}
                  {companyError && (
                    <div role="status" className="px-2 py-1.5 text-xs text-destructive">
                      {companyError}
                    </div>
                  )}
                </DropdownMenuGroup>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                className="cursor-pointer"
                render={<Link to="/settings" />}
              >
                <Settings />
                Settings
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer"
                render={<Link to="/users-roles" />}
              >
                <CircleUser />
                Users & Roles
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer"
                render={<Link to="/audit-logs" />}
              >
                <CreditCard />
                Audit Logs
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                className="cursor-pointer text-destructive"
                onClick={handleLogout}
              >
                <LogOut />
                Log out
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
