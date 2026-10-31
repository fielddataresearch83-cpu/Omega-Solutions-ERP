import * as React from "react"
import type { SupplierRow } from "@/lib/api-types"
import { api } from "@/lib/api-client"

export function useSuppliers() {
  const [suppliers, setSuppliers] = React.useState<SupplierRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const refetch = React.useCallback(() => {
    setLoading(true)
    setError(null)
    return api
      .get<SupplierRow[]>("/suppliers")
      .then((rows) => { setSuppliers(rows); return rows })
      .catch((err: { message?: string }) => { setError(err.message ?? "Failed to load suppliers"); throw err })
      .finally(() => setLoading(false))
  }, [])

  React.useEffect(() => {
    let active = true
    api.get<SupplierRow[]>("/suppliers")
      .then((rows) => { if (active) setSuppliers(rows) })
      .catch((err: { message?: string }) => { if (active) setError(err.message ?? "Failed to load suppliers") })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  return { suppliers, loading, error, refetch }
}

export function createSupplier(data: {
  name: string
  email?: string
  phone?: string
  city?: string
  county?: string
  addressLine1?: string
  postalCode?: string
  contactPerson?: string
  paymentTerms?: string
}) {
  return api.post<SupplierRow>("/suppliers", data)
}

export function updateSupplier(supplierId: string, data: {
  name?: string
  email?: string
  phone?: string
  city?: string
  county?: string
  addressLine1?: string
  postalCode?: string
  contactPerson?: string
  paymentTerms?: string
  status?: string
}) {
  return api.patch<SupplierRow>(`/suppliers/${supplierId}`, data)
}

export function deleteSupplier(supplierId: string) {
  return api.delete<{ success: boolean }>(`/suppliers/${supplierId}`)
}
