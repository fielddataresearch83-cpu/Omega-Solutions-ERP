import * as React from "react"
import { Plus, Search, Pencil, Trash2, Eye, AlertCircle, Package, AlertTriangle, Image as ImageIcon, X } from "lucide-react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog"
import { Card, CardContent } from "@/components/ui/card"
import { useProducts, createProduct, updateProduct, deleteProduct, uploadProductImage, removeProductImage } from "@/hooks/use-products"
import { formatKES } from "@/lib/format"
import type { ProductRow } from "@/lib/api-types"

type StockStatus = "In Stock" | "Low Stock" | "Out of Stock"

const computeStockStatus = (qty: number, reorder: number): StockStatus => {
  if (qty === 0) return "Out of Stock"
  if (qty <= reorder) return "Low Stock"
  return "In Stock"
}

export default function ProductsPage() {
  const { products, loading, error, refetch } = useProducts()
  const [search, setSearch] = React.useState("")
  const [categoryFilter, setCategoryFilter] = React.useState("all")
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [editingProduct, setEditingProduct] = React.useState<ProductRow | null>(null)
  const [viewingProduct, setViewingProduct] = React.useState<ProductRow | null>(null)
  const [deletingProduct, setDeletingProduct] = React.useState<ProductRow | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [selectedImage, setSelectedImage] = React.useState<File | null>(null)
  const [imagePreview, setImagePreview] = React.useState<string | null>(null)

  const [formData, setFormData] = React.useState({
    sku: "",
    name: "",
    imageUrl: "",
    category: "",
    unit: "pcs",
    sellingPrice: 0,
    costPrice: 0,
    stockQuantity: 0,
    reorderLevel: 0,
    taxTreatment: 'legacy' as 'legacy' | 'standard' | 'zero_rated' | 'exempt' | 'out_of_scope',
    taxRate: 0,
    isService: false,
  })
  const [formErrors, setFormErrors] = React.useState<Record<string, string>>({})

  const imagePreviewUrlRef = React.useRef<string | null>(null)
  const selectProductImage = (file: File | null) => {
    if (imagePreviewUrlRef.current) URL.revokeObjectURL(imagePreviewUrlRef.current)
    imagePreviewUrlRef.current = null
    setSelectedImage(file)
    if (file) {
      const url = URL.createObjectURL(file)
      imagePreviewUrlRef.current = url
      setImagePreview(url)
    } else {
      setImagePreview(null)
    }
  }

  React.useEffect(() => () => {
    if (imagePreviewUrlRef.current) URL.revokeObjectURL(imagePreviewUrlRef.current)
  }, [])

  const categories = React.useMemo(() => {
    const set = new Set<string>()
    products.forEach((p) => { if (p.category) set.add(p.category) })
    return Array.from(set).sort()
  }, [products])

  const filtered = products.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.sku.toLowerCase().includes(search.toLowerCase())
    const matchesCategory = categoryFilter === "all" || p.category === categoryFilter
    return matchesSearch && matchesCategory
  })

  const lowStockCount = products.filter((p) => computeStockStatus(Number(p.stock_quantity), Number(p.reorder_level)) !== "In Stock").length

  const openAddDialog = () => {
    setEditingProduct(null)
    setSelectedImage(null)
    setFormData({ sku: "", name: "", imageUrl: "", category: "", unit: "pcs", sellingPrice: 0, costPrice: 0, stockQuantity: 0, reorderLevel: 0, taxTreatment: "legacy", taxRate: 0, isService: false })
    setFormErrors({})
    setFormError(null)
    setDialogOpen(true)
  }

  const openEditDialog = (product: ProductRow) => {
    setEditingProduct(product)
    setSelectedImage(null)
    setFormData({
      sku: product.sku,
      name: product.name,
      imageUrl: product.image_url ?? "",
      category: product.category ?? "",
      unit: product.unit,
      sellingPrice: Number(product.selling_price),
      costPrice: Number(product.cost_price),
      stockQuantity: Number(product.stock_quantity),
      reorderLevel: Number(product.reorder_level),
      taxTreatment: product.tax_treatment ?? 'legacy',
      taxRate: Number(product.tax_rate ?? 0),
      isService: product.is_service,
    })
    setFormErrors({})
    setFormError(null)
    setDialogOpen(true)
  }

  const validate = () => {
    const errors: Record<string, string> = {}
    if (!formData.sku.trim()) errors.sku = "SKU is required"
    if (!formData.name.trim()) errors.name = "Product name is required"
    if (formData.sellingPrice < 0) errors.sellingPrice = "Price cannot be negative"
    if (formData.taxTreatment === "standard" && (formData.taxRate <= 0 || formData.taxRate > 100)) errors.taxRate = "Enter a configured tax rate greater than 0 and no more than 100%."
    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async () => {
    if (!validate()) return
    setSubmitting(true)
    setFormError(null)
    try {
      const payload = {
        sku: formData.sku.trim(),
        name: formData.name.trim(),
        imageUrl: selectedImage ? undefined : (formData.imageUrl.trim() || undefined),
        category: formData.category.trim() || undefined,
        unit: formData.unit.trim() || "pcs",
        sellingPrice: formData.sellingPrice,
        costPrice: formData.costPrice,
        ...(editingProduct ? {} : { stockQuantity: formData.stockQuantity }),
        reorderLevel: formData.reorderLevel,
        taxTreatment: formData.taxTreatment,
        taxRate: formData.taxRate,
        isService: formData.isService,
      }
      const savedProduct = editingProduct
        ? await updateProduct(editingProduct.id, payload)
        : await createProduct(payload)
      if (selectedImage) {
        if (!editingProduct) setEditingProduct(savedProduct)
        try {
          await uploadProductImage(savedProduct.id, selectedImage)
          setSelectedImage(null)
        } catch (imageErr) {
          throw new Error(`Product details were saved, but the image upload failed: ${imageErr instanceof Error ? imageErr.message : "Please try the upload again."}`, { cause: imageErr })
        }
      }
      await refetch()
      setDialogOpen(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save product")
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!deletingProduct) return
    setDeleting(true)
    try {
      await deleteProduct(deletingProduct.id)
      await refetch()
      setDeleteDialogOpen(false)
      setDeletingProduct(null)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to delete product")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <BaseLayout>
      <div className="px-4 lg:px-6 flex flex-col gap-6">
        <PageHeader
          title="Products"
          description="Manage your product catalog and pricing"
          action={
            <Button onClick={openAddDialog} className="cursor-pointer">
              <Plus className="size-4" />
              Add Product
            </Button>
          }
        />

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="size-4" />
            {error}
          </div>
        )}

        {lowStockCount > 0 && !loading && (
          <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
            <AlertTriangle className="size-4 text-warning" />
            <span>{lowStockCount} product(s) need attention — low or out of stock.</span>
          </div>
        )}

        <Card>
          <CardContent className="flex flex-col gap-4 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by name or SKU..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                  aria-label="Search products"
                />
              </div>
              <Select value={categoryFilter} onValueChange={(v) => v && setCategoryFilter(v)}>
                <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Filter by category">
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {loading ? (
              <div className="flex justify-center py-12">
                <LoadingSpinner />
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={Package}
                title={products.length === 0 ? "No products yet" : "No products found"}
                description={products.length === 0 ? "Add your first product to get started." : "Try adjusting your search or filters."}
                action={
                  <Button onClick={openAddDialog} variant="outline" className="cursor-pointer">
                    <Plus className="size-4" />
                    Add Product
                  </Button>
                }
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden sm:table-cell">Category</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right hidden md:table-cell">Stock</TableHead>
                    <TableHead>Stock Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((p) => {
                    const stockStatus = computeStockStatus(Number(p.stock_quantity), Number(p.reorder_level))
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                        <TableCell><div className="flex items-center gap-2 font-medium">{p.image_url ? <img src={p.image_url} alt="" className="size-9 rounded-md border object-cover" loading="lazy" /> : <span className="flex size-9 items-center justify-center rounded-md border bg-muted text-muted-foreground"><ImageIcon className="size-4" /></span>}<span>{p.name}</span></div></TableCell>
                        <TableCell className="hidden sm:table-cell text-muted-foreground">{p.category ?? "—"}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{formatKES(Number(p.selling_price))}</TableCell>
                        <TableCell className="text-right tabular-nums hidden md:table-cell">
                          {Number(p.stock_quantity)} {p.unit}
                        </TableCell>
                        <TableCell><StatusBadge status={stockStatus} /></TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon-sm" className="cursor-pointer" onClick={() => setViewingProduct(p)} aria-label={`View ${p.name}`}>
                              <Eye className="size-4" />
                            </Button>
                            <Button variant="ghost" size="icon-sm" className="cursor-pointer" onClick={() => openEditDialog(p)} aria-label={`Edit ${p.name}`}>
                              <Pencil className="size-4" />
                            </Button>
                            <Button variant="ghost" size="icon-sm" className="cursor-pointer text-destructive hover:text-destructive" onClick={() => { setDeletingProduct(p); setDeleteDialogOpen(true) }} aria-label={`Delete ${p.name}`}>
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingProduct ? "Edit Product" : "Add Product"}</DialogTitle>
            <DialogDescription>
              {editingProduct ? "Update product details below." : "Enter the new product's details below."}
            </DialogDescription>
          </DialogHeader>
          {formError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{formError}</div>
          )}
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="prod-sku">SKU *</Label>
              <Input id="prod-sku" value={formData.sku} onChange={(e) => setFormData({ ...formData, sku: e.target.value })} aria-invalid={!!formErrors.sku} />
              {formErrors.sku && <span className="text-xs text-destructive">{formErrors.sku}</span>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="prod-name">Product Name *</Label>
              <Input id="prod-name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} aria-invalid={!!formErrors.name} />
              {formErrors.name && <span className="text-xs text-destructive">{formErrors.name}</span>}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="prod-image-file">Product Photo</Label>
              {(imagePreview || formData.imageUrl.trim()) && <img src={imagePreview || formData.imageUrl} alt="Product preview" className="h-28 w-28 rounded-md border object-cover" />}
              <Input id="prod-image-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => {
                const file = e.target.files?.[0] ?? null
                if (file && file.size > 5 * 1024 * 1024) {
                  setFormError("Choose an image smaller than 5 MB.")
                  e.currentTarget.value = ""
                  return
                }
                setFormError(null)
                setSelectedImage(file)
                if (file) setFormData((current) => ({ ...current, imageUrl: "" }))
              }} aria-label="Choose product image from device" />
              <p className="text-xs text-muted-foreground">Choose a JPEG, PNG, or WebP photo up to 5 MB. Uploaded photos are stored privately and shown securely in your company catalog.</p>
              {(selectedImage || formData.imageUrl || editingProduct?.image_url) && <div className="flex flex-wrap gap-2">
                {formData.imageUrl && !selectedImage && <Button type="button" variant="outline" size="sm" onClick={() => setFormData((current) => ({ ...current, imageUrl: "" }))}><X className="size-3.5" /> Clear image URL</Button>}
                {selectedImage && <Button type="button" variant="outline" size="sm" onClick={() => selectProductImage(null)}><X className="size-3.5" /> Cancel selected photo</Button>}
                {!selectedImage && editingProduct?.image_url && <Button type="button" variant="outline" size="sm" disabled={submitting} onClick={async () => {
                  setSubmitting(true)
                  setFormError(null)
                  try {
                    await removeProductImage(editingProduct.id)
                    setFormData((current) => ({ ...current, imageUrl: "" }))
                    await refetch()
                    setEditingProduct((current) => current ? { ...current, image_url: null } : current)
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : "Could not remove product image")
                  } finally {
                    setSubmitting(false)
                  }
                }}><X className="size-3.5" /> Remove saved photo</Button>}
              </div>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="prod-category">Category</Label>
                <Input id="prod-category" value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })} placeholder="Electronics" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="prod-unit">Unit</Label>
                <Input id="prod-unit" value={formData.unit} onChange={(e) => setFormData({ ...formData, unit: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="prod-price">Selling Price (KSh) *</Label>
                <Input id="prod-price" type="number" value={formData.sellingPrice} onChange={(e) => setFormData({ ...formData, sellingPrice: Number(e.target.value) })} aria-invalid={!!formErrors.sellingPrice} />
                {formErrors.sellingPrice && <span className="text-xs text-destructive">{formErrors.sellingPrice}</span>}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="prod-cost">Cost Price (KSh)</Label>
                <Input id="prod-cost" type="number" value={formData.costPrice} onChange={(e) => setFormData({ ...formData, costPrice: Number(e.target.value) })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="prod-stock">{editingProduct ? "Current Stock Quantity" : "Initial Stock Quantity"}</Label>
                <Input id="prod-stock" type="number" min="0" step="0.0001" value={formData.stockQuantity} disabled={!!editingProduct} onChange={(e) => setFormData({ ...formData, stockQuantity: Number(e.target.value) })} />
                {editingProduct && <span className="text-xs text-muted-foreground">Use Stock Movements for receipts, issues, and count adjustments so the inventory ledger stays accurate.</span>}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="prod-reorder">Reorder Level</Label>
                <Input id="prod-reorder" type="number" value={formData.reorderLevel} onChange={(e) => setFormData({ ...formData, reorderLevel: Number(e.target.value) })} />
              </div>
            </div>
            <div className="rounded-lg border p-3 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="prod-tax-treatment">Tax treatment</Label>
                <Select value={formData.taxTreatment} onValueChange={(value) => value && setFormData((current) => ({ ...current, taxTreatment: value as typeof current.taxTreatment }))}>
                  <SelectTrigger id="prod-tax-treatment"><SelectValue placeholder="Choose tax treatment" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="legacy">Legacy - retain existing transaction tax entry</SelectItem>
                    <SelectItem value="standard">Standard-rated - use configured product rate</SelectItem>
                    <SelectItem value="zero_rated">Zero-rated - 0% output tax</SelectItem>
                    <SelectItem value="exempt">Exempt - no output VAT</SelectItem>
                    <SelectItem value="out_of_scope">Out of scope - no VAT calculation</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {formData.taxTreatment === "standard" && <div className="flex flex-col gap-1.5">
                <Label htmlFor="prod-tax-rate">Tax rate (%) *</Label>
                <Input id="prod-tax-rate" type="number" min="0.01" max="100" step="0.01" value={formData.taxRate} onChange={(e) => setFormData((current) => ({ ...current, taxRate: Number(e.target.value) }))} aria-invalid={!!formErrors.taxRate} />
                {formErrors.taxRate && <span className="text-xs text-destructive">{formErrors.taxRate}</span>}
              </div>}
              <p className="text-xs text-muted-foreground">Tax treatment is applied by the server to invoices, quotations and POS sales. Confirm the correct legal treatment for your business before selecting a classification. Legacy preserves existing behaviour until you classify the product.</p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={formData.isService} onChange={(e) => setFormData({ ...formData, isService: e.target.checked })} className="size-4" />
              This is a service (not a physical product)
            </label>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <Button onClick={handleSubmit} disabled={submitting} className="cursor-pointer">
              {submitting ? <LoadingSpinner className="size-4" /> : editingProduct ? "Save Changes" : "Add Product"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewingProduct} onOpenChange={(open) => !open && setViewingProduct(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Product Details</DialogTitle>
          </DialogHeader>
          {viewingProduct && (
            <div className="flex flex-col gap-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-muted-foreground">SKU:</span> <span className="font-mono">{viewingProduct.sku}</span></div>
                <div><span className="text-muted-foreground">Name:</span> <span className="font-medium">{viewingProduct.name}</span></div>
                {viewingProduct.image_url && <div className="col-span-2"><span className="text-muted-foreground">Product image:</span><img src={viewingProduct.image_url} alt={viewingProduct.name} className="mt-2 max-h-48 max-w-full rounded-md border object-contain" /></div>}
                <div><span className="text-muted-foreground">Category:</span> {viewingProduct.category ?? "—"}</div>
                <div><span className="text-muted-foreground">Unit:</span> {viewingProduct.unit}</div>
                <div><span className="text-muted-foreground">Selling Price:</span> <span className="font-medium tabular-nums">{formatKES(Number(viewingProduct.selling_price))}</span></div>
                <div><span className="text-muted-foreground">Cost Price:</span> <span className="tabular-nums">{formatKES(Number(viewingProduct.cost_price))}</span></div>
                <div><span className="text-muted-foreground">Stock:</span> {Number(viewingProduct.stock_quantity)} {viewingProduct.unit}</div>
                <div><span className="text-muted-foreground">Reorder Level:</span> {Number(viewingProduct.reorder_level)}</div>
                <div><span className="text-muted-foreground">Type:</span> {viewingProduct.is_service ? "Service" : "Product"}</div>
                <div><span className="text-muted-foreground">Active:</span> {viewingProduct.is_active ? "Yes" : "No"}</div>
              </div>
              {viewingProduct.description && (
                <div><span className="text-muted-foreground">Description:</span> {viewingProduct.description}</div>
              )}
            </div>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Close</Button>} />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={(open) => { setDeleteDialogOpen(open); if (!open) setDeletingProduct(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Product</DialogTitle>
            <DialogDescription>Are you sure you want to delete {deletingProduct?.name}? This action cannot be undone.</DialogDescription>
          </DialogHeader>
          {formError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{formError}</div>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <Button onClick={handleDelete} disabled={deleting} variant="destructive" className="cursor-pointer">
              {deleting ? <LoadingSpinner className="size-4" /> : "Delete Product"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BaseLayout>
  )
}
