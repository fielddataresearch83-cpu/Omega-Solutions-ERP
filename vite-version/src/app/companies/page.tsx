import * as React from "react"
import { Plus, Pencil, AlertCircle, Building2, Archive, RotateCcw } from "lucide-react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { PageHeader } from "@/components/page-header"
import { StatusBadge } from "@/components/status-badge"
import { EmptyState } from "@/components/empty-state"
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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { useAuth } from "@/contexts/auth-context"
import { api } from "@/lib/api-client"
import { useCompany, useBranches, createBranch, updateBranch } from "@/hooks/use-company"
import type { BranchRow } from "@/lib/api-types"

export default function CompaniesPage() {
  const { user } = useAuth()
  const companyId = user?.companyId ?? null
  const { company, loading: companyLoading, error: companyError } = useCompany(companyId)
  const { branches, loading: branchesLoading, error: branchesError, refetch } = useBranches(companyId)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editingBranch, setEditingBranch] = React.useState<BranchRow | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [companyActionBusy, setCompanyActionBusy] = React.useState(false)
  const [companyActionError, setCompanyActionError] = React.useState<string | null>(null)
  const [archivedCompanies, setArchivedCompanies] = React.useState<Array<{ id: string; name: string }>>([])
  const [archivedLoading, setArchivedLoading] = React.useState(false)
  const [restoringCompanyId, setRestoringCompanyId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (user?.role !== "owner" && user?.role !== "admin") return
    let active = true
    void api.get<Array<{ id: string; name: string }>>("/companies/archived")
      .then((items) => { if (active) setArchivedCompanies(items) })
      .catch(() => { if (active) setArchivedCompanies([]) })
      .finally(() => { if (active) setArchivedLoading(false) })
    return () => { active = false }
  }, [user?.role])

  const [formData, setFormData] = React.useState({
    name: "",
    code: "",
    city: "",
    phone: "",
    email: "",
    isActive: true,
  })

  const openAddDialog = () => {
    setEditingBranch(null)
    setFormData({ name: "", code: "", city: "", phone: "", email: "", isActive: true })
    setFormError(null)
    setDialogOpen(true)
  }

  const openEditDialog = (branch: BranchRow) => {
    setEditingBranch(branch)
    setFormData({
      name: branch.name,
      code: branch.code ?? "",
      city: branch.city ?? "",
      phone: branch.phone ?? "",
      email: branch.email ?? "",
      isActive: branch.is_active,
    })
    setFormError(null)
    setDialogOpen(true)
  }

  const handleSubmit = async () => {
    if (!companyId) return
    if (!formData.name.trim()) {
      setFormError("Branch name is required")
      return
    }
    setSubmitting(true)
    setFormError(null)
    try {
      if (editingBranch) {
        await updateBranch(companyId, editingBranch.id, {
          name: formData.name,
          code: formData.code || undefined,
          city: formData.city || undefined,
          phone: formData.phone || undefined,
          email: formData.email || undefined,
          isActive: formData.isActive,
        })
      } else {
        await createBranch(companyId, {
          name: formData.name,
          code: formData.code || undefined,
          city: formData.city || undefined,
          phone: formData.phone || undefined,
          email: formData.email || undefined,
        })
      }
      await refetch()
      setDialogOpen(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save branch")
    } finally {
      setSubmitting(false)
    }
  }

  if (companyLoading) {
    return (
      <BaseLayout>
        <div className="flex flex-1 items-center justify-center">
          <LoadingSpinner />
        </div>
      </BaseLayout>
    )
  }

  if (companyError || !company) {
    return (
      <BaseLayout>
        <div className="px-4 lg:px-6 flex flex-col gap-6">
          <PageHeader title="Companies & Branches" description="Manage company profile and branch locations" />
          <EmptyState
            icon={AlertCircle}
            title="Unable to load company"
            description={companyError ?? "You may not have a company membership yet. Contact your administrator."}
          />
        </div>
      </BaseLayout>
    )
  }

  return (
    <BaseLayout>
      <div className="px-4 lg:px-6 flex flex-col gap-6">
        <PageHeader
          title="Companies & Branches"
          description="Manage company profile and branch locations"
          action={
            <Button onClick={openAddDialog} className="cursor-pointer">
              <Plus className="size-4" />
              Add Branch
            </Button>
          }
        />

        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>Company Profile</CardTitle>
                <CardDescription>{company.name}</CardDescription>
                {!company.is_active && <p className="mt-2 text-sm font-medium text-destructive">This company is archived. Restore it to resume normal operations.</p>}
                {companyActionError && <p role="alert" className="mt-2 text-sm text-destructive">{companyActionError}</p>}
              </div>
              {(user?.role === "owner" || user?.role === "admin") && (
                company.is_active ? (
                  <Button variant="outline" size="sm" disabled={companyActionBusy} onClick={async () => {
                    if (!window.confirm(`Delete ${company.name}? It will be moved to Archived Companies, where an owner or administrator can restore it. All company records will be retained.`)) return
                    setCompanyActionBusy(true); setCompanyActionError(null)
                    try { await api.post(`/companies/${company.id}/archive`); window.location.reload() }
                    catch (error) { setCompanyActionError(error instanceof Error ? error.message : "Unable to archive company."); setCompanyActionBusy(false) }
                  }}>
                    <Archive className="size-4" /> Delete company
                  </Button>
                ) : (
                  <Button size="sm" disabled={companyActionBusy} onClick={async () => {
                    setCompanyActionBusy(true); setCompanyActionError(null)
                    try { await api.post(`/companies/${company.id}/restore`); window.location.reload() }
                    catch (error) { setCompanyActionError(error instanceof Error ? error.message : "Unable to restore company."); setCompanyActionBusy(false) }
                  }}>
                    <RotateCcw className="size-4" /> Restore company
                  </Button>
                )
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">Registration Number</span>
                <span className="text-sm font-medium">{company.registration_number ?? "—"}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">VAT Number</span>
                <span className="text-sm font-medium">{company.vat_number ?? "—"}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">Email</span>
                <span className="text-sm font-medium">{company.email ?? "—"}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">Phone</span>
                <span className="text-sm font-medium">{company.phone ?? "—"}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">Address</span>
                <span className="text-sm font-medium">
                  {[company.address_line1, company.city].filter(Boolean).join(", ") || "—"}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">Website</span>
                <span className="text-sm font-medium">{company.website ?? "—"}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">Currency</span>
                <span className="text-sm font-medium">{company.currency}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">Timezone</span>
                <span className="text-sm font-medium">{company.timezone}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {(user?.role === "owner" || user?.role === "admin") && (
          <Card>
            <CardHeader>
              <CardTitle>Archived Companies</CardTitle>
              <CardDescription>Deleted companies are retained here and can be restored without losing their records.</CardDescription>
            </CardHeader>
            <CardContent>
              {archivedLoading ? <LoadingSpinner /> : archivedCompanies.length === 0 ? (
                <p className="text-sm text-muted-foreground">No archived companies.</p>
              ) : (
                <div className="flex flex-col divide-y">
                  {archivedCompanies.map((item) => (
                    <div key={item.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <span className="text-sm font-medium">{item.name}</span>
                      <Button size="sm" variant="outline" disabled={restoringCompanyId === item.id} onClick={async () => {
                        setRestoringCompanyId(item.id)
                        try {
                          await api.post(`/companies/${item.id}/restore`)
                          setArchivedCompanies((current) => current.filter((entry) => entry.id !== item.id))
                          if (item.id === company.id) window.location.reload()
                        } catch (error) {
                          setCompanyActionError(error instanceof Error ? error.message : "Unable to restore company.")
                        } finally { setRestoringCompanyId(null) }
                      }}>
                        <RotateCcw className="size-4" /> Restore
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Branches</CardTitle>
            <CardDescription>{branches.length} branch location(s)</CardDescription>
          </CardHeader>
          <CardContent>
            {branchesLoading ? (
              <div className="flex justify-center py-8">
                <LoadingSpinner />
              </div>
            ) : branchesError ? (
              <EmptyState
                icon={AlertCircle}
                title="Failed to load branches"
                description={branchesError}
              />
            ) : branches.length === 0 ? (
              <EmptyState
                icon={Building2}
                title="No branches yet"
                description="Add your first branch to get started."
                action={
                  <Button onClick={openAddDialog} size="sm">
                    <Plus className="size-4" />
                    Add Branch
                  </Button>
                }
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead className="hidden sm:table-cell">City</TableHead>
                    <TableHead className="hidden lg:table-cell">Phone</TableHead>
                    <TableHead className="hidden lg:table-cell">Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {branches.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">{b.name}</TableCell>
                      <TableCell className="font-mono text-xs">{b.code ?? "—"}</TableCell>
                      <TableCell className="hidden sm:table-cell text-muted-foreground">{b.city ?? "—"}</TableCell>
                      <TableCell className="hidden lg:table-cell text-muted-foreground">{b.phone ?? "—"}</TableCell>
                      <TableCell className="hidden lg:table-cell text-muted-foreground">{b.email ?? "—"}</TableCell>
                      <TableCell>
                        <StatusBadge status={b.is_active ? "Active" : "Inactive"} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="cursor-pointer"
                          onClick={() => openEditDialog(b)}
                          aria-label={`Edit ${b.name}`}
                        >
                          <Pencil className="size-4" />
                        </Button>
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
            <DialogTitle>{editingBranch ? "Edit Branch" : "Add Branch"}</DialogTitle>
            <DialogDescription>
              {editingBranch ? "Update branch details below." : "Enter the new branch details below."}
            </DialogDescription>
          </DialogHeader>
          {formError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {formError}
            </div>
          )}
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="br-name">Branch Name *</Label>
                <Input id="br-name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="br-code">Code</Label>
                <Input id="br-code" value={formData.code} onChange={(e) => setFormData({ ...formData, code: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="br-city">City</Label>
                <Input id="br-city" value={formData.city} onChange={(e) => setFormData({ ...formData, city: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="br-phone">Phone</Label>
                <Input id="br-phone" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="br-email">Email</Label>
              <Input id="br-email" type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
            </div>
            {editingBranch && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="br-status">Status</Label>
                <Select
                  value={formData.isActive ? "Active" : "Inactive"}
                  onValueChange={(v) => v && setFormData({ ...formData, isActive: v === "Active" })}
                >
                  <SelectTrigger id="br-status" size="sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <Button onClick={handleSubmit} disabled={submitting} className="cursor-pointer">
              {submitting ? <LoadingSpinner className="size-4" /> : editingBranch ? "Save Changes" : "Add Branch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BaseLayout>
  )
}
