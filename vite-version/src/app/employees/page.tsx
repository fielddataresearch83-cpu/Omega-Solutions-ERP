import * as React from "react";
import { Loader2, RefreshCw, UserPlus, Users, Save } from "lucide-react";
import { BaseLayout } from "@/components/layouts/base-layout";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { api } from "@/lib/api-client";

type Employee={id:string;employee_number:string;first_name:string;last_name:string;work_email:string|null;phone:string|null;job_title:string|null;department:string|null;employment_status:string;hire_date:string|null;branch_name?:string|null;has_kra_pin?:boolean;has_nssf_number?:boolean;has_sha_number?:boolean;has_nhif_number?:boolean};
type LeaveRequest={id:string;employee_id:string;employee_number:string;first_name:string;last_name:string;leave_type:string;start_date:string;end_date:string;reason:string|null;status:"pending"|"approved"|"rejected";review_note:string|null;created_at:string};
const blank={employeeNumber:"",nationalId:"",kraPin:"",nssfNumber:"",shaNumber:"",nhifNumber:"",firstName:"",lastName:"",workEmail:"",phone:"",jobTitle:"",department:"",hireDate:"",monthlyBasicSalary:"",monthlyTaxableAllowances:"0",monthlyTaxableBenefits:"0",employeePensionContribution:"0",postRetirementMedicalContribution:"0",qualifyingMortgageInterest:"0",eligibleInsurancePremiums:"0"};
const message=(e:unknown)=>e&&typeof e==="object"&&"message" in e?String((e as {message:unknown}).message):"The request failed. Please try again.";

