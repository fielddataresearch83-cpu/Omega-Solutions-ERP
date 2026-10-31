import * as React from "react";
import { CalendarDays, Loader2, RefreshCw } from "lucide-react";
import { BaseLayout } from "@/components/layouts/base-layout";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { api } from "@/lib/api-client";

type Employee={id:string;employee_number:string;first_name:string;last_name:string};
type Leave={id:string;employee_id:string;employee_number:string;first_name:string;last_name:string;leave_type:string;start_date:string;end_date:string;reason:string|null;status:"pending"|"approved"|"rejected"|"cancelled";review_note:string|null};
const blank={employeeId:"",leaveType:"annual",startDate:"",endDate:"",reason:""};
const message=(e:unknown)=>e&&typeof e==="object"&&"message" in e?String((e as {message:unknown}).message):"The request failed. Please try again.";

export default function LeaveManagementPage(){
 const [employees,setEmployees]=React.useState<Employee[]>([]);const [rows,setRows]=React.useState<Leave[]>([]);
 const [loading,setLoading]=React.useState(true);const [saving,setSaving]=React.useState(false);const [busyId,setBusyId]=React.useState<string|null>(null);
 const [error,setError]=React.useState<string|null>(null);const [formError,setFormError]=React.useState<string|null>(null);const [form,setForm]=React.useState(blank);
 const load=React.useCallback(async()=>{setLoading(true);setError(null);try{const [e,l]=await Promise.all([api.get<Employee[]>("/employees"),api.get<Leave[]>("/employees/leave-requests")]);setEmployees(e);setRows(l);setForm(f=>({...f,employeeId:f.employeeId||e[0]?.id||""}));}catch(e){setError(message(e));}finally{setLoading(false);}},[]);
 React.useEffect(()=>{let active=true;void Promise.all([api.get<Employee[]>("/employees"),api.get<Leave[]>("/employees/leave-requests")]).then(([employeesResult,leaveResult])=>{if(active){setEmployees(employeesResult);setRows(leaveResult);setForm(f=>({...f,employeeId:f.employeeId||employeesResult[0]?.id||""}));}}).catch(e=>{if(active)setError(message(e));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
 async function submit(e:React.FormEvent<HTMLFormElement>){e.preventDefault();setSaving(true);setFormError(null);try{await api.post("/employees/leave-requests",{...form,reason:form.reason.trim()||undefined});setForm(f=>({...blank,employeeId:f.employeeId}));await load();}catch(e){setFormError(message(e));}finally{setSaving(false);}}
 async function review(id:string,status:"approved"|"rejected"){setBusyId(id);setError(null);try{await api.patch(`/employees/leave-requests/${id}/review`,{status});await load();}catch(e){setError(message(e));}finally{setBusyId(null);}}
 return <BaseLayout><div className="flex flex-col gap-6 px-4 lg:px-6">
  <PageHeader title="Leave Management" description="Submit leave requests and review pending requests for your company."/>
  <Card><CardHeader><CardTitle className="text-base">New leave request</CardTitle></CardHeader><CardContent>
   {employees.length===0&&!loading?<p className="text-sm text-muted-foreground">Create an employee record before submitting leave.</p>:<form onSubmit={submit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    <div className="grid gap-2"><Label>Employee *</Label><select required className="h-9 rounded-md border bg-background px-3 text-sm" value={form.employeeId} onChange={e=>setForm({...form,employeeId:e.target.value})}>{employees.map(e=><option key={e.id} value={e.id}>{e.employee_number} — {e.first_name} {e.last_name}</option>)}</select></div>
    <div className="grid gap-2"><Label>Leave type *</Label><select className="h-9 rounded-md border bg-background px-3 text-sm" value={form.leaveType} onChange={e=>setForm({...form,leaveType:e.target.value})}>{["annual","sick","maternity","paternity","compassionate","unpaid","other"].map(v=><option key={v} value={v}>{v[0].toUpperCase()+v.slice(1)}</option>)}</select></div>
    <div className="grid gap-2"><Label>Start date *</Label><Input type="date" required value={form.startDate} onChange={e=>setForm({...form,startDate:e.target.value})}/></div>
    <div className="grid gap-2"><Label>End date *</Label><Input type="date" required min={form.startDate||undefined} value={form.endDate} onChange={e=>setForm({...form,endDate:e.target.value})}/></div>
    <div className="grid gap-2 sm:col-span-2"><Label>Reason</Label><Input maxLength={2000} value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})}/></div>
    <div className="flex items-end"><Button type="submit" disabled={saving||!form.employeeId}>{saving?<Loader2 className="mr-2 size-4 animate-spin"/>:null}{saving?"Submitting…":"Submit request"}</Button></div>
    {formError&&<p role="alert" className="text-sm text-destructive sm:col-span-2 lg:col-span-3">{formError}</p>}
   </form>}
  </CardContent></Card>
  <Card><CardContent className="p-0"><div className="flex items-center justify-between p-4"><h2 className="font-semibold">Leave requests <span className="font-normal text-muted-foreground">({rows.length})</span></h2><Button variant="outline" size="sm" disabled={loading} onClick={()=>void load()}><RefreshCw className="mr-2 size-4"/>Refresh</Button></div>
   {loading?<div className="flex justify-center p-12"><LoadingSpinner/></div>:error?<div className="p-6 text-sm text-destructive" role="alert">{error}<Button className="ml-3" variant="outline" size="sm" onClick={()=>void load()}>Retry</Button></div>:rows.length===0?<EmptyState icon={CalendarDays} title="No leave requests yet" description="Leave requests will appear here when submitted. No sample requests are loaded."/>:
   <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-y bg-muted/40 text-left"><th className="p-3">Employee</th><th className="p-3">Type</th><th className="p-3">Dates</th><th className="p-3">Reason</th><th className="p-3">Status</th><th className="p-3">Review</th></tr></thead><tbody>{rows.map(row=><tr key={row.id} className="border-b last:border-0"><td className="p-3">{row.first_name} {row.last_name}<div className="text-muted-foreground">{row.employee_number}</div></td><td className="p-3 capitalize">{row.leave_type}</td><td className="p-3 whitespace-nowrap">{row.start_date.slice(0,10)} – {row.end_date.slice(0,10)}</td><td className="p-3">{row.reason||"—"}</td><td className="p-3 capitalize">{row.status}</td><td className="p-3">{row.status==="pending"?<div className="flex gap-2"><Button size="sm" disabled={busyId===row.id} onClick={()=>void review(row.id,"approved")}>Approve</Button><Button size="sm" variant="outline" disabled={busyId===row.id} onClick={()=>void review(row.id,"rejected")}>Reject</Button></div>:row.review_note||"—"}</td></tr>)}</tbody></table></div>}
  </CardContent></Card>
 </div></BaseLayout>;
}
