import * as React from "react"
import type { CompanyRow, BranchRow } from "@/lib/api-types"
import { api } from "@/lib/api-client"

export function useCompany(companyId: string | null) {
  const [company, setCompany] = React.useState<CompanyRow | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => {
      if (!companyId) {
        if (!cancelled) setCompany(null)
        return null
      }
      if (!cancelled) {
        setLoading(true)
        setError(null)
      }
      return api.get<CompanyRow>(`/companies/${companyId}`)
    }).then((result) => {
      if (!cancelled && result) setCompany(result)
    }).catch((err: { message?: string }) => {
      if (!cancelled) setError(err.message ?? "Failed to load company")
    }).finally(() => {
      if (!cancelled && companyId) setLoading(false)
    })
    return () => { cancelled = true }
  }, [companyId])

  return { company, loading, error }
}

export function useMyCompany() {
  const [company, setCompany] = React.useState<CompanyRow | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => {
      if (!cancelled) {
        setLoading(true)
        setError(null)
      }
      return api.get<CompanyRow>("/companies/me")
    }).then((result) => {
      if (!cancelled) setCompany(result)
    }).catch((err: { message?: string }) => {
      if (!cancelled) setError(err.message ?? "Failed to load company")
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  return { company, loading, error }
}

export function useBranches(companyId: string | null) {
  const [branches, setBranches] = React.useState<BranchRow[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const refetch = React.useCallback(() => {
    if (!companyId) {
      setBranches([])
      return
    }
    setLoading(true)
    setError(null)
    api
      .get<BranchRow[]>(`/companies/${companyId}/branches`)
      .then(setBranches)
      .catch((err: { message?: string }) => setError(err.message ?? "Failed to load branches"))
      .finally(() => setLoading(false))
  }, [companyId])

  React.useEffect(() => {
    void Promise.resolve().then(refetch)
  }, [refetch])

  return { branches, loading, error, refetch }
}

export function createBranch(companyId: string, data: { name: string; code?: string; city?: string; phone?: string; email?: string }) {
  return api.post<BranchRow>(`/companies/${companyId}/branches`, data)
}

export function updateBranch(companyId: string, branchId: string, data: Partial<{ name: string; code: string; city: string; phone: string; email: string; isActive: boolean }>) {
  return api.patch<BranchRow>(`/companies/${companyId}/branches/${branchId}`, data)
}
