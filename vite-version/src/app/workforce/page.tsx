import * as React from "react";
import { Loader2, RefreshCw, MapPin, ClipboardList, Clock3, Upload, FileCheck2 } from "lucide-react";
import { BaseLayout } from "@/components/layouts/base-layout";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { api } from "@/lib/api-client";

type Employee = { id: string; employee_number: string; first_name: string; last_name: string; employment_status: string };
type Site = { id: string; site_code: string; site_name: string; client_name: string; address: string | null; is_active: boolean };
type Assignment = { id: string; employee_id: string; employee_number: string; first_name: string; last_name: string; site_name: string; client_name: string; assignment_title: string | null; pay_basis: string; pay_rate: string | number; currency: string; start_date: string; end_date: string | null; status: string };
type Attendance = { id: string; employee_id: string; employee_number: string; first_name: string; last_name: string; punch_type: "in" | "out"; punched_at: string; site_name: string | null; client_name: string | null };
type MonthlyPreview = { period: string; totalRows: number; matchedRows: number; issueRows: number; readyToImport: boolean; rows: { rowNumber: number; employeeName: string | null; nationalIdMasked: string; presentDays: number; absentDays: number; leaveDays: number; unresolvedDays: number; issue: string | null }[] };
type MonthlyImport = { id: string; period_start: string; status: "draft" | "approved"; item_count: number; present_days_total: number; absent_days_total: number; leave_days_total: number; unresolved_days_total: number; created_at: string };
const errorMessage = (e: unknown) => e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "The request failed. Please try again.";
const fieldClass = "h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm";
const today = () => { const date = new Date(); const year = date.getFullYear(); const month = String(date.getMonth() + 1).padStart(2, "0"); const day = String(date.getDate()).padStart(2, "0"); return `${year}-${month}-${day}`; };
const currentMonth = () => today().slice(0, 7);

