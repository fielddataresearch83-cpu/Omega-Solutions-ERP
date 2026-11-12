import * as React from "react"
import { Plus, Search, Pencil, Eye, Trash2, AlertCircle, Briefcase } from "lucide-react"
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
import {
  Card,
  CardContent,
} from "@/components/ui/card"
import { useSuppliers, createSupplier, updateSupplier, deleteSupplier } from "@/hooks/use-suppliers"
import { formatKES } from "@/lib/format"
import type { SupplierRow } from "@/lib/api-types"

export default function SuppliersPage() {
  const { suppliers, loading, error, refetch } = useSuppliers()
  const [search, setSearch] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState<string>("all")
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [editingSupplier, setEditingSupplier] = React.useState<SupplierRow | null>(null)
  const [viewingSupplier, setViewingSupplier] = React.useState<SupplierRow | null>(null)
  const [deletingSupplier, setDeletingSupplier] = React.useState<SupplierRow | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)

  const [formData, setFormData] = React.useState({
    name: "",
    email: "",
    phone: "",
    city: "",
    county: "",
    contactPerson: "",
    paymentTerms: "",
  })
  const [formErrors, setFormErrors] = React.useState<Record<string, string>>({})

  const filtered = suppliers.filter((s) => {
    const matchesSearch =
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.email ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (s.phone ?? "").includes(search)
    const matchesStatus = statusFilter === "all" || s.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const openAddDialog = () => {
    setEditingSupplier(null)
    setFormData({ name: "", email: "", phone: "", city: "", county: "", contactPerson: "", paymentTerms: "" })
    setFormErrors({})
    setFormError(null)
    setDialogOpen(true)
  }

  const openEditDialog = (supplier: SupplierRow) => {
    setEditingSupplier(supplier)
    setFormData({
      name: supplier.name,
      email: supplier.email ?? "",
      phone: supplier.phone ?? "",
      city: supplier.city ?? "",
      county: supplier.county ?? "",
      contactPerson: supplier.contact_person ?? "",
      paymentTerms: supplier.payment_terms ?? "",
    })
    setFormErrors({})
    setFormError(null)
    setDialogOpen(true)
  }

  const validate = () => {
    const errors: Record<string, string> = {}
    if (!formData.name.trim()) errors.name = "Supplier name is required"
    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) errors.email = "Invalid email format"
    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async () => {
    if (!validate()) return
    setSubmitting(true)
    setFormError(null)
    try {
      const payload = {
        name: formData.name.trim(),
        email: formData.email.trim() || undefined,
        phone: formData.phone.trim() || undefined,
        city: formData.city.trim() || undefined,
        county: formData.county.trim() || undefined,
        contactPerson: formData.contactPerson.trim() || undefined,
        paymentTerms: formData.paymentTerms.trim() || undefined,
      }
      if (editingSupplier) {
        await updateSupplier(editingSupplier.id, payload)
      } else {
        await createSupplier(payload)
      }
      await refetch()
      setDialogOpen(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save supplier")
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!deletingSupplier) return
    setDeleting(true)
    try {
      await deleteSupplier(deletingSupplier.id)
      await refetch()
      setDeleteDialogOpen(false)
      setDeletingSupplier(null)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to delete supplier")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <BaseLayout>
      <div className="px-4 lg:px-6 flex flex-col gap-6">
        <PageHeader
          title="Suppliers"
          description="Manage supplier accounts and contact information"
          action={
            <Button onClick={openAddDialog} className="cursor-pointer">
              <Plus className="size-4" />
              Add Supplier
            </Button>
          }
        />

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="size-4" />
            {error}
          </div>
        )}

        <Card>
          <CardContent className="flex flex-col gap-4 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by name, email, or phone..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                  aria-label="Search suppliers"
                />
              </div>
              <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v)}>
                <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Filter by status">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="blocked">Blocked</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {loading ? (
              <div className="flex justify-center py-12">
                <LoadingSpinner />
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={Briefcase}
                title={suppliers.length === 0 ? "No suppliers yet" : "No suppliers found"}
                description={suppliers.length === 0 ? "Add your first supplier to get started." : "Try adjusting your search or filters."}
                action={
                  <Button onClick={openAddDialog} variant="outline" className="cursor-pointer">
                    <Plus className="size-4" />
                    Add Supplier
                  </Button>
                }
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden md:table-cell">Contact Person</TableHead>
                    <TableHead className="hidden lg:table-cell">Phone</TableHead>
                    <TableHead className="hidden sm:table-cell">City</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Balance Due</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground">{s.contact_person ?? "—"}</TableCell>
                      <TableCell className="hidden lg:table-cell text-muted-foreground">{s.phone ?? "—"}</TableCell>
                      <TableCell className="hidden sm:table-cell text-muted-foreground">{s.city ?? "—"}</TableCell>
                      <TableCell><StatusBadge status={s.status === "active" ? "Active" : s.status === "inactive" ? "Inactive" : "Blocked"} /></TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatKES(Number(s.outstanding_balance))}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon-sm" className="cursor-pointer" onClick={() => setViewingSupplier(s)} aria-label={`View ${s.name}`}>
                            <Eye className="size-4" />
                          </Button>
                          <Button variant="ghost" size="icon-sm" className="cursor-pointer" onClick={() => openEditDialog(s)} aria-label={`Edit ${s.name}`}>
                            <Pencil className="size-4" />
                          </Button>
                          <Button variant="ghost" size="icon-sm" className="cursor-pointer text-destructive hover:text-destructive" onClick={() => { setDeletingSupplier(s); setDeleteDialogOpen(true) }} aria-label={`Archive ${s.name}`}>
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingSupplier ? "Edit Supplier" : "Add Supplier"}</DialogTitle>
            <DialogDescription>{editingSupplier ? "Update supplier details below." : "Enter the new supplier's details below."}</DialogDescription>
          </DialogHeader>
          {formError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{formError}</div>
          )}
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sup-name">Supplier Name *</Label>
              <Input id="sup-name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} aria-invalid={!!formErrors.name} />
              {formErrors.name && <span className="text-xs text-destructive">{formErrors.name}</span>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sup-email">Email</Label>
                <Input id="sup-email" type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sup-phone">Phone</Label>
                <Input id="sup-phone" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sup-contact">Contact Person</Label>
                <Input id="sup-contact" value={formData.contactPerson} onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sup-terms">Payment Terms</Label>
                <Input id="sup-terms" value={formData.paymentTerms} onChange={(e) => setFormData({ ...formData, paymentTerms: e.target.value })} placeholder="Net 30" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sup-city">City</Label>
                <Input id="sup-city" value={formData.city} onChange={(e) => setFormData({ ...formData, city: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sup-county">County</Label>
                <Input id="sup-county" value={formData.county} onChange={(e) => setFormData({ ...formData, county: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <Button onClick={handleSubmit} disabled={submitting} className="cursor-pointer">
              {submitting ? <LoadingSpinner className="size-4" /> : editingSupplier ? "Save Changes" : "Add Supplier"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewingSupplier} onOpenChange={(open) => !open && setViewingSupplier(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Supplier Details</DialogTitle>
          </DialogHeader>
          {viewingSupplier && (
            <div className="flex flex-col gap-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-muted-foreground">Name:</span> <span className="font-medium">{viewingSupplier.name}</span></div>
                <div><span className="text-muted-foreground">Status:</span> <StatusBadge status={viewingSupplier.status === "active" ? "Active" : viewingSupplier.status === "inactive" ? "Inactive" : "Blocked"} /></div>
                <div><span className="text-muted-foreground">Email:</span> {viewingSupplier.email ?? "—"}</div>
                <div><span className="text-muted-foreground">Phone:</span> {viewingSupplier.phone ?? "—"}</div>
                <div><span className="text-muted-foreground">Contact:</span> {viewingSupplier.contact_person ?? "—"}</div>
                <div><span className="text-muted-foreground">Payment Terms:</span> {viewingSupplier.payment_terms ?? "—"}</div>
                <div><span className="text-muted-foreground">City:</span> {viewingSupplier.city ?? "—"}</div>
                <div><span className="text-muted-foreground">Outstanding:</span> <span className="font-medium tabular-nums">{formatKES(Number(viewingSupplier.outstanding_balance))}</span></div>
              </div>
            </div>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Close</Button>} />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={(open) => { setDeleteDialogOpen(open); if (!open) setDeletingSupplier(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Archive Supplier</DialogTitle>
            <DialogDescription>Archive {deletingSupplier?.name}? The supplier will no longer be available for new purchase orders, but existing purchase orders, bills, payments and audit history will be retained.</DialogDescription>
          </DialogHeader>
          {formError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{formError}</div>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <Button onClick={handleDelete} disabled={deleting} variant="destructive" className="cursor-pointer">
              {deleting ? <LoadingSpinner className="size-4" /> : "Archive Supplier"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BaseLayout>
  )
}
