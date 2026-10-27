import * as React from "react"
import { Link, useNavigate } from "react-router-dom"
import { ArrowLeft, Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { ModeToggle } from "@/components/mode-toggle"
import { requestNeonPasswordReset, resetNeonPassword } from "@/lib/neon-auth-api"

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [email, setEmail] = React.useState("")
  const [otp, setOtp] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")
  const [showPassword, setShowPassword] = React.useState(false)
  const [resetRequested, setResetRequested] = React.useState(false)
  const [resetComplete, setResetComplete] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setSubmitting(true)
    try {
      if (!resetRequested) {
        if (!email.trim()) throw new Error("Enter the email address for your Omega account.")
        await requestNeonPasswordReset(email)
        setResetRequested(true)
        setNotice("If an Omega account exists for that email, a password-reset code will be sent. Check your inbox.")
      } else {
        if (!/^\\d{6}$/.test(otp.trim())) throw new Error("Enter the 6-digit reset code from your email.")
        if (password.length < 8) throw new Error("Your new password must be at least 8 characters.")
        if (password !== confirmPassword) throw new Error("The passwords do not match.")
        await resetNeonPassword(email, otp, password)
        setResetComplete(true)
        setPassword("")
        setConfirmPassword("")
        setOtp("")
        setNotice("Your password has been reset. You can now sign in with your new password.")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not complete the password reset. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  const resendCode = async () => {
    setError(null)
    setNotice(null)
    setSubmitting(true)
    try {
      await requestNeonPasswordReset(email)
      setNotice("If an Omega account exists for that email, a new password-reset code will be sent.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not request another reset code.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-shell relative flex min-h-svh items-center justify-center overflow-hidden bg-background px-4 py-10">
      <div className="absolute right-4 top-4"><ModeToggle /></div>
      <div aria-hidden="true" className="pointer-events-none absolute -left-40 -top-40 size-96 rounded-full bg-primary/10 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-48 -right-32 size-[28rem] rounded-full bg-primary/10 blur-3xl" />
      <section className="relative grid w-full max-w-5xl overflow-hidden rounded-3xl border bg-card shadow-2xl shadow-primary/10 md:grid-cols-2">
        <div className="relative hidden flex-col justify-between overflow-hidden auth-brand-panel p-10 text-white md:flex">
          <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,color-mix(in_oklch,var(--primary)_25%,transparent),transparent_55%)]" />
          <div className="relative flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-xl font-black text-primary-foreground">Ω</div>
            <div><p className="font-semibold tracking-tight">Omega Solutions</p><p className="text-xs text-white/60">Business management, connected</p></div>
          </div>
          <div className="relative py-12">
            <div className="mb-5 flex size-12 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-primary"><ShieldCheck className="size-6" /></div>
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.24em] text-primary">Secure account recovery</p>
            <h1 className="max-w-sm text-4xl font-semibold leading-tight tracking-tight">Get back to business with confidence.</h1>
            <p className="mt-5 max-w-sm text-sm leading-6 text-white/65">We’ll help you securely restore access to your Omega workspace.</p>
          </div>
          <p className="relative text-xs text-white/45">One platform for your business.</p>
        </div>
        <div className="flex items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-sm">
            <Link to="/login" className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"><ArrowLeft className="size-4" /> Back to sign in</Link>
            <div className="mb-7 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><KeyRound className="size-6" /></div>
            <h2 className="text-2xl font-semibold tracking-tight">{resetComplete ? "Password updated" : resetRequested ? "Enter your reset code" : "Forgot your password?"}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{resetComplete ? "Your Omega account is ready to use with the new password." : resetRequested ? `Enter the 6-digit code sent to ${email}, then choose a new password.` : "Enter your account email and we’ll send a code to reset your password."}</p>
            {error && <div role="alert" className="mt-5 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}
            {notice && <div role="status" className="mt-5 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground">{notice}</div>}
            {!resetComplete && (
              <form onSubmit={handleSubmit} className="mt-6 space-y-5">
                <div className="space-y-2"><Label htmlFor="reset-email">Email address</Label><Input id="reset-email" type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required disabled={resetRequested} placeholder="you@company.com" /></div>
                {resetRequested && <>
                  <div className="space-y-2"><Label htmlFor="reset-code">6-digit reset code</Label><Input id="reset-code" inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={event => setOtp(event.target.value.replace(/\\D/g, "").slice(0, 6))} minLength={6} maxLength={6} required placeholder="Enter code from email" /></div>
                  <div className="space-y-2"><Label htmlFor="new-password">New password</Label><div className="relative"><Input id="new-password" type={showPassword ? "text" : "password"} value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" minLength={8} required placeholder="At least 8 characters" className="pr-11" /><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></div></div>
                  <div className="space-y-2"><Label htmlFor="confirm-password">Confirm new password</Label><Input id="confirm-password" type={showPassword ? "text" : "password"} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={8} required placeholder="Enter your new password again" /></div>
                </>}
                <Button type="submit" className="h-11 w-full rounded-xl bg-primary font-semibold text-primary-foreground hover:bg-primary/90" disabled={submitting}>{submitting ? <LoadingSpinner className="size-4" /> : resetRequested ? "Reset password" : "Send reset code"}</Button>
                {resetRequested && <div className="text-center"><button type="button" onClick={resendCode} disabled={submitting} className="text-xs font-semibold text-primary underline-offset-4 hover:underline disabled:opacity-50">Resend reset code</button></div>}
              </form>
            )}
            {resetComplete && <Button className="mt-6 h-11 w-full rounded-xl" onClick={() => navigate("/login", { replace: true })}>Continue to sign in</Button>}
            <p className="mt-8 text-center text-xs text-muted-foreground">One platform for your business.</p>
          </div>
        </div>
      </section>
    </main>
  )
}
