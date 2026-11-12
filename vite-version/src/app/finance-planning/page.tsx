import * as React from "react"
import { Building2, CalendarRange, Plus, RefreshCw, CheckCircle2 } from "lucide-react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/lib/api-client"
import { formatKES } from "@/lib/format"

type Account={id:string;code:string;name:string;account_type:string;is_active:boolean}
type CostCentre={id:string;code:string;name:string;description:string|null;is_active:boolean}
type Budget={id:string;fiscal_year:number;period_month:number;budget_amount:number|string;status:string;account_id:string;account_code:string;account_name:string;account_type:string;cost_centre_id:string|null;cost_centre_code:string|null;cost_centre_name:string|null;actual_amount:number|string;favourable_variance:number|string}
const errorText=(e:unknown)=>e&&typeof e==="object"&&"message" in e?String((e as {message:unknown}).message):"The request failed."
const monthNames=["January","February","March","April","May","June","July","August","September","October","November","December"]
export default function FinancePlanningPage(){
 const [accounts,setAccounts]=React.useState<Account[]>([])
 const [centres,setCentres]=React.useState<CostCentre[]>([])
 const [budgets,setBudgets]=React.useState<Budget[]>([])
 const [year,setYear]=React.useState(String(new Date().getFullYear()))
 const [month,setMonth]=React.useState(String(new Date().getMonth()+1))
 const [loading,setLoading]=React.useState(true)
 const [saving,setSaving]=React.useState(false)
 const [error,setError]=React.useState<string|null>(null)
 const [centreForm,setCentreForm]=React.useState({code:"",name:"",description:""})
 const [budgetForm,setBudgetForm]=React.useState({accountId:"",costCentreId:"",budgetAmount:""})

 const load=React.useCallback(async()=>{
  setLoading(true);setError(null)
  try{
   const [accountRows,centreRows,budgetRows]=await Promise.all([
    api.get<Account[]>("/accounting/accounts"),
    api.get<CostCentre[]>("/accounting/cost-centres"),
    api.get<Budget[]>("/accounting/budgets?fiscalYear="+year+"&periodMonth="+month),
   ])
   setAccounts(accountRows.filter(a=>a.is_active&&(a.account_type==="income"||a.account_type==="expense")))
   setCentres(centreRows);setBudgets(budgetRows)
   setBudgetForm(current=>({...current,accountId:current.accountId||accountRows.find(a=>a.is_active&&(a.account_type==="expense"||a.account_type==="income"))?.id||""}))
  }catch(e){setError(errorText(e))}
  finally{setLoading(false)}
 },[year,month])
 React.useEffect(()=>{const timer=window.setTimeout(()=>{void load()},0);return()=>window.clearTimeout(timer)},[load])

 const createCentre=async()=>{
  if(!centreForm.code.trim()||!centreForm.name.trim()){setError("Enter a cost centre code and name.");return}
  setSaving(true);setError(null)
  try{await api.post("/accounting/cost-centres",centreForm);setCentreForm({code:"",name:"",description:""});await load()}
  catch(e){setError(errorText(e))}
  finally{setSaving(false)}
 }
 const createBudget=async()=>{
  if(!budgetForm.accountId||budgetForm.budgetAmount===""){setError("Select an account and enter a budget amount.");return}
  setSaving(true);setError(null)
  try{
   await api.post("/accounting/budgets",{fiscalYear:Number(year),periodMonth:Number(month),accountId:budgetForm.accountId,costCentreId:budgetForm.costCentreId||undefined,budgetAmount:Number(budgetForm.budgetAmount)})
   setBudgetForm(current=>({...current,budgetAmount:""}));await load()
  }catch(e){setError(errorText(e))}
  finally{setSaving(false)}
 }
 const approve=async(id:string)=>{
  setSaving(true);setError(null)
  try{await api.post("/accounting/budgets/"+id+"/approve",{});await load()}
  catch(e){setError(errorText(e))}
  finally{setSaving(false)}
 }

 return <BaseLayout><div className="flex flex-col gap-6 px-4 lg:px-6">
  <PageHeader title="Budgets & cost centres" description="Create monthly income and expense budgets, assign cost centres and compare approved budgets with tagged ledger actuals." action={<Button variant="outline" onClick={()=>void load()} disabled={loading}><RefreshCw className="size-4"/>Refresh</Button>}/>
  {error&&<div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
  <div className="grid gap-4 lg:grid-cols-2">
   <Card><CardContent className="flex flex-col gap-3 p-4"><div><h2 className="font-semibold">Create cost centre</h2><p className="text-sm text-muted-foreground">Use cost centres to tag expenses and manual journals to departments or projects.</p></div><div className="grid gap-3 sm:grid-cols-2"><div className="flex flex-col gap-1"><Label>Code</Label><Input value={centreForm.code} onChange={e=>setCentreForm(v=>({...v,code:e.target.value.toUpperCase()}))} maxLength={40}/></div><div className="flex flex-col gap-1"><Label>Name</Label><Input value={centreForm.name} onChange={e=>setCentreForm(v=>({...v,name:e.target.value}))} maxLength={160}/></div><div className="flex flex-col gap-1 sm:col-span-2"><Label>Description</Label><Input value={centreForm.description} onChange={e=>setCentreForm(v=>({...v,description:e.target.value}))} maxLength={1000}/></div></div><div className="flex justify-end"><Button onClick={()=>void createCentre()} disabled={saving}><Plus className="size-4"/>Create cost centre</Button></div></CardContent></Card>
   <Card><CardContent className="flex flex-col gap-3 p-4"><div><h2 className="font-semibold">Create monthly budget</h2><p className="text-sm text-muted-foreground">Budgets are assigned to an income or expense account, month and optional cost centre.</p></div><div className="grid gap-3 sm:grid-cols-2"><div className="flex flex-col gap-1"><Label>Fiscal year</Label><Input type="number" min="2000" max="2200" value={year} onChange={e=>setYear(e.target.value)}/></div><div className="flex flex-col gap-1"><Label>Month</Label><select className="h-9 rounded-md border bg-background px-3 text-sm" value={month} onChange={e=>setMonth(e.target.value)}>{monthNames.map((name,i)=><option key={name} value={i+1}>{name}</option>)}</select></div><div className="flex flex-col gap-1 sm:col-span-2"><Label>Account</Label><select className="h-9 rounded-md border bg-background px-3 text-sm" value={budgetForm.accountId} onChange={e=>setBudgetForm(v=>({...v,accountId:e.target.value}))}><option value="">Select account</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.code} · {a.name} ({a.account_type})</option>)}</select></div><div className="flex flex-col gap-1"><Label>Cost centre (optional)</Label><select className="h-9 rounded-md border bg-background px-3 text-sm" value={budgetForm.costCentreId} onChange={e=>setBudgetForm(v=>({...v,costCentreId:e.target.value}))}><option value="">Company-wide / unassigned</option>{centres.filter(c=>c.is_active).map(c=><option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></div><div className="flex flex-col gap-1"><Label>Budget amount (KES)</Label><Input type="number" min="0" step="0.01" value={budgetForm.budgetAmount} onChange={e=>setBudgetForm(v=>({...v,budgetAmount:e.target.value}))}/></div></div><div className="flex justify-end"><Button onClick={()=>void createBudget()} disabled={saving}><Plus className="size-4"/>Add budget</Button></div></CardContent></Card>
  </div>
  <Card><CardContent className="flex flex-col gap-3 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">Cost centres</h2><p className="text-sm text-muted-foreground">{centres.length} registered cost centres</p></div></div>{centres.length===0?<EmptyState icon={Building2} title="No cost centres" description="Create departments, branches or projects as cost centres."/>:<Table><TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Description</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{centres.map(c=><TableRow key={c.id}><TableCell className="font-mono">{c.code}</TableCell><TableCell className="font-medium">{c.name}</TableCell><TableCell>{c.description||"—"}</TableCell><TableCell>{c.is_active?"Active":"Inactive"}</TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card>
  <Card><CardContent className="flex flex-col gap-3 p-4"><div><h2 className="font-semibold">Budget vs actual</h2><p className="text-sm text-muted-foreground">{monthNames[Number(month)-1]} {year} · Variance is favourable when positive.</p></div>{loading?<div className="flex justify-center py-8"><LoadingSpinner/></div>:budgets.length===0?<EmptyState icon={CalendarRange} title="No budgets for this period" description="Create monthly budgets to start tracking performance."/>:<div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Account</TableHead><TableHead>Cost centre</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Budget</TableHead><TableHead className="text-right">Actual</TableHead><TableHead className="text-right">Favourable variance</TableHead><TableHead/></TableRow></TableHeader><TableBody>{budgets.map(b=><TableRow key={b.id}><TableCell><div className="font-medium">{b.account_name}</div><div className="text-xs text-muted-foreground">{b.account_code} · {b.account_type}</div></TableCell><TableCell>{b.cost_centre_code?b.cost_centre_code+" · "+b.cost_centre_name:"Company-wide"}</TableCell><TableCell className="capitalize">{b.status}</TableCell><TableCell className="text-right tabular-nums">{formatKES(Number(b.budget_amount))}</TableCell><TableCell className="text-right tabular-nums">{formatKES(Number(b.actual_amount))}</TableCell><TableCell className={"text-right tabular-nums "+(Number(b.favourable_variance)<0?"text-destructive":"text-emerald-600")}>{formatKES(Number(b.favourable_variance))}</TableCell><TableCell>{b.status==="draft"?<Button size="sm" variant="outline" disabled={saving} onClick={()=>void approve(b.id)}><CheckCircle2 className="size-3.5"/>Approve</Button>:<span className="text-xs text-muted-foreground">Approved</span>}</TableCell></TableRow>)}</TableBody></Table></div>}</CardContent></Card>
 </div></BaseLayout>
}
