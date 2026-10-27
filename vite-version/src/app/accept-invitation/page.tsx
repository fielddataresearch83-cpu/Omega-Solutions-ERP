import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertCircle, CheckCircle2, Loader2, MailCheck } from "lucide-react";
import { BaseLayout } from "@/components/layouts/base-layout";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api-client";
import { getNeonIdentityToken, registerWithNeon, resendNeonVerification, verifyNeonEmailAndSignIn } from "@/lib/neon-auth-api";
import { useAuth } from "@/contexts/auth-context";



export default function AcceptInvitationPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, finishNeonInvitation, refreshUser } = useAuth();
  const invitationToken = params.get("invitationToken") ?? params.get("token") ?? "";
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [fullName, setFullName] = React.useState("");
  const [otp, setOtp] = React.useState("");
  const [verificationPending, setVerificationPending] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [accepted, setAccepted] = React.useState(false);

  const acceptWithExistingOmegaSession = async () => {
    await api.post("/users-roles/invitations/accept", { token: invitationToken });
    setAccepted(true);
    await refreshUser();
    navigate("/dashboard", { replace: true });
  };

  const completeInvitation = React.useCallback(async (identityToken: string) => {
    const needsMfa = await finishNeonInvitation(identityToken, invitationToken);
    if (needsMfa) {
      navigate("/login?mfa=1", { replace: true });
      return;
    }
    await refreshUser();
    setAccepted(true);
    navigate("/dashboard", { replace: true });
  }, [finishNeonInvitation, invitationToken, navigate, refreshUser]);

  React.useEffect(() => {
    if (!invitationToken || user) return;
    // Neon Auth redirects the email magic link back to this URL after establishing
    // its session. Try the identity-token exchange automatically; a direct visit
    // without a Neon session falls back to the account verification form below.
    void getNeonIdentityToken()
      .then(identityToken => completeInvitation(identityToken))
      .catch(() => undefined);
  }, [invitationToken, user, completeInvitation]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!invitationToken) {
      setError("This invitation link does not contain a token.");
      return;
    }
    setBusy(true);
    try {
      if (user) {
        await acceptWithExistingOmegaSession();
        return;
      }
      if (verificationPending) {
        if (!/^\d{6}$/.test(otp.trim())) {
          setError("Enter the 6-digit verification code sent to your email.");
          return;
        }
        const identityToken = await verifyNeonEmailAndSignIn({ email, password, otp });
        await completeInvitation(identityToken);
        return;
      }
      {
        if (password.length < 8) {
          setError("Password must be at least 8 characters.");
          return;
        }
        await registerWithNeon({ email, password, fullName: fullName.trim() || email.split("@")[0] });
        setVerificationPending(true);
        setNotice("A verification code has been sent to your email. Enter it here to verify your email and join your company workspace.");
        return;
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The invitation could not be accepted. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const resendCode = async () => {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await resendNeonVerification(email);
      setNotice("A new verification code has been requested. Check your email.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not resend the verification code.");
    } finally {
      setBusy(false);
    }
  };

  return <BaseLayout><div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 lg:px-6">
    <PageHeader title="Accept company invitation" description="Create your Omega account, verify your email, and securely join your company workspace."/>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><MailCheck className="size-5"/>Invitation details</CardTitle><CardDescription>Omega verifies your email and activates the company membership assigned by your administrator.</CardDescription></CardHeader><CardContent className="space-y-4">
      {error && <div role="alert" className="flex gap-2 rounded-md border border-destructive/30 p-3 text-sm text-destructive"><AlertCircle className="size-4 shrink-0"/>{error}</div>}
      {notice && <div role="status" className="rounded-md border p-3 text-sm text-muted-foreground">{notice}</div>}
      {accepted ? <div role="status" className="space-y-3"><p className="flex items-center gap-2 text-sm"><CheckCircle2 className="size-5 text-success"/>Invitation accepted. Your company membership is active.</p><Button onClick={()=>navigate("/dashboard",{replace:true})}>Continue to dashboard</Button></div>
      : <form className="space-y-4" onSubmit={handleSubmit}>
        <p className="text-sm text-muted-foreground">This invitation expires after seven days and can be used only once. Create your Omega account here. Email verification and invitation acceptance happen in this flow.</p>
        {!user && !verificationPending && <div className="space-y-2">
          <Label htmlFor="invite-full-name">Full name</Label>
          <Input id="invite-full-name" autoComplete="name" value={fullName} onChange={event=>setFullName(event.target.value)} required placeholder="Your full name"/>
        </div>}
        {!user && <div className="space-y-2">
          <Label htmlFor="invite-email">Email address</Label>
          <Input id="invite-email" type="email" autoComplete="email" value={email} onChange={event=>setEmail(event.target.value)} required disabled={verificationPending} placeholder="The address that received the invitation"/>
        </div>}
        {!user && !verificationPending && <div className="space-y-2">
          <Label htmlFor="invite-password">Password</Label>
          <Input id="invite-password" type="password" autoComplete="new-password" minLength={8} value={password} onChange={event=>setPassword(event.target.value)} required placeholder="At least 8 characters"/>
        </div>}
        {verificationPending && <div className="space-y-2">
          <Label htmlFor="invite-otp">Email verification code</Label>
          <Input id="invite-otp" inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={event=>setOtp(event.target.value.replace(/\D/g, "").slice(0,6))} required placeholder="6-digit code"/>
          <div className="text-right"><button type="button" onClick={resendCode} disabled={busy} className="text-sm font-medium text-primary hover:underline">Resend code</button></div>
        </div>}
        <Button type="submit" disabled={busy || !invitationToken}>{busy && <Loader2 className="mr-2 size-4 animate-spin"/>}{user ? "Accept invitation" : verificationPending ? "Verify email and accept invitation" : "Create Omega account and send code"}</Button>
        {verificationPending && <Button type="button" variant="outline" onClick={()=>{setVerificationPending(false);setOtp("");setError("");setNotice("");}} disabled={busy}>Back</Button>}
      </form>}
    </CardContent></Card>
  </div></BaseLayout>;
}
