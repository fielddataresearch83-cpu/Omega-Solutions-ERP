"use client"

import { Building2, Check, ChevronsUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export interface CompanyMembershipOption {
  id: string
  name: string
  role: string
  branchId: string | null
}

interface CompanySwitcherProps {
  companies: CompanyMembershipOption[]
  currentCompanyId: string | null | undefined
  loading: boolean
  error: string
  switchingCompanyId: string | null
  onSelect: (companyId: string) => void
}

export function CompanySwitcher({
  companies,
  currentCompanyId,
  loading,
  error,
  switchingCompanyId,
  onSelect,
}: CompanySwitcherProps) {
  const currentCompany = companies.find((company) => company.id === currentCompanyId)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            className="max-w-56 gap-2 cursor-pointer"
            disabled={loading || !currentCompanyId}
            aria-label={`Active company: ${currentCompany?.name ?? "Company"}. Switch company`}
          />
        }
      >
        <Building2 className="size-4 shrink-0" />
        <span className="hidden truncate sm:inline">
          {currentCompany?.name ?? (loading ? "Loading company…" : "Company")}
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 rounded-lg">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Switch company</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {error && <div role="alert" className="px-2 py-2 text-xs text-destructive">{error}</div>}
        {loading && <div className="px-2 py-2 text-sm text-muted-foreground">Loading companies…</div>}
        {!loading && companies.map((company) => (
          <DropdownMenuItem
            key={company.id}
            disabled={Boolean(switchingCompanyId)}
            onClick={() => onSelect(company.id)}
            className="flex items-center gap-2 cursor-pointer"
          >
            <Building2 className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{company.name}</span>
              <span className="block text-xs capitalize text-muted-foreground">
                {company.role.replaceAll("_", " ")}
              </span>
            </span>
            {switchingCompanyId === company.id
              ? <span className="text-xs text-muted-foreground">Switching…</span>
              : company.id === currentCompanyId ? <Check className="size-4 text-primary" /> : null}
          </DropdownMenuItem>
        ))}
        {!loading && companies.length === 0 && !error && (
          <div className="px-2 py-3 text-sm text-muted-foreground">No active company memberships found.</div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
