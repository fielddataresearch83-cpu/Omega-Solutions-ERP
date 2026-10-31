import * as React from "react"
import type { CustomerRow } from "@/lib/api-types"
import { api } from "@/lib/api-client"

export function useCustomers() {
  const [customers, setCustomers] = React.useState<CustomerRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const refetch = React.useCallback(() => {
    setLoading(true)
    setError(null)
    return api
      .get<CustomerRow[]>("/customers")
      .then((rows) => { setCustomers(rows); return rows })
      .catch((err: { message?: string }) => { setError(err.message ?? "Failed to load customers"); throw err })
      .finally(() => setLoading(false))
  }, [])

  React.useEffect(() => {
    let active = true
    api.get<CustomerRow[]>("/customers")
      .then((rows) => { if (active) setCustomers(rows) })
      .catch((err: { message?: string }) => { if (active) setError(err.message ?? "Failed to load customers") })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  return { customers, loading, error, refetch }
}

export function createCustomer(data: {
  name: string
  email?: string
  phone?: string
  city?: string
  county?: string
  addressLine1?: string
  postalCode?: string
  creditLimit?: number
}) {
  return api.post<CustomerRow>("/customers", data)
}

export function updateCustomer(customerId: string, data: {
  name?: string
  email?: string
  phone?: string
  city?: string
  county?: string
  addressLine1?: string
  postalCode?: string
  creditLimit?: number
  status?: string
}) {
  return api.patch<CustomerRow>(`/customers/${customerId}`, data)
}

export function deleteCustomer(customerId: string) {
  return api.delete<{ success: boolean }>(`/customers/${customerId}`)
}
