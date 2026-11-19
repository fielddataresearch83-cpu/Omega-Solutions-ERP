import * as React from "react"
import { Link } from "react-router-dom"
import { Sun, Moon, Monitor, Save, RotateCcw } from "lucide-react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { useTheme } from "@/hooks/use-theme"
import { cn } from "cn"
import { QRCodeSVG } from "qrcode.react"
import { getAccessToken, api } from "@/lib/api-client"
import { useAuth } from "@/contexts/auth-context"

interface DemoPrefs {
  currency: string
  dateFormat: string
  fiscalYearStart: string
}

const defaultPrefs: DemoPrefs = {
  currency: "KES",
  dateFormat: "DD MMM YYYY",
  fiscalYearStart: "January",
}

export default function SettingsPage() {
  const { theme, setTheme } = useTheme()
  const { user } = useAuth()
  const canManageCompany = user?.role === "owner" || user?.role === "admin"
  const [prefs, setPrefs] = React.useState<DemoPrefs>(defaultPrefs)
  const [prefsLoading, setPrefsLoading] = React.useState(true)
  const [prefsSaving, setPrefsSaving] = React.useState(false)
  const [prefsError, setPrefsError] = React.useState<string | null>(null)
  const [saved, setSaved] = React.useState(false)
  const [mfaEnabled, setMfaEnabled] = React.useState(false)
  const [mfaSecret, setMfaSecret] = React.useState("")
  const [mfaOtpAuthUrl, setMfaOtpAuthUrl] = React.useState("")
  const [mfaCode, setMfaCode] = React.useState("")
  const [recoveryCodes, setRecoveryCodes] = React.useState<string[]>([])
  const [mfaError, setMfaError] = React.useState<string | null>(null)
  const [mfaBusy, setMfaBusy] = React.useState(false)
  const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "")

  const mfaRequest = React.useCallback(async (path: string, body?: unknown) => {
    const token = getAccessToken()
    if (!token) throw new Error("Please sign in again to manage account security.")
    const response = await fetch(apiBase + path, {
      method: body ? "POST" : "GET",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.message || "Could not update MFA settings.")
    return data
  }, [apiBase])

  React.useEffect(() => {
    let active = true
    void Promise.resolve().then(() => mfaRequest("/auth/mfa/status"))
      .then((data) => { if (active) setMfaEnabled(Boolean(data.enabled)) })
      .catch((err) => { if (active) setMfaError(err instanceof Error ? err.message : "Could not load MFA status.") })
    return () => { active = false }
  }, [mfaRequest])

  React.useEffect(() => {
    if (!user?.companyId) return
    let active = true
    void Promise.allSettled([
      api.get<{ currency: string; settings?: Record<string, unknown> }>(`/companies/${user.companyId}`),
      api.get<{ dateFormat: string }>("/user-preferences/display"),
    ]).then(([companyResult, displayResult]) => {
      if (!active) return
      const companyPrefs = companyResult.status === "fulfilled" ? companyResult.value : null
      const displayPrefs = displayResult.status === "fulfilled" ? displayResult.value : null
      setPrefs({
        currency: companyPrefs?.currency ?? defaultPrefs.currency,
        fiscalYearStart: typeof companyPrefs?.settings?.fiscalYearStart === "string" ? companyPrefs.settings.fiscalYearStart : defaultPrefs.fiscalYearStart,
        dateFormat: displayPrefs?.dateFormat ?? defaultPrefs.dateFormat,
      })
      if (displayResult.status === "rejected") {
        setPrefsError("Personal date-format preference could not be loaded. Retry the page or contact your administrator if the problem continues.")
      } else if (companyResult.status === "rejected") {
        setPrefsError("Company preferences could not be loaded. Check your company access.")
      }
    }).finally(() => { if (active) setPrefsLoading(false) })
    return () => { active = false }
  }, [user?.companyId])

  const persistPreferences = async (next: DemoPrefs) => {
    if (!user?.companyId) {
      setPrefsError("Select a company before saving preferences.")
      return
    }
    setPrefsSaving(true)
    setPrefsError(null)
    setSaved(false)
    try {
      if (canManageCompany) {
        await api.patch(`/companies/${user.companyId}`, {
          currency: next.currency,
          fiscalYearStart: next.fiscalYearStart,
        })
      }
      await api.put("/user-preferences/display", { dateFormat: next.dateFormat })
      setPrefs(next)
      setSaved(true)
    } catch (error) {
      setPrefsError(error instanceof Error ? error.message : "Could not save preferences.")
    } finally {
      setPrefsSaving(false)
    }
  }

  const handleSave = () => { void persistPreferences(prefs) }
  const handleReset = () => { void persistPreferences(defaultPrefs) }

  const themeOptions = [
    { value: "light" as const, label: "Light", icon: Sun },
    { value: "dark" as const, label: "Dark", icon: Moon },
    { value: "system" as const, label: "System", icon: Monitor },
  ]

  return (
    <BaseLayout>
      <div className="px-4 lg:px-6 flex flex-col gap-6">
        <PageHeader
          title="Settings"
          description="Configure appearance and display preferences"
          action={
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={handleReset} disabled={prefsSaving || prefsLoading} className="cursor-pointer">
                <RotateCcw className="size-4" />
                Reset
              </Button>
              <Button onClick={handleSave} disabled={prefsSaving || prefsLoading} className="cursor-pointer">
                <Save className="size-4" />
                {prefsSaving ? "Saving…" : saved ? "Saved!" : "Save Preferences"}
              </Button>
            </div>
          }
        />
        {prefsError && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{prefsError}</div>}
        {prefsLoading && <p className="text-sm text-muted-foreground">Loading saved preferences…</p>}

        <Card>
          <CardHeader>
            <CardTitle>Two-step verification (MFA)</CardTitle>
            <CardDescription>Protect sign-in with an authenticator app and single-use recovery codes.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              <p className="text-sm">{mfaEnabled ? "MFA is enabled for this account." : "MFA is currently disabled for this account."}</p>
              {mfaError && <p role="alert" className="text-sm text-destructive">{mfaError}</p>}
              {mfaEnabled && <>
                <Label htmlFor="mfa-disable-code">Authenticator or recovery code to disable MFA</Label>
                <Input id="mfa-disable-code" value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/[^a-fA-F0-9]/g, "").slice(0, 10))} placeholder="6-digit or 10-character code" autoComplete="one-time-code" />
                <Button variant="outline" disabled={mfaBusy || mfaCode.length < 6} onClick={async () => {
                  setMfaBusy(true); setMfaError(null)
                  try { await mfaRequest("/auth/mfa/disable", { code: mfaCode }); setMfaEnabled(false); setMfaCode(""); setRecoveryCodes([]); }
                  catch (err) { setMfaError(err instanceof Error ? err.message : "Could not disable MFA.") }
                  finally { setMfaBusy(false) }
                }}>{mfaBusy ? "Disabling…" : "Disable MFA"}</Button>
              </>}
              {!mfaEnabled && !mfaSecret && <Button disabled={mfaBusy} onClick={async () => {
                setMfaBusy(true); setMfaError(null)
                try { const data = await mfaRequest("/auth/mfa/enroll", {}); setMfaSecret(data.secret); setMfaOtpAuthUrl(data.otpauthUrl); }
                catch (err) { setMfaError(err instanceof Error ? err.message : "Could not start MFA enrollment.") }
                finally { setMfaBusy(false) }
              }}>{mfaBusy ? "Starting…" : "Set up authenticator"}</Button>}
              {!mfaEnabled && mfaSecret && <>
                <div className="rounded-md border p-3">
                  {mfaOtpAuthUrl && <div className="mb-3 flex flex-col items-center gap-2">
                    <QRCodeSVG value={mfaOtpAuthUrl} size={192} level="M" includeMargin aria-label="Authenticator setup QR code" />
                    <p className="text-xs text-muted-foreground text-center">Scan this QR code with your authenticator app. It is generated locally in this browser.</p>
                  </div>}
                  <p className="mb-1 text-sm font-medium">Authenticator setup key</p>
                  <code className="break-all text-sm">{mfaSecret}</code>
                  <p className="mt-2 text-xs text-muted-foreground">Add this key to an authenticator app, then enter its current six-digit code below.</p>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="mfa-code">Authenticator code</Label>
                  <Input id="mfa-code" value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" />
                </div>
                <Button disabled={mfaBusy || mfaCode.length !== 6} onClick={async () => {
                  setMfaBusy(true); setMfaError(null)
                  try { const data = await mfaRequest("/auth/mfa/confirm", { code: mfaCode }); setMfaEnabled(true); setMfaSecret(""); setMfaOtpAuthUrl(""); setRecoveryCodes(data.recoveryCodes || []); setMfaCode(""); }
                  catch (err) { setMfaError(err instanceof Error ? err.message : "Could not confirm MFA.") }
                  finally { setMfaBusy(false) }
                }}>{mfaBusy ? "Verifying…" : "Confirm and enable MFA"}</Button>
              </>}
              {recoveryCodes.length > 0 && <div className="rounded-md border p-3">
                <p className="font-medium text-sm">Save these recovery codes now</p>
                <p className="text-xs text-muted-foreground">Each code works once. They will not be shown again.</p>
                <pre className="mt-2 whitespace-pre-wrap text-sm">{recoveryCodes.join("\n")}</pre>
                <Button variant="outline" onClick={() => { void navigator.clipboard?.writeText(recoveryCodes.join("\n")); }}>Copy recovery codes</Button>
              </div>}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Theme Preference</CardTitle>
              <CardDescription>Choose how the application appears</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-3">
                {themeOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setTheme(opt.value)}
                    className={cn(
                      "flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors cursor-pointer",
                      theme === opt.value
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border hover:bg-muted"
                    )}
                    aria-pressed={theme === opt.value}
                  >
                    <opt.icon className="size-5" />
                    <span className="text-sm font-medium">{opt.label}</span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Display Preferences</CardTitle>
              <CardDescription>Locale and formatting options</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pref-currency">Currency</Label>
                  <Select value={prefs.currency} disabled={!canManageCompany || prefsLoading} onValueChange={(v) => v && setPrefs({ ...prefs, currency: v })}>
                    <SelectTrigger id="pref-currency" size="sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="KES">Kenyan Shilling (KSh)</SelectItem>
                      <SelectItem value="USD">US Dollar ($)</SelectItem>
                      <SelectItem value="EUR">Euro (€)</SelectItem>
                      <SelectItem value="GBP">British Pound (£)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pref-date">Date Format</Label>
                  <Select value={prefs.dateFormat} disabled={prefsLoading} onValueChange={(v) => v && setPrefs({ ...prefs, dateFormat: v })}>
                    <SelectTrigger id="pref-date" size="sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DD MMM YYYY">DD MMM YYYY (14 Oct 2024)</SelectItem>
                      <SelectItem value="MM/DD/YYYY">MM/DD/YYYY (10/14/2024)</SelectItem>
                      <SelectItem value="DD/MM/YYYY">DD/MM/YYYY (14/10/2024)</SelectItem>
                      <SelectItem value="YYYY-MM-DD">YYYY-MM-DD (2024-10-14)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pref-fy">Fiscal Year Start</Label>
                  <Select value={prefs.fiscalYearStart} disabled={!canManageCompany || prefsLoading} onValueChange={(v) => v && setPrefs({ ...prefs, fiscalYearStart: v })}>
                    <SelectTrigger id="pref-fy" size="sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="January">January</SelectItem>
                      <SelectItem value="April">April</SelectItem>
                      <SelectItem value="July">July</SelectItem>
                      <SelectItem value="October">October</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Company tax settings</CardTitle>
            <CardDescription>Configure VAT registration and tax classification rules for invoices, quotations, POS and supplier bills.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link to="/settings/tax" />}>Open tax settings</Button>
          </CardContent>
        </Card>
      </div>
    </BaseLayout>
  )
}
