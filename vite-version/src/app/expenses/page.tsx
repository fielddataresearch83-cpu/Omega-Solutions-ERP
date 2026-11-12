import * as React from "react";
import { Loader2, RefreshCw, Wallet } from "lucide-react";
import { BaseLayout } from "@/components/layouts/base-layout";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { api } from "@/lib/api-client";
import { formatKES } from "@/lib/format";

type Expense={id:string;expense_number:string;expense_date:string;description:string;category:string;amount:number|string;payment_method:string;reference:string|null;account_code:string;account_name:string;cost_centre_code:string|null;cost_centre_name:string|null;journal_entry_id:string};
type CostCentre={id:string;code:string;name:string;is_active:boolean};
const blank={description:"",category:"",amount:"",paymentMethod:"bank",expenseDate:new Date().toISOString().slice(0,10),reference:"",costCentreId:""};
const message=(e:unknown)=>e&&typeof e==="object"&&"message" in e?String((e as {message:unknown}).message):"The request failed. Please try again.";

export default function ExpensesPage(){
 const [rows,setRows]=React.useState<Expense[]>([]);const [costCentres,setCostCentres]=React.useState<CostCentre[]>([]);const [loading,setLoading]=React.useState(true);const [saving,setSaving]=React.useState(false);
 const [error,setError]=React.useState<string|null>(null);const [formError,setFormError]=React.useState<string|null>(null);const [form,setForm]=React.useState(blank);
 const load=React.useCallback(async()=>{setLoading(true);setError(null);try{setRows(await api.get<Expense[]>("/expenses"));}catch(e){setError(message(e));}finally{setLoading(false);}},[]);
 React.useEffect(()=>{let active=true;void Promise.all([api.get<Expense[]>("/expenses"),api.get<CostCentre[]>("/accounting/cost-centres")]).then(([expenseRows,centreRows])=>{if(active){setRows(expenseRows);setCostCentres(centreRows);}}).catch(e=>{if(active)setError(message(e));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
 async function submit(e:React.FormEvent<HTMLFormElement>){e.preventDefault();setSaving(true);setFormError(null);try{await api.post("/expenses",{...form,amount:Number(form.amount),reference:form.reference.trim()||undefined,costCentreId:form.costCentreId||undefined});setForm({...blank,expenseDate:form.expenseDate});await load();}catch(e){setFormError(message(e));}finally{setSaving(false);}}
 return <BaseLayout><div className="flex flex-col gap-6 px-4 lg:px-6">
  <PageHeader title="Expenses" description="Record business expenses and post balanced entries to the general ledger."/>
  <Card><CardHeader><CardTitle className="text-base">Record expense</CardTitle></CardHeader><CardContent><form onSubmit={submit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
   <div className="grid gap-2"><Label>Description *</Label><Input required minLength={2} maxLength={240} value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></div>
   <div className="grid gap-2"><Label>Category *</Label><Input required minLength={2} maxLength={120} value={form.category} onChange={e=>setForm({...form,category:e.target.value})} placeholder="e.g. Utilities"/></div>
   <div className="grid gap-2"><Label>Amount (KES) *</Label><Input required type="number" min="0.01" step="0.01" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/></div>
   <div className="grid gap-2"><Label>Payment method *</Label><select className="h-9 rounded-md border bg-background px-3 text-sm" value={form.paymentMethod} onChange={e=>setForm({...form,paymentMethod:e.target.value})}><option value="cash">Cash</option><option value="mpesa">M-Pesa</option><option value="bank">Bank</option></select></div>
   <div className="grid gap-2"><Label>Expense date *</Label><Input required type="date" value={form.expenseDate} onChange={e=>setForm({...form,expenseDate:e.target.value})}/></div>
   <div className="grid gap-2"><Label>Reference</Label><Input maxLength={160} value={form.reference} onChange={e=>setForm({...form,reference:e.target.value})}/></div>
   <div className="grid gap-2"><Label>Cost centre</Label><select className="h-9 rounded-md border bg-background px-3 text-sm" value={form.costCentreId} onChange={e=>setForm({...form,costCentreId:e.target.value})}><option value="">Unassigned</option>{costCentres.filter(c=>c.is_active).map(c=><option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></div>
   <div className="flex items-end"><Button type="submit" disabled={saving}>{saving?<Loader2 className="mr-2 size-4 animate-spin"/>:<Wallet className="mr-2 size-4"/>}{saving?"Posting…":"Record and post"}</Button></div>
   {formError&&<p role="alert" className="text-sm text-destructive sm:col-span-2 lg:col-span-3">{formError}</p>}
  </form><p className="mt-3 text-xs text-muted-foreground">Each saved expense posts a balanced journal entry. Entries are immutable after posting; correct mistakes with an audited reversal workflow.</p></CardContent></Card>
  <Card><CardContent className="p-0"><div className="flex items-center justify-between gap-3 p-4"><h2 className="font-semibold">Expense ledger <span className="font-normal text-muted-foreground">({rows.length})</span></h2><Button variant="outline" size="sm" disabled={loading} onClick={()=>void load()}><RefreshCw className="mr-2 size-4"/>Refresh</Button></div>
   {loading?<div className="flex justify-center p-12"><LoadingSpinner/></div>:error?<div className="p-6 text-sm text-destructive" role="alert">{error}<Button className="ml-3" variant="outline" size="sm" onClick={()=>void load()}>Retry</Button></div>:rows.length===0?<EmptyState icon={Wallet} title="No expenses recorded" description="Record a real business expense above. No sample expenses are loaded."/>:
   <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-y bg-muted/40 text-left"><th className="p-3">Date / Number</th><th className="p-3">Description</th><th className="p-3">Category</th><th className="p-3">Account</th><th className="p-3">Method</th><th className="p-3">Cost centre</th><th className="p-3 text-right">Amount</th></tr></thead><tbody>{rows.map(row=><tr key={row.id} className="border-b last:border-0"><td className="p-3 whitespace-nowrap">{row.expense_date.slice(0,10)}<div className="text-muted-foreground">{row.expense_number}</div></td><td className="p-3 font-medium">{row.description}{row.reference&&<div className="text-muted-foreground">Ref: {row.reference}</div>}</td><td className="p-3">{row.category}</td><td className="p-3">{row.account_code} · {row.account_name}</td><td className="p-3 capitalize">{row.payment_method==="mpesa"?"M-Pesa":row.payment_method}</td><td className="p-3">{row.cost_centre_code?row.cost_centre_code+" · "+row.cost_centre_name:"—"}</td><td className="p-3 text-right tabular-nums">{formatKES(Number(row.amount))}</td></tr>)}</tbody></table></div>}
  </CardContent></Card>
 </div></BaseLayout>;
}
