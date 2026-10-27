import * as React from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { ArrowRight, Eye, EyeOff, Layers3, ShieldCheck, Sparkles } from "lucide-react"
import { useAuth } from "@/contexts/auth-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { ModeToggle } from "@/components/mode-toggle"
import { resendNeonVerification, verifyNeonEmailAndSignIn } from "@/lib/neon-auth-api"

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: { pathname?: string; search?: string } } | null)?.from
  const destination = from?.pathname?.startsWith("/") && !from.pathname.startsWith("//")
    ? from.pathname + (from.search ?? "")
    : "/dashboard"
  const { user, loading, loginEmail, companyChoices, selectLoginCompany, registerUser, finishNeonRegistration, mfaChallengePending, completeMfaCode } = useAuth()
  const [mode, setMode] = React.useState<"login" | "register">("login")
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [showPassword, setShowPassword] = React.useState(false)
  const [fullName, setFullName] = React.useState("")
  const [phone, setPhone] = React.useState("")
  const [companyName, setCompanyName] = React.useState("")
  const [otp, setOtp] = React.useState("")
  const [verificationPending, setVerificationPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (!loading && user) navigate(destination, { replace: true })
  }, [user, loading, navigate, destination])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setSubmitting(true)
    try {
      if (mfaChallengePending) {
        const code = otp.trim()
        if (!/^(\d{6}|[a-fA-F0-9]{10})$/.test(code)) {
          setError("Enter the 6-digit authenticator code or one unused 10-character recovery code.")
          return
        }
        await completeMfaCode(code)
        navigate(destination, { replace: true })
      } else if (verificationPending) {
        if (!/^\d{6}$/.test(otp.trim())) {
          setError("Enter the 6-digit verification code sent to your email.")
          return
        }
        const token = await verifyNeonEmailAndSignIn({ email, password, otp })
        await finishNeonRegistration(token, fullName || email.split("@")[0], phone || undefined, companyName || undefined)
        navigate(destination, { replace: true })
      } else if (mode === "login") {
        await loginEmail(email, password)
      } else {
        if (password.length < 8) {
          setError("Password must be at least 8 characters")
          return
        }
        if (!import.meta.env.VITE_NEON_AUTH_URL) {
          throw new Error("Email verification is not configured on this deployment. Registration is temporarily unavailable; please contact support.")
        }
        await registerUser(email, password, fullName, phone || undefined, companyName || undefined)
        setVerificationPending(true)
        setNotice("We sent a verification code to your email. Enter it below to verify your address and finish creating your Omega account.")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed")
    } finally {
      setSubmitting(false)
    }
  }

  const resendCode = async () => {
    setError(null)
    setNotice(null)
    setSubmitting(true)
    try {
      await resendNeonVerification(email)
      setNotice("A new verification code has been sent if the email is eligible for verification.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend verification code")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="flex min-h-svh items-center justify-center bg-background"><LoadingSpinner /></div>
  }

  const heading = companyChoices.length > 0
    ? "Choose your company"
    : mfaChallengePending
    ? "Two-step verification"
    : verificationPending
      ? "Verify your email"
      : mode === "login" ? "Welcome back" : "Create your account"

  return (
    <main className="auth-shell relative flex min-h-svh items-center justify-center overflow-hidden bg-background px-4 py-10 sm:px-6">
      <div className="absolute right-4 top-4 z-20 sm:right-6 sm:top-6"><ModeToggle /></div>
      <div aria-hidden="true" className="pointer-events-none absolute -left-36 -top-36 size-[26rem] rounded-full bg-primary/10 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-44 -right-36 size-[30rem] rounded-full bg-primary/10 blur-3xl" />
      <section className="relative grid w-full max-w-6xl overflow-hidden rounded-3xl border border-border/70 bg-card shadow-2xl shadow-primary/10 lg:min-h-[680px] lg:grid-cols-[1.02fr_0.98fr]">
        <aside className="relative hidden flex-col justify-between overflow-hidden auth-brand-panel p-10 text-white sm:p-12 lg:flex">
          <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,color-mix(in_oklch,var(--primary)_25%,transparent),transparent_55%)]" />
          <div aria-hidden="true" className="absolute -bottom-24 -left-20 size-80 rounded-full border border-white/10" />
          <div aria-hidden="true" className="absolute -bottom-12 -left-8 size-56 rounded-full border border-white/10" />
          <div className="relative flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-2xl font-black text-primary-foreground shadow-lg shadow-primary/20">Ω</div>
            <div><p className="text-base font-semibold tracking-tight">Omega Solutions</p><p className="text-xs text-white/55">Business management platform</p></div>
          </div>
          <div className="relative max-w-lg py-12">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary"><Sparkles className="size-3.5" /> Built for the way you work</div>
            <h1 className="text-4xl font-semibold leading-[1.12] tracking-tight xl:text-5xl">One platform for your business.</h1>
            <p className="mt-6 max-w-md text-base leading-7 text-white/65">Your operations, finances, inventory, sales and people — connected in one place.</p>
            <div className="mt-10 grid max-w-md grid-cols-2 gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><Layers3 className="mb-4 size-5 text-primary" /><p className="text-sm font-medium">Connected workflows</p><p className="mt-1 text-xs leading-5 text-white/50">Less switching. Better visibility.</p></div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><ShieldCheck className="mb-4 size-5 text-primary" /><p className="text-sm font-medium">Secure by design</p><p className="mt-1 text-xs leading-5 text-white/50">Your workspace, your access.</p></div>
            </div>
          </div>
          <div className="relative flex items-center justify-between text-xs text-white/40"><span>© {new Date().getFullYear()} Omega Solutions</span><span>Business, in sync.</span></div>
        </aside>

        <div className="flex items-center justify-center p-5 sm:p-10 lg:px-12">
          <div className="w-full max-w-md py-5">
            <div className="mb-9 flex items-center gap-3 lg:hidden">
              <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-xl font-black text-primary-foreground">Ω</div>
              <div><p className="font-semibold tracking-tight">Omega Solutions</p><p className="text-xs text-muted-foreground">One platform for your business.</p></div>
            </div>
            <div className="mb-8">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-primary">{companyChoices.length > 0 ? "Company selection" : mfaChallengePending ? "Account security" : verificationPending ? "Email verification" : mode === "login" ? "Your workspace awaits" : "Get started with Omega"}</p>
              <h2 className="text-3xl font-semibold tracking-tight">{heading}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {companyChoices.length > 0
                  ? "This account has access to more than one company. Choose the workspace you want to open."
                  : mfaChallengePending
                  ? "Enter your authenticator code or an unused recovery code to finish signing in."
                  : verificationPending
                    ? `Enter the verification code sent to ${email}. You will then be signed in and returned to your requested page.`
                    : mode === "login"
                      ? "Sign in to continue to your Omega business workspace."
                      : "Create your account. You must verify your email before your Omega company account is created."}
              </p>
            </div>

            {error && <div role="alert" className="mb-5 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}
            {notice && <div role="status" className="mb-5 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground">{notice}</div>}

            {companyChoices.length > 0 ? (
              <div className="space-y-3" aria-label="Choose company">
                {companyChoices.map((company) => (
                  <Button
                    key={company.id}
                    type="button"
                    variant="outline"
                    className="h-auto w-full justify-between rounded-xl px-4 py-4 text-left"
                    disabled={submitting}
                    onClick={async () => {
                      setError(null)
                      setSubmitting(true)
                      try {
                        await selectLoginCompany(company.id)
                        navigate(destination, { replace: true })
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Could not sign in to that company")
                      } finally {
                        setSubmitting(false)
                      }
                    }}
                  >
                    <span className="flex flex-col items-start gap-1">
                      <span className="font-semibold">{company.name}</span>
                      <span className="text-xs text-muted-foreground">{company.role}{company.branchId ? " · Assigned branch" : " · Company access"}</span>
                    </span>
                    <ArrowRight className="ml-3 size-4 shrink-0" />
                  </Button>
                ))}
                <button type="button" onClick={() => { setError(null); setCompanyChoices([]) }} className="w-full pt-2 text-sm text-muted-foreground underline-offset-4 hover:underline">Cancel selection</button>
              </div>
            ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {mode === "register" && !verificationPending && !mfaChallengePending && (
                <>
                  <div className="space-y-2"><Label htmlFor="fullName">Full name</Label><Input id="fullName" value={fullName} onChange={e => setFullName(e.target.value)} required placeholder="Jane Doe" autoComplete="name" className="h-11 rounded-xl px-3" /></div>
                  <div className="space-y-2"><Label htmlFor="companyName">Company name <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="companyName" value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Acacia Trading Ltd" className="h-11 rounded-xl px-3" /></div>
                </>
              )}

              {!mfaChallengePending && <div className="space-y-2">
                <Label htmlFor="email">Email address</Label>
                <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required disabled={verificationPending} placeholder="you@company.com" autoComplete="email" className="h-11 rounded-xl px-3" />
              </div>}

              {!verificationPending && !mfaChallengePending && <div className="space-y-2">
                <div className="flex items-center justify-between gap-3"><Label htmlFor="password">Password</Label>{mode === "login" && <Link to="/reset-password" className="text-xs font-semibold text-primary underline-offset-4 hover:underline">Forgot password?</Link>}</div>
                <div className="relative">
                  <Input id="password" type={showPassword ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} required minLength={mode === "register" ? 8 : undefined} placeholder={mode === "login" ? "Enter your password" : "At least 8 characters"} autoComplete={mode === "login" ? "current-password" : "new-password"} className="h-11 rounded-xl px-3 pr-12" />
                  <button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Eye className={showPassword ? "hidden size-4" : "size-4"} /><EyeOff className={showPassword ? "size-4" : "hidden size-4"} /></button>
                </div>
              </div>}

              {mode === "register" && !verificationPending && !mfaChallengePending && <div className="space-y-2"><Label htmlFor="phone">Phone <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+254 712 345 678" autoComplete="tel" className="h-11 rounded-xl px-3" /></div>}

              {(verificationPending || mfaChallengePending) && <div className="space-y-2">
                <Label htmlFor="otp">{mfaChallengePending ? "Authenticator / recovery code" : "Email verification code"}</Label>
                <Input id="otp" inputMode={mfaChallengePending ? "text" : "numeric"} autoComplete="one-time-code" value={otp} onChange={e => setOtp(mfaChallengePending ? e.target.value.replace(/[^a-fA-F0-9]/g, "").slice(0, 10) : e.target.value.replace(/\D/g, "").slice(0, 6))} required placeholder={mfaChallengePending ? "6-digit or recovery code" : "6-digit code"} className="h-11 rounded-xl px-3" />
                {verificationPending && <div className="text-right"><button type="button" onClick={resendCode} disabled={submitting} className="text-xs font-semibold text-primary underline-offset-4 hover:underline disabled:opacity-50">Resend verification code</button></div>}
              </div>}

              <Button type="submit" className="h-11 w-full rounded-xl bg-primary font-semibold text-primary-foreground shadow-lg shadow-primary/10 transition-all hover:bg-primary/90" disabled={submitting}>
                {submitting ? <LoadingSpinner className="size-4" /> : <>{mfaChallengePending ? "Verify and sign in" : verificationPending ? "Verify email and continue" : mode === "login" ? "Sign in to Omega" : "Create Omega account"}{!submitting && <ArrowRight className="ml-2 size-4" />}</>}
              </Button>
            </form>
            )}

            {!verificationPending && companyChoices.length === 0 && <p className="mt-7 text-center text-sm text-muted-foreground">
              {mode === "login" ? "New to Omega?" : "Already have an account?"}{" "}
              <button type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); setNotice(null); setShowPassword(false) }} className="font-semibold text-primary underline-offset-4 hover:underline">{mode === "login" ? "Create an account" : "Sign in instead"}</button>
            </p>}
            {verificationPending && companyChoices.length === 0 && <div className="mt-7 text-center text-sm"><button type="button" onClick={() => { setVerificationPending(false); setOtp(""); setError(null); setNotice(null) }} className="font-semibold text-primary underline-offset-4 hover:underline">Back to registration</button></div>}
            <div className="mt-8 flex items-center justify-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-3.5" /> Secure access to your business workspace</div>
          </div>
        </div>
      </section>
    </main>
  )
}
