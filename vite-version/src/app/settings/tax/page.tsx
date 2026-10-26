"use client"

import * as React from "react"
import { AlertCircle, CheckCircle2, Loader2, Save } from "lucide-react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { PageHeader } from "@/components/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api } from "@/lib/api-client"
import type { CompanyRow } from "@/lib/api-types"

type TaxPolicy = { mode: "legacy" | "configured"; vatRegistered: boolean; standardRate?: number }

export default function TaxSettingsPage() {
  const [company, setCompany] = React.useState<CompanyRow | null>(null)
  const [mode, setMode] = React.useState<TaxPolicy["mode"]>("legacy")
  const [vatRegistered, setVatRegistered] = React.useState(false)
  const [standardRate, setStandardRate] = React.useState("16")
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)

  React.useEffect(() => {
    api.get<CompanyRow>("/companies/me")
      .then((result) => {
        setCompany(result)
        const policy = result.settings?.taxPolicy as Partial<TaxPolicy> | undefined
        if (policy?.mode === "configured" || policy?.mode === "legacy") setMode(policy.mode)
        setVatRegistered(policy?.vatRegistered === true)
        if (typeof policy?.standardRate === "number") setStandardRate(String(policy.standardRate))
      })
      .catch((err: { message?: string }) => setError(err.message ?? "Could not load company tax settings."))
      .finally(() => setLoading(false))
  }, [])

  const save = async () => {
    if (!company) return
    const rate = Number(standardRate)
    if (mode === "configured" && vatRegistered && (!Number.isFinite(rate) || rate <= 0 || rate > 100)) {
      setError("Enter a standard VAT rate greater than 0 and no more than 100%.")
      return
    }
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const taxPolicy: TaxPolicy = {
        mode,
        vatRegistered,
        ...(vatRegistered && Number.isFinite(rate) && rate > 0 && rate <= 100 ? { standardRate: rate } : {}),
      }
      const updated = await api.patch<CompanyRow>(`/companies/${company.id}`, { taxPolicy })
      setCompany(updated)
      setNotice(mode === "configured"
        ? "Company tax policy saved. Classify every product and supplier-bill line before processing transactions."
        : "Legacy tax behaviour retained. Existing transaction tax entry behaviour is unchanged.")
    } catch (err) {
      setError((err as { message?: string }).message ?? "Could not save company tax settings.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <BaseLayout>
      <div className="flex flex-col gap-6 px-4 lg:px-6">
        <PageHeader title="Tax settings" description="Configure company VAT policy before enabling classified tax calculations." />
        {error && <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Tax settings could not be saved</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
        {notice && <Alert><CheckCircle2 className="size-4" /><AlertTitle>Settings saved</AlertTitle><AlertDescription>{notice}</AlertDescription></Alert>}
        <Card>
          <CardHeader>
            <CardTitle>Company tax policy</CardTitle>
            <CardDescription>These settings apply to invoices, quotations, POS sales and supplier bills for this company only. They do not change historical transactions.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {loading ? <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading company settings…</div> : <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="tax-mode">Tax calculation mode</Label>
                <Select value={mode} onValueChange={(value) => value && setMode(value as TaxPolicy["mode"])}>
                  <SelectTrigger id="tax-mode"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="legacy">Legacy — preserve existing tax entry behaviour</SelectItem>
                    <SelectItem value="configured">Configured — enforce product and bill classifications</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-start gap-3 rounded-lg border p-3">
                <input type="checkbox" className="mt-1 size-4" checked={vatRegistered} onChange={(event) => setVatRegistered(event.target.checked)} />
                <span className="flex flex-col gap-1">
                  <span className="text-sm font-medium">This company is VAT-registered</span>
                  <span className="text-sm text-muted-foreground">Only enable this if the business registration and tax status have been verified.</span>
                </span>
              </label>
              {vatRegistered && <div className="flex flex-col gap-2">
                <Label htmlFor="standard-rate">Company standard VAT rate (%)</Label>
                <Input id="standard-rate" type="number" min="0.01" max="100" step="0.01" value={standardRate} onChange={(event) => setStandardRate(event.target.value)} />
                <p className="text-xs text-muted-foreground">This is the company’s configured reference rate. Standard-rated products must also have a valid product-level rate.</p>
              </div>}
              {mode === "configured" && <Alert><AlertCircle className="size-4" /><AlertTitle>Before enabling configured mode</AlertTitle><AlertDescription>Classify products as standard-rated, zero-rated, exempt or out of scope. Unclassified legacy products and unclassified supplier-bill lines will be rejected so the system does not guess their tax treatment.</AlertDescription></Alert>}
              <div className="flex justify-end">
                <Button onClick={save} disabled={loading || saving || !company}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  Save tax policy
                </Button>
              </div>
            </>}
          </CardContent>
        </Card>
      </div>
    </BaseLayout>
  )
}
