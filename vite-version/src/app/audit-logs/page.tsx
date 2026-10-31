"use client"

import * as React from "react"
import { AlertCircle, Loader2, ScrollText } from "lucide-react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api-client"

type AuditRow = {
  id: string
  user_name: string | null
  action: string
  entity_type: string
  entity_id: string | null
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  created_at: string
}

function details(row: AuditRow) {
  const values = row.new_values ?? row.old_values
  if (row.entity_id) return row.entity_id
  if (!values) return "—"
  return Object.entries(values).slice(0, 3).map(([key, value]) => `${key}: ${String(value)}`).join(", ") || "—"
}

export default function AuditLogsPage() {
  const [rows, setRows] = React.useState<AuditRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState("")

  const load = React.useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const result = await api.get<AuditRow[]>("/audit-logs?limit=100")
      setRows(Array.isArray(result) ? result : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : (err as { message?: string })?.message ?? "Could not load audit records.")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { let active = true; void api.get<AuditRow[]>("/audit-logs?limit=100").then(result => { if (active) setRows(Array.isArray(result) ? result : []) }).catch(err => { if (active) setError(err instanceof Error ? err.message : (err as { message?: string })?.message ?? "Could not load audit records.") }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [])

  return (
    <BaseLayout>
      <div className="px-4 lg:px-6 flex flex-col gap-6">
        <PageHeader title="Audit Logs" description="Real system activity for your current company" />
        <Card>
          <CardContent className="p-4">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Loading audit records…</div>
            ) : error ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <AlertCircle className="h-8 w-8 text-destructive" />
                <p className="text-sm text-destructive">{error}</p>
                <Button variant="outline" onClick={() => void load()}>Retry</Button>
              </div>
            ) : rows.length === 0 ? (
              <EmptyState icon={ScrollText} title="No audit records yet" description="Real audit events will appear here when activity is recorded." />
            ) : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Timestamp</TableHead><TableHead>User</TableHead><TableHead>Action</TableHead><TableHead>Module</TableHead><TableHead>Details</TableHead>
                </TableRow></TableHeader>
                <TableBody>{rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap">{new Date(row.created_at).toLocaleString()}</TableCell>
                    <TableCell>{row.user_name ?? "System / deleted user"}</TableCell>
                    <TableCell>{row.action}</TableCell>
                    <TableCell>{row.entity_type}</TableCell>
                    <TableCell className="max-w-[24rem] truncate">{details(row)}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </BaseLayout>
  )
}
