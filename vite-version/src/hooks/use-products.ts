import * as React from "react"
import type { ProductRow } from "@/lib/api-types"
import { api } from "@/lib/api-client"

export function useProducts() {
  const [products, setProducts] = React.useState<ProductRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const refetch = React.useCallback(() => {
    setLoading(true)
    setError(null)
    return api
      .get<ProductRow[]>("/products")
      .then((rows) => { setProducts(rows); return rows })
      .catch((err: { message?: string }) => { setError(err.message ?? "Failed to load products"); throw err })
      .finally(() => setLoading(false))
  }, [])

  React.useEffect(() => {
    let active = true
    api.get<ProductRow[]>("/products")
      .then((rows) => { if (active) setProducts(rows) })
      .catch((err: { message?: string }) => { if (active) setError(err.message ?? "Failed to load products") })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  return { products, loading, error, refetch }
}

export function createProduct(data: {
  sku: string
  name: string
  description?: string
  imageUrl?: string
  category?: string
  unit?: string
  sellingPrice: number
  costPrice?: number
  stockQuantity?: number
  reorderLevel?: number
  taxTreatment?: 'legacy' | 'standard' | 'zero_rated' | 'exempt' | 'out_of_scope'
  taxRate?: number
  isService?: boolean
  isActive?: boolean
}) {
  return api.post<ProductRow>("/products", data)
}

export function updateProduct(productId: string, data: {
  sku?: string
  name?: string
  description?: string
  imageUrl?: string
  category?: string
  unit?: string
  sellingPrice?: number
  costPrice?: number
  stockQuantity?: number
  reorderLevel?: number
  taxTreatment?: 'legacy' | 'standard' | 'zero_rated' | 'exempt' | 'out_of_scope'
  taxRate?: number
  isService?: boolean
  isActive?: boolean
}) {
  return api.patch<ProductRow>(`/products/${productId}`, data)
}

export function deleteProduct(productId: string) {
  return api.delete<{ success: boolean }>(`/products/${productId}`)
}

export function uploadProductImage(productId: string, file: File) {
  return api.upload<ProductRow>(`/products/${productId}/image`, file)
}

export function removeProductImage(productId: string) {
  return api.delete<ProductRow>(`/products/${productId}/image`)
}