export default function WorkforcePage() {
  const [employees, setEmployees] = React.useState<Employee[]>([]);
  const [sites, setSites] = React.useState<Site[]>([]);
  const [assignments, setAssignments] = React.useState<Assignment[]>([]);
  const [attendance, setAttendance] = React.useState<Attendance[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [savingSite, setSavingSite] = React.useState(false);
  const [savingAssignment, setSavingAssignment] = React.useState(false);
  const [savingPunch, setSavingPunch] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [siteForm, setSiteForm] = React.useState({ siteCode: "", siteName: "", clientName: "", address: "" });
  const [assignmentForm, setAssignmentForm] = React.useState({ employeeId: "", siteId: "", assignmentTitle: "", payBasis: "monthly", payRate: "", currency: "KES", startDate: today(), endDate: "" });
  const [punchForm, setPunchForm] = React.useState({ employeeId: "", punchType: "in" as "in" | "out", note: "" });
  const [transferForm, setTransferForm] = React.useState({ assignmentId: "", siteId: "", effectiveDate: today(), payBasis: "monthly", payRate: "" });
  const [savingTransfer, setSavingTransfer] = React.useState(false);
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [importPeriod, setImportPeriod] = React.useState(currentMonth());
  const [importCsv, setImportCsv] = React.useState("");
  const [importFileName, setImportFileName] = React.useState("");
  const [importPreview, setImportPreview] = React.useState<MonthlyPreview | null>(null);
  const [monthlyImports, setMonthlyImports] = React.useState<MonthlyImport[]>([]);
  const [importBusy, setImportBusy] = React.useState(false);
  const [importError, setImportError] = React.useState<string | null>(null);
  const [importNotice, setImportNotice] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    const attendanceQuery = new URLSearchParams();
    if (from) attendanceQuery.set("from", from);
    if (to) attendanceQuery.set("to", to);
    const suffix = attendanceQuery.size ? `?${attendanceQuery.toString()}` : "";
    const results = await Promise.allSettled([
      api.get<Employee[]>("/employees"),
      api.get<Site[]>("/client-sites"),
      api.get<Assignment[]>("/employee-assignments"),
      api.get<Attendance[]>(`/attendance${suffix}`),
    ]);
    const messages: string[] = [];
    if (results[0].status === "fulfilled") setEmployees(results[0].value); else messages.push(`Employees: ${errorMessage(results[0].reason)}`);
    if (results[1].status === "fulfilled") setSites(results[1].value); else messages.push(`Sites: ${errorMessage(results[1].reason)}`);
    if (results[2].status === "fulfilled") setAssignments(results[2].value); else messages.push(`Assignments: ${errorMessage(results[2].reason)}`);
    if (results[3].status === "fulfilled") setAttendance(results[3].value); else messages.push(`Attendance: ${errorMessage(results[3].reason)}`);
    setError(messages.length ? messages.join(" · ") : null);
    setLoading(false);
  }, [from, to]);

  React.useEffect(() => { void load(); }, [load]);

  const loadMonthlyImports = React.useCallback(async () => {
    try { setMonthlyImports(await api.get<MonthlyImport[]>(`/attendance/monthly-imports?period=${encodeURIComponent(importPeriod)}`)); }
    catch (e) { setImportError(errorMessage(e)); }
  }, [importPeriod]);
  React.useEffect(() => { let active=true; void api.get<MonthlyImport[]>(`/attendance/monthly-imports?period=${encodeURIComponent(importPeriod)}`).then(result=>{if(active){setMonthlyImports(result);setImportError(null);}}).catch(e=>{if(active)setImportError(errorMessage(e));});return()=>{active=false;}; }, [importPeriod]);

  function parseChecklistCsv(text: string) {
    const source = text.replace(/^\\uFEFF/, "");
    const records: string[][] = [];
    let row: string[] = [], cell = "", quoted = false;
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (ch === '"' && quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted) { row.push(cell.trim()); cell = ""; }
      else if ((ch === "\n" || ch === "\r") && !quoted) {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell.trim()); if (row.some(value => value !== "")) records.push(row);
        row = []; cell = "";
      } else cell += ch;
    }
    if (quoted) throw new Error("The checklist contains an unclosed quoted field. Check the CSV file and try again.");
    row.push(cell.trim()); if (row.some(value => value !== "")) records.push(row);
    if (records.length < 2) throw new Error("The checklist needs a header row and at least one worker row.");
    const normalizeHeader = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
    const headers = records[0].map(normalizeHeader);
    const column = (...names: string[]) => headers.findIndex(h => names.includes(h));
    const idCol = column("nationalid", "idno", "idnumber", "nationalidnumber");
    const scheduledCol = column("scheduleddays", "scheduled", "workdays");
    const presentCol = column("presentdays", "present");
    const absentCol = column("absentdays", "absent");
    const leaveCol = column("leavedays", "leave");
    const restCol = column("restdays", "restday", "rest");
    const unresolvedCol = column("unresolveddays", "unresolved", "pendingdays");
    const siteCol = column("sitecode", "site");
    const notesCol = column("notes", "remarks", "comment");
    if ([idCol, scheduledCol, presentCol, absentCol, leaveCol].some(i => i < 0)) throw new Error("Required columns: nationalId, scheduledDays, presentDays, absentDays and leaveDays. Optional: siteCode, restDays, unresolvedDays, notes.");
    return records.slice(1).map(cells => ({
      nationalId: cells[idCol] ?? "", scheduledDays: Number(cells[scheduledCol] || 0),
      presentDays: Number(cells[presentCol] || 0), absentDays: Number(cells[absentCol] || 0),
      leaveDays: Number(cells[leaveCol] || 0), restDays: restCol >= 0 ? Number(cells[restCol] || 0) : 0,
      unresolvedDays: unresolvedCol >= 0 ? Number(cells[unresolvedCol] || 0) : 0,
      siteCode: siteCol >= 0 ? cells[siteCol] || undefined : undefined,
      notes: notesCol >= 0 ? cells[notesCol] || undefined : undefined,
    }));
  }

  async function previewMonthlyImport() {
    setImportBusy(true); setImportError(null); setImportNotice(null); setImportPreview(null);
    try {
      const rows = parseChecklistCsv(importCsv);
      setImportPreview(await api.post<MonthlyPreview>("/attendance/monthly-imports/preview", { period: importPeriod, sourceType: "csv", sourceFilename: importFileName || undefined, rows }));
    } catch (e) { setImportError(errorMessage(e)); } finally { setImportBusy(false); }
  }

  async function saveMonthlyImport() {
    if (!importPreview?.readyToImport) return;
    setImportBusy(true); setImportError(null); setImportNotice(null);
    try {
      const rows = parseChecklistCsv(importCsv);
      await api.post("/attendance/monthly-imports", { period: importPeriod, sourceType: "csv", sourceFilename: importFileName || undefined, rows });
      setImportNotice("Monthly checklist imported as a draft. Review and approve it below.");
      setImportCsv(""); setImportFileName(""); setImportPreview(null); await loadMonthlyImports();
    } catch (e) { setImportError(errorMessage(e)); } finally { setImportBusy(false); }
  }

  async function approveMonthlyImport(id: string) {
    setImportBusy(true); setImportError(null); setImportNotice(null);
    try {
      await api.post(`/attendance/monthly-imports/${id}/approve`);
      setImportNotice("Monthly attendance register approved."); await loadMonthlyImports();
    } catch (e) { setImportError(errorMessage(e)); } finally { setImportBusy(false); }
  }

  async function createSite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSavingSite(true); setFormError(null);
    try {
      await api.post("/client-sites", { ...siteForm, address: siteForm.address.trim() || undefined });
      setSiteForm({ siteCode: "", siteName: "", clientName: "", address: "" });
      await load();
    } catch (e) { setFormError(errorMessage(e)); } finally { setSavingSite(false); }
  }

  async function createAssignment(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSavingAssignment(true); setFormError(null);
    try {
      await api.post("/employee-assignments", { ...assignmentForm, payRate: Number(assignmentForm.payRate), endDate: assignmentForm.endDate || undefined, assignmentTitle: assignmentForm.assignmentTitle.trim() || undefined });
      setAssignmentForm({ employeeId: "", siteId: "", assignmentTitle: "", payBasis: "monthly", payRate: "", currency: "KES", startDate: today(), endDate: "" });
      await load();
    } catch (e) { setFormError(errorMessage(e)); } finally { setSavingAssignment(false); }
  }

  async function transferAssignment(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSavingTransfer(true); setFormError(null);
    try {
      await api.post(`/employee-assignments/${transferForm.assignmentId}/transfer`, { siteId: transferForm.siteId, effectiveDate: transferForm.effectiveDate, payBasis: transferForm.payBasis, payRate: Number(transferForm.payRate) });
      setTransferForm({ assignmentId: "", siteId: "", effectiveDate: today(), payBasis: "monthly", payRate: "" });
      await load();
    } catch (e) { setFormError(errorMessage(e)); } finally { setSavingTransfer(false); }
  }

  async function recordPunch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSavingPunch(true); setFormError(null);
    try {
      await api.post("/attendance/punch", { ...punchForm, note: punchForm.note.trim() || undefined, source: "web" });
      setPunchForm({ employeeId: "", punchType: "in", note: "" });
      await load();
    } catch (e) { setFormError(errorMessage(e)); } finally { setSavingPunch(false); }
  }

  const activeEmployees = employees.filter((employee) => !["terminated", "inactive"].includes(employee.employment_status));
  const activeSites = sites.filter((site) => site.is_active);

  return <BaseLayout><div className="flex flex-col gap-6 px-4 lg:px-6">
    <PageHeader title="Workforce" description="Manage client sites, employee assignments, and attendance using the active company’s records." />
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">All records are scoped to the authenticated company. Nothing is pre-filled with sample data.</p>
      <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className="mr-2 size-4" />Refresh data</Button>
    </div>
    {error && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
    {formError && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{formError}</div>}
    {loading ? <div className="flex justify-center py-12"><LoadingSpinner /></div> : <>
      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardContent className="flex items-center gap-3 p-4"><UsersIcon /><div><p className="text-sm text-muted-foreground">Active employees</p><p className="text-2xl font-semibold">{activeEmployees.length}</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-4"><MapPin className="size-5 text-muted-foreground" /><div><p className="text-sm text-muted-foreground">Client sites</p><p className="text-2xl font-semibold">{sites.length}</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-4"><Clock3 className="size-5 text-muted-foreground" /><div><p className="text-sm text-muted-foreground">Attendance events</p><p className="text-2xl font-semibold">{attendance.length}</p></div></CardContent></Card>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><MapPin className="size-4" />Client sites</CardTitle></CardHeader><CardContent>
          <form onSubmit={createSite} className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label>Site code *</Label><Input required maxLength={40} value={siteForm.siteCode} onChange={e => setSiteForm({ ...siteForm, siteCode: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label>Site name *</Label><Input required value={siteForm.siteName} onChange={e => setSiteForm({ ...siteForm, siteName: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label>Client name *</Label><Input required value={siteForm.clientName} onChange={e => setSiteForm({ ...siteForm, clientName: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label>Address</Label><Input value={siteForm.address} onChange={e => setSiteForm({ ...siteForm, address: e.target.value })} /></div>
            <div className="sm:col-span-2"><Button type="submit" disabled={savingSite}>{savingSite && <Loader2 className="mr-2 size-4 animate-spin" />}Create site</Button></div>
          </form>
          <div className="mt-5 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-y bg-muted/40 text-left"><th className="p-2">Site</th><th className="p-2">Client</th><th className="p-2">Status</th></tr></thead><tbody>{sites.map(site => <tr key={site.id} className="border-b last:border-0"><td className="p-2"><span className="font-medium">{site.site_name}</span><div className="text-xs text-muted-foreground">{site.site_code}</div></td><td className="p-2">{site.client_name}</td><td className="p-2">{site.is_active ? "Active" : "Inactive"}</td></tr>)}</tbody></table>{!sites.length && <p className="p-4 text-sm text-muted-foreground">No client sites for this company yet.</p>}</div>
        </CardContent></Card>
        <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><ClipboardList className="size-4" />Create employee assignment</CardTitle></CardHeader><CardContent>
          <form onSubmit={createAssignment} className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5 sm:col-span-2"><Label>Employee *</Label><select required className={fieldClass} value={assignmentForm.employeeId} onChange={e => setAssignmentForm({ ...assignmentForm, employeeId: e.target.value })}><option value="">Select an active employee</option>{activeEmployees.map(e => <option key={e.id} value={e.id}>{e.employee_number} · {e.first_name} {e.last_name}</option>)}</select></div>
            <div className="grid gap-1.5 sm:col-span-2"><Label>Client site *</Label><select required className={fieldClass} value={assignmentForm.siteId} onChange={e => setAssignmentForm({ ...assignmentForm, siteId: e.target.value })}><option value="">Select a site</option>{activeSites.map(s => <option key={s.id} value={s.id}>{s.site_name} · {s.client_name}</option>)}</select></div>
            <div className="grid gap-1.5"><Label>Assignment title</Label><Input value={assignmentForm.assignmentTitle} onChange={e => setAssignmentForm({ ...assignmentForm, assignmentTitle: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label>Pay basis *</Label><select className={fieldClass} value={assignmentForm.payBasis} onChange={e => setAssignmentForm({ ...assignmentForm, payBasis: e.target.value })}><option value="monthly">Monthly</option><option value="daily">Daily</option><option value="hourly">Hourly</option><option value="per_shift">Per shift</option></select></div>
            <div className="grid gap-1.5"><Label>Pay rate *</Label><Input required type="number" min="0" step="0.01" value={assignmentForm.payRate} onChange={e => setAssignmentForm({ ...assignmentForm, payRate: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label>Currency</Label><Input maxLength={3} value={assignmentForm.currency} onChange={e => setAssignmentForm({ ...assignmentForm, currency: e.target.value.toUpperCase() })} /></div>
            <div className="grid gap-1.5"><Label>Start date *</Label><Input required type="date" value={assignmentForm.startDate} onChange={e => setAssignmentForm({ ...assignmentForm, startDate: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label>End date</Label><Input type="date" min={assignmentForm.startDate} value={assignmentForm.endDate} onChange={e => setAssignmentForm({ ...assignmentForm, endDate: e.target.value })} /></div>
            <div className="sm:col-span-2"><Button type="submit" disabled={savingAssignment || !activeEmployees.length || !activeSites.length}>{savingAssignment && <Loader2 className="mr-2 size-4 animate-spin" />}Create assignment</Button></div>
            {(!activeEmployees.length || !activeSites.length) && <p className="sm:col-span-2 text-xs text-muted-foreground">An active employee and active client site are required before an assignment can be created.</p>}
          </form>
          <div className="mt-5 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-y bg-muted/40 text-left"><th className="p-2">Employee</th><th className="p-2">Site</th><th className="p-2">Pay</th><th className="p-2">Dates / status</th></tr></thead><tbody>{assignments.map(a => <tr key={a.id} className="border-b last:border-0"><td className="p-2">{a.first_name} {a.last_name}<div className="text-xs text-muted-foreground">{a.employee_number}</div></td><td className="p-2">{a.site_name}<div className="text-xs text-muted-foreground">{a.client_name}</div></td><td className="p-2">{a.currency} {Number(a.pay_rate).toLocaleString()}<div className="text-xs text-muted-foreground">{a.pay_basis.replace("_", " ")}</div></td><td className="p-2"><span className="capitalize">{a.status}</span><div className="text-xs text-muted-foreground">{String(a.start_date).slice(0,10)} – {a.end_date ? String(a.end_date).slice(0,10) : "Open"}</div></td></tr>)}</tbody></table>{!assignments.length && <p className="p-4 text-sm text-muted-foreground">No employee assignments for this company yet.</p>}</div>
          <div className="mt-6 rounded-lg border p-4">
            <h3 className="mb-3 text-sm font-semibold">Transfer an active assignment</h3>
            <form onSubmit={transferAssignment} className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5 sm:col-span-2"><Label>Current assignment *</Label><select required className={fieldClass} value={transferForm.assignmentId} onChange={e => { const a = assignments.find(x => x.id === e.target.value); setTransferForm({ ...transferForm, assignmentId: e.target.value, payBasis: a?.pay_basis || "monthly", payRate: a ? String(a.pay_rate) : "" }); }}><option value="">Select an active assignment</option>{assignments.filter(a => a.status === "active").map(a => <option key={a.id} value={a.id}>{a.employee_number} · {a.first_name} {a.last_name} — {a.site_name}</option>)}</select></div>
              <div className="grid gap-1.5"><Label>Destination site *</Label><select required className={fieldClass} value={transferForm.siteId} onChange={e => setTransferForm({ ...transferForm, siteId: e.target.value })}><option value="">Select a site</option>{activeSites.map(s => <option key={s.id} value={s.id}>{s.site_name} · {s.client_name}</option>)}</select></div>
              <div className="grid gap-1.5"><Label>Effective date *</Label><Input required type="date" value={transferForm.effectiveDate} onChange={e => setTransferForm({ ...transferForm, effectiveDate: e.target.value })} /></div>
              <div className="grid gap-1.5"><Label>New pay basis *</Label><select required className={fieldClass} value={transferForm.payBasis} onChange={e => setTransferForm({ ...transferForm, payBasis: e.target.value })}><option value="monthly">Monthly</option><option value="daily">Daily</option><option value="hourly">Hourly</option><option value="per_shift">Per shift</option></select></div>
              <div className="grid gap-1.5"><Label>New pay rate *</Label><Input required type="number" min="0" step="0.01" value={transferForm.payRate} onChange={e => setTransferForm({ ...transferForm, payRate: e.target.value })} /></div>
              <div className="sm:col-span-2"><Button type="submit" disabled={savingTransfer || !transferForm.assignmentId || !transferForm.siteId}>{savingTransfer && <Loader2 className="mr-2 size-4 animate-spin" />}Transfer assignment</Button></div>
              {!assignments.some(a => a.status === "active") && <p className="sm:col-span-2 text-xs text-muted-foreground">There are no active assignments available to transfer.</p>}
            </form>
          </div>
        </CardContent></Card>
      </div>
      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileCheck2 className="size-4" />Monthly attendance checklist</CardTitle></CardHeader><CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">HR imports the monthly checklist using workers' national ID numbers. Export Excel to CSV first. For paper checklists, transcribe the monthly totals into this same template. Automated scan/OCR extraction is a follow-up step.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1.5"><Label>Attendance month</Label><Input type="month" value={importPeriod} onChange={e => { setImportPeriod(e.target.value); setImportPreview(null); }} /></div>
          <div className="grid gap-1.5 sm:col-span-2"><Label>CSV checklist file</Label><Input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={async e => { const file=e.target.files?.[0]; if(!file) return; setImportFileName(file.name); setImportCsv(await file.text()); setImportPreview(null); setImportError(null); }} /></div>
        </div>
        <div className="grid gap-1.5"><Label>Checklist CSV data</Label><textarea className="min-h-36 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs" value={importCsv} onChange={e => { setImportCsv(e.target.value); setImportPreview(null); }} placeholder={"nationalId,siteCode,scheduledDays,presentDays,absentDays,leaveDays,restDays,unresolvedDays,notes\n12345678,SITE-01,22,20,1,1,8,0,"} /></div>
        <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => { const blob=new Blob(["nationalId,siteCode,scheduledDays,presentDays,absentDays,leaveDays,restDays,unresolvedDays,notes\n"],{type:"text/csv;charset=utf-8;"}); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download="omega-monthly-attendance-template.csv"; a.click(); URL.revokeObjectURL(url); }}>Download CSV template</Button><Button onClick={() => void previewMonthlyImport()} disabled={importBusy || !importCsv.trim()}>{importBusy && <Loader2 className="mr-2 size-4 animate-spin" />}<Upload className="mr-2 size-4" />Preview checklist</Button></div>
        {importError && <p role="alert" className="text-sm text-destructive">{importError}</p>}
        {importNotice && <p role="status" className="text-sm text-emerald-700">{importNotice}</p>}
        {importPreview && <div className="space-y-3 rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-3 text-sm"><span>Rows: <strong>{importPreview.totalRows}</strong></span><span>Matched: <strong>{importPreview.matchedRows}</strong></span><span>Issues: <strong>{importPreview.issueRows}</strong></span><span className={importPreview.readyToImport?"text-emerald-700":"text-destructive"}>{importPreview.readyToImport?"Ready to import":"Resolve issues before importing"}</span></div>
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-y bg-muted/40 text-left"><th className="p-2">Row</th><th className="p-2">Matched worker</th><th className="p-2">ID</th><th className="p-2">Present</th><th className="p-2">Absent</th><th className="p-2">Issue</th></tr></thead><tbody>{importPreview.rows.map(row=><tr key={row.rowNumber} className="border-b"><td className="p-2">{row.rowNumber}</td><td className="p-2">{row.employeeName||"Unmatched"}</td><td className="p-2">{row.nationalIdMasked}</td><td className="p-2">{row.presentDays}</td><td className="p-2">{row.absentDays}</td><td className="p-2 text-destructive">{row.issue||"—"}</td></tr>)}</tbody></table></div>
          <Button onClick={() => void saveMonthlyImport()} disabled={importBusy || !importPreview.readyToImport}>{importBusy && <Loader2 className="mr-2 size-4 animate-spin" />}Import as draft</Button>
        </div>}
        <div className="space-y-2"><h3 className="text-sm font-semibold">Imported monthly registers</h3>{monthlyImports.length===0?<p className="text-sm text-muted-foreground">No imported attendance registers for this month.</p>:<div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-y bg-muted/40 text-left"><th className="p-2">Month</th><th className="p-2">Workers</th><th className="p-2">Present</th><th className="p-2">Absent</th><th className="p-2">Unresolved</th><th className="p-2">Status</th><th className="p-2">Action</th></tr></thead><tbody>{monthlyImports.map(item=><tr key={item.id} className="border-b"><td className="p-2">{String(item.period_start).slice(0,7)}</td><td className="p-2">{item.item_count}</td><td className="p-2">{item.present_days_total}</td><td className="p-2">{item.absent_days_total}</td><td className="p-2">{item.unresolved_days_total}</td><td className="p-2 capitalize">{item.status}</td><td className="p-2">{item.status==="draft"?<Button size="sm" variant="outline" onClick={()=>void approveMonthlyImport(item.id)} disabled={importBusy}>Approve</Button>:"Approved"}</td></tr>)}</tbody></table></div>}</div>
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Clock3 className="size-4" />Attendance</CardTitle></CardHeader><CardContent>
        <form onSubmit={recordPunch} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid gap-1.5"><Label>Employee *</Label><select required className={fieldClass} value={punchForm.employeeId} onChange={e => setPunchForm({ ...punchForm, employeeId: e.target.value })}><option value="">Select employee</option>{activeEmployees.map(e => <option key={e.id} value={e.id}>{e.employee_number} · {e.first_name} {e.last_name}</option>)}</select></div>
          <div className="grid gap-1.5"><Label>Action *</Label><select className={fieldClass} value={punchForm.punchType} onChange={e => setPunchForm({ ...punchForm, punchType: e.target.value as "in" | "out" })}><option value="in">Clock in</option><option value="out">Clock out</option></select></div>
          <div className="grid gap-1.5"><Label>Note</Label><Input value={punchForm.note} onChange={e => setPunchForm({ ...punchForm, note: e.target.value })} /></div>
          <div className="flex items-end"><Button type="submit" disabled={savingPunch || !activeEmployees.length}>{savingPunch && <Loader2 className="mr-2 size-4 animate-spin" />}Record attendance</Button></div>
        </form>
        <div className="mt-5 flex flex-wrap items-end gap-3"><div className="grid gap-1.5"><Label>From</Label><Input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} /></div><div className="grid gap-1.5"><Label>To</Label><Input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} /></div><Button variant="outline" onClick={() => { setFrom(""); setTo(""); }}>Clear date filters</Button></div>
        <div className="mt-4 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-y bg-muted/40 text-left"><th className="p-2">Employee</th><th className="p-2">Event</th><th className="p-2">Date & time</th><th className="p-2">Client site</th></tr></thead><tbody>{attendance.map(a => <tr key={a.id} className="border-b last:border-0"><td className="p-2">{a.first_name} {a.last_name}<div className="text-xs text-muted-foreground">{a.employee_number}</div></td><td className="p-2 capitalize">{a.punch_type === "in" ? "Clock in" : "Clock out"}</td><td className="p-2">{new Date(a.punched_at).toLocaleString()}</td><td className="p-2">{a.site_name || "—"}</td></tr>)}</tbody></table>{!attendance.length && <p className="p-4 text-sm text-muted-foreground">No attendance events match this company and date range.</p>}</div>
      </CardContent></Card>
    </>}
  </div></BaseLayout>;
}

function UsersIcon() {
  return <ClipboardList className="size-5 text-muted-foreground" />;
}
