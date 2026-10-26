"use client"

import * as React from "react"
import { Link } from "react-router-dom"
import { AlertCircle, CheckCircle2, Layers3, Loader2, LockKeyhole, PlusCircle } from "lucide-react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { api } from "@/lib/api-client"

type ModuleEntry = {
  code: string
  category: string
  description: string
  dependencies: string[]
  includedInPlan: boolean
  override: "enabled" | "disabled" | null
  entitled: boolean
  enabled: boolean
  missingDependencies: string[]
  status: "enabled" | "not_included" | "missing_dependencies" | "subscription_inactive"
}
type Catalogue = {
  accessMode: "legacy_unmetered" | "subscription"
  subscription: null | { planCode: string; planName: string; status: string }
  modules: ModuleEntry[]
}

const moduleNames: Record<string, string> = {
  core: "Omega Core", inventory: "Inventory & Warehousing", sales: "Sales",
  pos: "Point of Sale", accounting: "Finance & Accounting", procurement: "Procurement",
  manufacturing: "Manufacturing", crm: "CRM", hr_workforce: "HR & Workforce",
  reports: "Reports & Business Intelligence",
}

export default function ModulesSettingsPage() {
  const [catalogue, setCatalogue] = React.useState<Catalogue | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [requesting, setRequesting] = React.useState<string | null>(null)

  const loadCatalogue = React.useCallback(async () => {
    setError(null)
    try {
      setCatalogue(await api.get<Catalogue>("/subscriptions/modules"))
    } catch (err) {
      setError((err as { message?: string }).message ?? "Could not load module availability.")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { void loadCatalogue() }, [loadCatalogue])

  const requestModule = async (moduleCode: string) => {
    setRequesting(moduleCode)
    setError(null)
    setNotice(null)
    try {
      const result = await api.post<{ message: string }>("/subscriptions/module-requests", { moduleCode })
      setNotice(result.message)
    } catch (err) {
      setError((err as { message?: string }).message ?? "Could not submit the module request.")
    } finally {
      setRequesting(null)
    }
  }

  return (
    <BaseLayout>
      <div className="flex flex-col gap-6 px-4 lg:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium text-primary"><Layers3 className="size-4" /> Modular workspace</div>
            <h1 className="text-3xl font-semibold tracking-tight">Modules</h1>
            <p className="max-w-2xl text-muted-foreground">See which capabilities your business can use, what each module depends on, and request additional access without changing your existing records.</p>
          </div>
          <Button render={<Link to="/settings/billing" />}>Plans & Billing</Button>
        </div>

        {error && <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Could not load modules</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
        {notice && <Alert><CheckCircle2 className="size-4" /><AlertTitle>Request submitted</AlertTitle><AlertDescription>{notice}</AlertDescription></Alert>}

        {loading ? (
          <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading module access…</div>
        ) : catalogue ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle>{catalogue.subscription?.planName ?? "Existing workspace"}</CardTitle>
                <CardDescription>{catalogue.subscription
                  ? `Subscription status: ${catalogue.subscription.status}. Access is determined by your plan, approved overrides and module dependencies.`
                  : "This company currently uses legacy access. Existing access is preserved while subscription settings are reviewed."}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{catalogue.modules.filter((module) => module.enabled).length} of {catalogue.modules.length} modules available</Badge>
                <Badge variant="secondary">{catalogue.accessMode === "legacy_unmetered" ? "Legacy access" : "Plan-based access"}</Badge>
              </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {catalogue.modules.map((module) => (
                <Card key={module.code} className="flex flex-col">
                  <CardHeader className="gap-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <CardTitle className="text-base">{moduleNames[module.code] ?? module.code}</CardTitle>
                        <CardDescription>{module.category}</CardDescription>
                      </div>
                      {module.enabled
                        ? <Badge className="shrink-0"><CheckCircle2 className="mr-1 size-3" /> Available</Badge>
                        : <Badge variant="outline" className="shrink-0"><LockKeyhole className="mr-1 size-3" /> {module.status === "subscription_inactive" ? "Subscription inactive" : module.status === "missing_dependencies" ? "Dependency required" : "Not included"}</Badge>}
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col gap-4">
                    <p className="text-sm text-muted-foreground">{module.description}</p>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <p><span className="font-medium text-foreground">Dependencies:</span> {module.dependencies.length ? module.dependencies.map((code) => moduleNames[code] ?? code).join(", ") : "None"}</p>
                      {module.missingDependencies.length > 0 && <p className="text-destructive">Unavailable dependencies: {[...new Set(module.missingDependencies)].map((code) => moduleNames[code] ?? code).join(", ")}</p>}
                      <p><span className="font-medium text-foreground">Plan:</span> {module.includedInPlan ? "Included" : "Not included"}</p>
                    </div>
                    <div className="mt-auto pt-1">
                      {module.enabled ? (
                        <p className="text-xs text-muted-foreground">Access is managed by your subscription and company permissions.</p>
                      ) : module.code === "core" ? (
                        <p className="text-xs text-muted-foreground">Core platform access is managed by the platform.</p>
                      ) : !catalogue.subscription ? (
                        <Button variant="outline" className="w-full" render={<Link to="/settings/billing" />}>Review plans</Button>
                      ) : module.status === "subscription_inactive" ? (
                        <Button variant="outline" className="w-full" render={<Link to="/settings/billing" />}>Review subscription</Button>
                      ) : module.entitled ? (
                        <p className="text-xs text-muted-foreground">An administrator must review the missing dependency or module configuration.</p>
                      ) : (
                        <Button variant="outline" className="w-full" disabled={requesting !== null} onClick={() => void requestModule(module.code)}>
                          {requesting === module.code ? <Loader2 className="mr-2 size-4 animate-spin" /> : <PlusCircle className="mr-2 size-4" />}
                          {requesting === module.code ? "Submitting…" : "Request add-on"}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </BaseLayout>
  )
}
