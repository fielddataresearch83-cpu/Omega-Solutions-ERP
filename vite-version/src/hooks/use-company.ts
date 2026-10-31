import * as React from "react"
import type { CompanyRow, BranchRow } from "@/lib/api-types"
import { api } from "@/lib/api-client"

export function useCompany(companyId: string | null) {
  const [company, setCompany] = React.useState<CompanyRow | null>(null)
  const [loading, setLoading] = React.useState(Boolean(companyId))
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!companyId) return
    let active = true
    void api.get<CompanyRow>(`/companies/${companyId}`)
      .then((result) => { if (active) setCompany(result) })
      .catch((err: { message?: string }) => { if (active) setError(err.message ?? "Failed to load company") })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [companyId])

  return { company: companyId && company?.id === companyId ? company : null, loading: Boolean(companyId) && (loading || company?.id !== companyId), error }
}

export function useMyCompany() {
  const [company, setCompany] = React.useState<CompanyRow | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let active = true
    void api.get<CompanyRow>("/companies/me")
      .then((result) => { if (active) setCompany(result) })
      .catch((err: { message?: string }) => { if (active) setError(err.message ?? "Failed to load company") })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  return { company, loading, error }
}

export function useBranches(companyId: string | null) {
  const [branches, setBranches] = React.useState<BranchRow[]>([])
  const [loadedCompanyId, setLoadedCompanyId] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(Boolean(companyId))
  const [error, setError] = React.useState<string | null>(null)

  const refetch = React.useCallback(() => {
    if (!companyId) return Promise.resolve([])
    setLoading(true)
    setError(null)
    return api.get<BranchRow[]>(`/companies/${companyId}/branches`)
      .then((result) => { setBranches(result); setLoadedCompanyId(companyId); return result })
      .catch((err: { message?: string }) => { setError(err.message ?? "Failed to load branches"); throw err })
      .finally(() => setLoading(false))
  }, [companyId])

  React.useEffect(() => {
    if (!companyId) return
    let active = true
    void api.get<BranchRow[]>(`/companies/${companyId}/branches`)
      .then((result) => { if (active) { setBranches(result); setLoadedCompanyId(companyId) } })
      .catch((err: { message?: string }) => { if (active) setError(err.message ?? "Failed to load branches") })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [companyId])

  return { branches: loadedCompanyId === companyId ? branches : [], loading: Boolean(companyId) && (loading || loadedCompanyId !== companyId), error, refetch }
}

export function createBranch(companyId: string, data: { name: string; code?: string; city?: string; phone?: string; email?: string }) {
  return api.post<BranchRow>(`/companies/${companyId}/branches`, data)
}

export function updateBranch(companyId: string, branchId: string, data: Partial<{ name: string; code: string; city: string; phone: string; email: string; isActive: boolean }>) {
  return api.patch<BranchRow>(`/companies/${companyId}/branches/${branchId}`, data)
}