export default function EmployeesPage(){
 const [rows,setRows]=React.useState<Employee[]>([]);
 const [loading,setLoading]=React.useState(true);
 const [saving,setSaving]=React.useState(false);
 const [error,setError]=React.useState<string|null>(null);
 const [formError,setFormError]=React.useState<string|null>(null);
 const [form,setForm]=React.useState(blank);
 const [nationalIds,setNationalIds]=React.useState<Record<string,string>>({});
 const [savingNationalId,setSavingNationalId]=React.useState<string|null>(null);
 const [idMessage,setIdMessage]=React.useState<string|null>(null);
 const [leaveRows,setLeaveRows]=React.useState<LeaveRequest[]>([]);
 const [leaveLoading,setLeaveLoading]=React.useState(false);
 const [leaveSaving,setLeaveSaving]=React.useState(false);
 const [leaveError,setLeaveError]=React.useState<string|null>(null);
 const [leaveNotice,setLeaveNotice]=React.useState<string|null>(null);
 const [leaveForm,setLeaveForm]=React.useState({employeeId:"",leaveType:"annual",startDate:"",endDate:"",reason:""});
 const load=React.useCallback(async()=>{setLoading(true);setError(null);try{setRows(await api.get<Employee[]>("/employees"));}catch(e){setError(message(e));}finally{setLoading(false);}},[]);
 React.useEffect(()=>{void Promise.resolve().then(load);},[load]);
 const loadLeaveRequests=React.useCallback(async()=>{setLeaveLoading(true);setLeaveError(null);try{setLeaveRows(await api.get<LeaveRequest[]>("/employees/leave-requests"));}catch(e){setLeaveError(message(e));}finally{setLeaveLoading(false);}},[]);
 React.useEffect(()=>{void Promise.resolve().then(loadLeaveRequests);},[loadLeaveRequests]);
 async function submitLeaveRequest(e:React.FormEvent<HTMLFormElement>){e.preventDefault();setLeaveSaving(true);setLeaveError(null);setLeaveNotice(null);try{await api.post("/employees/leave-requests",{...leaveForm,reason:leaveForm.reason.trim()||undefined});setLeaveForm({employeeId:"",leaveType:"annual",startDate:"",endDate:"",reason:""});setLeaveNotice("Leave request submitted for review.");await loadLeaveRequests();}catch(e){setLeaveError(message(e));}finally{setLeaveSaving(false);}}
 async function reviewLeaveRequest(id:string,status:"approved"|"rejected"){setLeaveSaving(true);setLeaveError(null);setLeaveNotice(null);try{await api.patch("/employees/leave-requests/"+id+"/review",{status});setLeaveNotice("Leave request "+status+".");await loadLeaveRequests();}catch(e){setLeaveError(message(e));}finally{setLeaveSaving(false);}}
 async function saveNationalId(employeeId:string){
  setSavingNationalId(employeeId);setFormError(null);setIdMessage(null);
  try{const result=await api.patch<{nationalIdMasked:string}>(`/employees/${employeeId}/national-id`,{nationalId:nationalIds[employeeId]||""});setNationalIds({...nationalIds,[employeeId]:""});setIdMessage(`National ID saved for this employee (${result.nationalIdMasked}).`);}
  catch(e){setFormError(message(e));}finally{setSavingNationalId(null);}
 }
 async function submit(e:React.FormEvent<HTMLFormElement>){e.preventDefault();setSaving(true);setFormError(null);try{const employee=await api.post<Employee>("/employees",{...form,nationalId:form.nationalId.trim()||undefined,kraPin:form.kraPin.trim()||undefined,nssfNumber:form.nssfNumber.trim()||undefined,shaNumber:form.shaNumber.trim()||undefined,nhifNumber:form.nhifNumber.trim()||undefined,workEmail:form.workEmail.trim()||undefined,phone:form.phone.trim()||undefined,jobTitle:form.jobTitle.trim()||undefined,department:form.department.trim()||undefined,hireDate:form.hireDate||undefined});let payrollWarning:string|null=null;if(form.monthlyBasicSalary.trim()){try{await api.post(`/payroll/employees/${employee.id}/settings`,{monthlyBasicSalary:Number(form.monthlyBasicSalary),monthlyTaxableAllowances:Number(form.monthlyTaxableAllowances||0),monthlyTaxableBenefits:Number(form.monthlyTaxableBenefits||0),employeePensionContribution:Number(form.employeePensionContribution||0),postRetirementMedicalContribution:Number(form.postRetirementMedicalContribution||0),qualifyingMortgageInterest:Number(form.qualifyingMortgageInterest||0),eligibleInsurancePremiums:Number(form.eligibleInsurancePremiums||0),residentForTaxPurposes:true,effectiveFrom:form.hireDate||new Date().toISOString().slice(0,10)});}catch(e){payrollWarning=`Employee created, but payroll settings were not saved: ${message(e)}. Open Payroll to finish setup; do not submit this employee again.`;}}setForm(blank);await load();if(payrollWarning)setFormError(payrollWarning);}catch(e){setFormError(message(e));}finally{setSaving(false);}}
 return <BaseLayout><div className="flex flex-col gap-6 px-4 lg:px-6">
  <PageHeader title="Employees" description="Manage employee records for the active company." />
  <Card><CardHeader><CardTitle className="text-base">Add employee</CardTitle></CardHeader><CardContent><form onSubmit={submit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
   <div className="grid gap-2"><Label>Employee number *</Label><Input required maxLength={50} value={form.employeeNumber} onChange={e=>setForm({...form,employeeNumber:e.target.value})}/></div>
   <div className="grid gap-2"><Label>National ID number</Label><Input inputMode="numeric" maxLength={32} value={form.nationalId} onChange={e=>setForm({...form,nationalId:e.target.value})} placeholder="Used to match attendance checklists"/></div>
   <div className="grid gap-2"><Label>KRA PIN</Label><Input autoCapitalize="characters" maxLength={20} value={form.kraPin} onChange={e=>setForm({...form,kraPin:e.target.value.toUpperCase()})} placeholder="e.g. A123456789Z"/></div>
   <div className="grid gap-2"><Label>NSSF number</Label><Input maxLength={30} value={form.nssfNumber} onChange={e=>setForm({...form,nssfNumber:e.target.value})}/></div>
   <div className="grid gap-2"><Label>SHA / SHIF number</Label><Input maxLength={30} value={form.shaNumber} onChange={e=>setForm({...form,shaNumber:e.target.value})}/></div>
   <div className="grid gap-2"><Label>Legacy NHIF number (optional)</Label><Input maxLength={30} value={form.nhifNumber} onChange={e=>setForm({...form,nhifNumber:e.target.value})}/></div>
   <div className="grid gap-2"><Label>First name *</Label><Input required value={form.firstName} onChange={e=>setForm({...form,firstName:e.target.value})}/></div>
   <div className="grid gap-2"><Label>Last name *</Label><Input required value={form.lastName} onChange={e=>setForm({...form,lastName:e.target.value})}/></div>
   <div className="grid gap-2"><Label>Work email</Label><Input type="email" value={form.workEmail} onChange={e=>setForm({...form,workEmail:e.target.value})}/></div>
   <div className="grid gap-2"><Label>Phone</Label><Input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></div>
   <div className="grid gap-2"><Label>Job title</Label><Input value={form.jobTitle} onChange={e=>setForm({...form,jobTitle:e.target.value})}/></div>
   <div className="grid gap-2"><Label>Department</Label><Input value={form.department} onChange={e=>setForm({...form,department:e.target.value})}/></div>
   <div className="grid gap-2"><Label>Hire date</Label><Input type="date" value={form.hireDate} onChange={e=>setForm({...form,hireDate:e.target.value})}/></div>
   <div className="sm:col-span-2 lg:col-span-3 mt-2 border-t pt-4"><h3 className="font-semibold">Payroll setup</h3><p className="text-sm text-muted-foreground">Enter basic pay to configure payroll now. PAYE, NSSF, SHA/SHIF and housing levy are calculated by the payroll rules for the pay period; do not enter PAYE manually.</p></div>
   <div className="grid gap-2"><Label>Monthly basic salary (KES)</Label><Input type="number" min="0" step="0.01" value={form.monthlyBasicSalary} onChange={e=>setForm({...form,monthlyBasicSalary:e.target.value})} placeholder="Leave blank to configure payroll later"/></div>
   <div className="grid gap-2"><Label>Monthly taxable allowances (KES)</Label><Input type="number" min="0" step="0.01" value={form.monthlyTaxableAllowances} onChange={e=>setForm({...form,monthlyTaxableAllowances:e.target.value})}/></div>
   <div className="grid gap-2"><Label>Monthly taxable benefits (KES)</Label><Input type="number" min="0" step="0.01" value={form.monthlyTaxableBenefits} onChange={e=>setForm({...form,monthlyTaxableBenefits:e.target.value})}/></div>
   <div className="grid gap-2"><Label>Employee pension contribution (KES)</Label><Input type="number" min="0" step="0.01" value={form.employeePensionContribution} onChange={e=>setForm({...form,employeePensionContribution:e.target.value})}/></div>
   <div className="grid gap-2"><Label>Post-retirement medical contribution (KES)</Label><Input type="number" min="0" step="0.01" value={form.postRetirementMedicalContribution} onChange={e=>setForm({...form,postRetirementMedicalContribution:e.target.value})}/></div>
   <div className="grid gap-2"><Label>Qualifying mortgage interest (KES)</Label><Input type="number" min="0" step="0.01" value={form.qualifyingMortgageInterest} onChange={e=>setForm({...form,qualifyingMortgageInterest:e.target.value})}/></div>
   <div className="grid gap-2"><Label>Eligible insurance premiums (KES)</Label><Input type="number" min="0" step="0.01" value={form.eligibleInsurancePremiums} onChange={e=>setForm({...form,eligibleInsurancePremiums:e.target.value})}/></div>
   <div className="flex items-end"><Button type="submit" disabled={saving}>{saving?<Loader2 className="mr-2 size-4 animate-spin"/>:<UserPlus className="mr-2 size-4"/>}{saving?"Saving…":"Add employee"}</Button></div>
   {idMessage&&<p role="status" className="text-sm text-emerald-700">{idMessage}</p>}
  {formError&&<p role="alert" className="text-sm text-destructive sm:col-span-2 lg:col-span-3">{formError}</p>}
  </form></CardContent></Card>
  <Card><CardContent className="p-0">
   <div className="flex items-center justify-between gap-3 p-4"><h2 className="font-semibold">Employee directory <span className="text-muted-foreground font-normal">({rows.length})</span></h2><Button variant="outline" size="sm" onClick={()=>void load()} disabled={loading}><RefreshCw className="mr-2 size-4"/>Refresh</Button></div>
   {loading?<div className="flex justify-center p-12"><LoadingSpinner/></div>:error?<div className="p-6 text-sm text-destructive" role="alert">{error}<Button className="ml-3" variant="outline" size="sm" onClick={()=>void load()}>Retry</Button></div>:rows.length===0?<EmptyState icon={Users} title="No employees yet" description="Add your first employee above. No sample employee records are loaded."/>:
   <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-y bg-muted/40 text-left"><th className="p-3">Employee</th><th className="p-3">Number</th><th className="p-3">Role / Department</th><th className="p-3">Contact</th><th className="p-3">Status</th><th className="p-3">Hire date</th><th className="p-3">Statutory profile</th><th className="p-3">Attendance ID number</th></tr></thead><tbody>{rows.map(row=><tr key={row.id} className="border-b last:border-0"><td className="p-3 font-medium">{row.first_name} {row.last_name}</td><td className="p-3">{row.employee_number}</td><td className="p-3">{row.job_title||"—"}<div className="text-muted-foreground">{row.department||"—"}</div></td><td className="p-3">{row.work_email||row.phone||"—"}</td><td className="p-3 capitalize">{row.employment_status.replace("_"," ")}</td><td className="p-3">{row.hire_date?row.hire_date.slice(0,10):"—"}</td><td className="p-3"><div className="flex flex-wrap gap-1">{row.has_kra_pin&&<span className="rounded bg-muted px-2 py-1 text-xs">KRA</span>}{row.has_nssf_number&&<span className="rounded bg-muted px-2 py-1 text-xs">NSSF</span>}{row.has_sha_number&&<span className="rounded bg-muted px-2 py-1 text-xs">SHA</span>}{row.has_nhif_number&&<span className="rounded bg-muted px-2 py-1 text-xs">Legacy NHIF</span>}{!row.has_kra_pin&&!row.has_nssf_number&&!row.has_sha_number&&!row.has_nhif_number&&<span className="text-muted-foreground">Incomplete</span>}</div></td><td className="p-3"><div className="flex min-w-56 gap-2"><Input aria-label={`National ID for ${row.first_name} ${row.last_name}`} inputMode="numeric" maxLength={32} placeholder="Enter ID number" value={nationalIds[row.id]||""} onChange={e=>setNationalIds({...nationalIds,[row.id]:e.target.value})}/><Button size="sm" variant="outline" onClick={()=>void saveNationalId(row.id)} disabled={savingNationalId===row.id||!(nationalIds[row.id]||"").trim()}>{savingNationalId===row.id?<Loader2 className="size-4 animate-spin"/>:<Save className="size-4"/>}</Button></div></td></tr>)}</tbody></table></div>}
  </CardContent></Card>
  <Card><CardHeader><CardTitle className="text-base">Leave management</CardTitle></CardHeader><CardContent className="space-y-4">
   <form onSubmit={submitLeaveRequest} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
    <div className="grid gap-1.5 lg:col-span-2"><Label>Employee *</Label><select required className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={leaveForm.employeeId} onChange={e=>setLeaveForm({...leaveForm,employeeId:e.target.value})}><option value="">Select employee</option>{rows.filter(r=>!["terminated","inactive"].includes(r.employment_status)).map(r=><option key={r.id} value={r.id}>{r.employee_number} · {r.first_name} {r.last_name}</option>)}</select></div>
    <div className="grid gap-1.5"><Label>Leave type *</Label><select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={leaveForm.leaveType} onChange={e=>setLeaveForm({...leaveForm,leaveType:e.target.value})}><option value="annual">Annual</option><option value="sick">Sick</option><option value="maternity">Maternity</option><option value="paternity">Paternity</option><option value="compassionate">Compassionate</option><option value="unpaid">Unpaid</option><option value="other">Other</option></select></div>
    <div className="grid gap-1.5"><Label>Start date *</Label><Input required type="date" value={leaveForm.startDate} onChange={e=>setLeaveForm({...leaveForm,startDate:e.target.value})}/></div>
    <div className="grid gap-1.5"><Label>End date *</Label><Input required type="date" min={leaveForm.startDate||undefined} value={leaveForm.endDate} onChange={e=>setLeaveForm({...leaveForm,endDate:e.target.value})}/></div>
    <div className="grid gap-1.5 sm:col-span-2 lg:col-span-4"><Label>Reason / notes</Label><Input maxLength={2000} value={leaveForm.reason} onChange={e=>setLeaveForm({...leaveForm,reason:e.target.value})} placeholder="Optional supporting note"/></div>
    <div className="flex items-end"><Button type="submit" disabled={leaveSaving||!rows.length}>{leaveSaving?<Loader2 className="mr-2 size-4 animate-spin"/>:null}Submit leave</Button></div>
   </form>
   {leaveError&&<p role="alert" className="text-sm text-destructive">{leaveError}</p>}
   {leaveNotice&&<p role="status" className="text-sm text-emerald-700">{leaveNotice}</p>}
   <div className="flex items-center justify-between"><h3 className="font-semibold">Leave requests <span className="font-normal text-muted-foreground">({leaveRows.length})</span></h3><Button size="sm" variant="outline" onClick={()=>void loadLeaveRequests()} disabled={leaveLoading}><RefreshCw className="mr-2 size-4"/>Refresh</Button></div>
   {leaveLoading?<div className="flex justify-center p-6"><LoadingSpinner/></div>:leaveRows.length===0?<p className="text-sm text-muted-foreground">No leave requests for this company yet.</p>:<div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-y bg-muted/40 text-left"><th className="p-2">Employee</th><th className="p-2">Leave</th><th className="p-2">Dates</th><th className="p-2">Reason</th><th className="p-2">Status</th><th className="p-2">Review</th></tr></thead><tbody>{leaveRows.map(row=><tr key={row.id} className="border-b last:border-0"><td className="p-2 font-medium">{row.first_name} {row.last_name}<div className="text-xs text-muted-foreground">{row.employee_number}</div></td><td className="p-2 capitalize">{row.leave_type}</td><td className="p-2 whitespace-nowrap">{String(row.start_date).slice(0,10)} – {String(row.end_date).slice(0,10)}</td><td className="p-2 max-w-xs">{row.reason||"—"}</td><td className="p-2 capitalize">{row.status}</td><td className="p-2">{row.status==="pending"?<div className="flex gap-2"><Button size="sm" onClick={()=>void reviewLeaveRequest(row.id,"approved")} disabled={leaveSaving}>Approve</Button><Button size="sm" variant="outline" onClick={()=>void reviewLeaveRequest(row.id,"rejected")} disabled={leaveSaving}>Reject</Button></div>:row.review_note||"Reviewed"}</td></tr>)}</tbody></table></div>}
  </CardContent></Card>
 </div></BaseLayout>;
}
