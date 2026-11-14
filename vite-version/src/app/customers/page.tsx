import * as React from "react"
import { Plus, Search, Pencil, Eye, Users, Trash2, AlertCircle } from "lucide-react"
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
import { useCustomers, createCustomer, updateCustomer, deleteCustomer } from "@/hooks/use-customers"
import { formatKES, formatDate } from "@/lib/format"
import type { CustomerRow } from "@/lib/api-types"

export default function CustomersPage() {
  const { customers, loading, error, refetch } = useCustomers()
  const [search, setSearch] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState<string>("all")
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [editingCustomer, setEditingCustomer] = React.useState<CustomerRow | null>(null)
  const [viewingCustomer, setViewingCustomer] = React.useState<CustomerRow | null>(null)
  const [deletingCustomer, setDeletingCustomer] = React.useState<CustomerRow | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)

  const [formData, setFormData] = React.useState({
    name: "",
    email: "",
    phone: "",
    city: "",
    county: "",
    addressLine1: "",
    postalCode: "",
    creditLimit: 0,
  })
  const [formErrors, setFormErrors] = React.useState<Record<string, string>>({})

  const filtered = customers.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.email ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (c.phone ?? "").includes(search)
    const matchesStatus = statusFilter === "all" || c.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const openAddDialog = () => {
    setEditingCustomer(null)
    setFormData({ name: "", email: "", phone: "", city: "", county: "", addressLine1: "", postalCode: "", creditLimit: 0 })
    setFormErrors({})
    setFormError(null)
    setDialogOpen(true)
  }

  const openEditDialog = (customer: CustomerRow) => {
    setEditingCustomer(customer)
    setFormData({
      name: customer.name,
      email: customer.email ?? "",
      phone: customer.phone ?? "",
      city: customer.city ?? "",
      county: customer.county ?? "",
      addressLine1: customer.address_line1 ?? "",
      postalCode: customer.postal_code ?? "",
      creditLimit: customer.credit_limit,
    })
    setFormErrors({})
    setFormError(null)
    setDialogOpen(true)
  }

  const validate = () => {
    const errors: Record<string, string> = {}
    if (!formData.name.trim()) errors.name = "Customer name is required"
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
        addressLine1: formData.addressLine1.trim() || undefined,
        postalCode: formData.postalCode.trim() || undefined,
        creditLimit: formData.creditLimit,
      }
      if (editingCustomer) {
        await updateCustomer(editingCustomer.id, payload)
      } else {
        await createCustomer(payload)
      }
      await refetch()
      setDialogOpen(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save customer")
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!deletingCustomer) return
    setDeleting(true)
    try {
      await deleteCustomer(deletingCustomer.id)
      await refetch()
      setDeleteDialogOpen(false)
      setDeletingCustomer(null)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to delete customer")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <BaseLayout>
      <div className="px-4 lg:px-6 flex flex-col gap-6">
        <PageHeader
          title="Customers"
          description="Manage your customer accounts and contact information"
          action={
            <Button onClick={openAddDialog} className="cursor-pointer">
              <Plus className="size-4" />
              Add Customer
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
                  aria-label="Search customers"
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
                icon={Users}
                title={customers.length === 0 ? "No customers yet" : "No customers found"}
                description={customers.length === 0 ? "Add your first customer to get started." : "Try adjusting your search or filters."}
                action={
                  <Button onClick={openAddDialog} variant="outline" className="cursor-pointer">
                    <Plus className="size-4" />
                    Add Customer
                  </Button>
                }
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden md:table-cell">Email</TableHead>
                    <TableHead className="hidden lg:table-cell">Phone</TableHead>
                    <TableHead className="hidden sm:table-cell">City</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="hidden xl:table-cell">Joined</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground">{c.email ?? "—"}</TableCell>
                      <TableCell className="hidden lg:table-cell text-muted-foreground">{c.phone ?? "—"}</TableCell>
                      <TableCell className="hidden sm:table-cell text-muted-foreground">{c.city ?? "—"}</TableCell>
                      <TableCell><StatusBadge status={c.status === "active" ? "Active" : c.status === "inactive" ? "Inactive" : "Blocked"} /></TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatKES(Number(c.outstanding_balance))}
                      </TableCell>
                      <TableCell className="hidden xl:table-cell text-muted-foreground">{formatDate(c.created_at)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="cursor-pointer"
                            onClick={() => setViewingCustomer(c)}
                            aria-label={`View ${c.name}`}
                          >
                            <Eye className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="cursor-pointer"
                            onClick={() => openEditDialog(c)}
                            aria-label={`Edit ${c.name}`}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="cursor-pointer text-destructive hover:text-destructive"
                            onClick={() => { setDeletingCustomer(c); setDeleteDialogOpen(true) }}
                            aria-label={`Delete ${c.name}`}
                          >
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
            <DialogTitle>{editingCustomer ? "Edit Customer" : "Add Customer"}</DialogTitle>
            <DialogDescription>
              {editingCustomer ? "Update customer details below." : "Enter the new customer's details below."}
            </DialogDescription>
          </DialogHeader>
          {formError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {formError}
            </div>
          )}
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cust-name">Customer Name *</Label>
              <Input
                id="cust-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                aria-invalid={!!formErrors.name}
              />
              {formErrors.name && <span className="text-xs text-destructive">{formErrors.name}</span>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cust-email">Email</Label>
              <Input
                id="cust-email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                aria-invalid={!!formErrors.email}
              />
              {formErrors.email && <span className="text-xs text-destructive">{formErrors.email}</span>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cust-phone">Phone</Label>
              <Input
                id="cust-phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cust-city">City</Label>
                <Input
                  id="cust-city"
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cust-county">County</Label>
                <Input
                  id="cust-county"
                  value={formData.county}
                  onChange={(e) => setFormData({ ...formData, county: e.target.value })}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cust-credit">Credit Limit (KSh)</Label>
              <Input
                id="cust-credit"
                type="number"
                value={formData.creditLimit}
                onChange={(e) => setFormData({ ...formData, creditLimit: Number(e.target.value) })}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <Button onClick={handleSubmit} disabled={submitting} className="cursor-pointer">
              {submitting ? <LoadingSpinner className="size-4" /> : editingCustomer ? "Save Changes" : "Add Customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewingCustomer} onOpenChange={(open) => !open && setViewingCustomer(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Customer Details</DialogTitle>
          </DialogHeader>
          {viewingCustomer && (
            <div className="flex flex-col gap-3 text-sm">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div><span className="text-muted-foreground">Name:</span> <span className="font-medium">{viewingCustomer.name}</span></div>
                <div><span className="text-muted-foreground">Status:</span> <StatusBadge status={viewingCustomer.status === "active" ? "Active" : viewingCustomer.status === "inactive" ? "Inactive" : "Blocked"} /></div>
                <div><span className="text-muted-foreground">Email:</span> {viewingCustomer.email ?? "—"}</div>
                <div><span className="text-muted-foreground">Phone:</span> {viewingCustomer.phone ?? "—"}</div>
                <div><span className="text-muted-foreground">City:</span> {viewingCustomer.city ?? "—"}</div>
                <div><span className="text-muted-foreground">County:</span> {viewingCustomer.county ?? "—"}</div>
                <div><span className="text-muted-foreground">Joined:</span> {formatDate(viewingCustomer.created_at)}</div>
                <div><span className="text-muted-foreground">Outstanding:</span> <span className="font-medium tabular-nums">{formatKES(Number(viewingCustomer.outstanding_balance))}</span></div>
                <div><span className="text-muted-foreground">Credit Limit:</span> <span className="font-medium tabular-nums">{formatKES(Number(viewingCustomer.credit_limit))}</span></div>
              </div>
            </div>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Close</Button>} />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={(open) => { setDeleteDialogOpen(open); if (!open) setDeletingCustomer(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Customer</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {deletingCustomer?.name}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {formError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {formError}
            </div>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <Button onClick={handleDelete} disabled={deleting} variant="destructive" className="cursor-pointer">
              {deleting ? <LoadingSpinner className="size-4" /> : "Delete Customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BaseLayout>
  )
}
