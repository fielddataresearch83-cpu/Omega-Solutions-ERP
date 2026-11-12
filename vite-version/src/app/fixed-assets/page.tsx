import * as React from "react"
import { Archive, Calculator, Plus, RefreshCw } from "lucide-react"
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

type Account={id:string;code:string;name:string;account_type:string;normal_side:string;system_code:string|null;is_active:boolean}
type Depreciation={id:string;period_end:string;depreciation_amount:number|string;entry_number:string}
type Asset={id:string;asset_code:string;name:string;description:string|null;acquisition_date:string;cost:number|string;residual_value:number|string;useful_life_months:number;accumulated_depreciation:number|string;net_book_value:number|string;status:string;asset_account_id:string;accumulated_depreciation_account_id:string;depreciation_expense_account_id:string;payment_account_id:string;asset_account_name:string;accumulated_depreciation_account_name:string;depreciation_expense_account_name:string;payment_account_name:string;depreciationSchedule?:Depreciation[]}
const today=()=>new Date().toISOString().slice(0,10)
const errorText=(e:unknown)=>e&&typeof e==="object"&&"message" in e?String((e as {message:unknown}).message):"The request failed."
const nextMonthEnd=(value:string)=>{
 const d=new Date(value+"T00:00:00.000Z")
 return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+2,0)).toISOString().slice(0,10)
}
export default function FixedAssetsPage(){
 const [accounts,setAccounts]=React.useState<Account[]>([])
 const [assets,setAssets]=React.useState<Asset[]>([])
 const [loading,setLoading]=React.useState(true)
 const [saving,setSaving]=React.useState(false)
 const [error,setError]=React.useState<string|null>(null)
 const [showForm,setShowForm]=React.useState(false)
 const [selectedAsset,setSelectedAsset]=React.useState<Asset|null>(null)
 const [periodEnd,setPeriodEnd]=React.useState("")
 const [form,setForm]=React.useState({assetCode:"",name:"",description:"",acquisitionDate:today(),cost:"",residualValue:"0",usefulLifeMonths:"60",assetAccountId:"",accumulatedDepreciationAccountId:"",depreciationExpenseAccountId:"",paymentAccountId:""})

 const load=React.useCallback(async()=>{
  setLoading(true);setError(null)
  try{
   const [accountRows,assetRows]=await Promise.all([api.get<Account[]>("/accounting/accounts"),api.get<Asset[]>("/accounting/fixed-assets")])
   const active=accountRows.filter(a=>a.is_active)
   setAccounts(active);setAssets(assetRows)
   setForm(current=>({...current,
    assetAccountId:current.assetAccountId||active.find(a=>a.system_code==="fixed_assets")?.id||"",
    accumulatedDepreciationAccountId:current.accumulatedDepreciationAccountId||active.find(a=>a.system_code==="accumulated_depreciation")?.id||"",
    depreciationExpenseAccountId:current.depreciationExpenseAccountId||active.find(a=>a.system_code==="depreciation_expense")?.id||"",
    paymentAccountId:current.paymentAccountId||active.find(a=>a.system_code==="bank")?.id||active.find(a=>a.system_code==="cash")?.id||"",
   }))
  }catch(e){setError(errorText(e))}
  finally{setLoading(false)}
 },[])
 React.useEffect(()=>{void load()},[load])

 const createAsset=async()=>{
  if(!form.assetCode.trim()||!form.name.trim()){setError("Asset code and name are required.");return}
  setSaving(true);setError(null)
  try{
   await api.post("/accounting/fixed-assets",{...form,cost:Number(form.cost),residualValue:Number(form.residualValue),usefulLifeMonths:Number(form.usefulLifeMonths),description:form.description.trim()||undefined})
   setShowForm(false);setForm(current=>({...current,assetCode:"",name:"",description:"",cost:"",residualValue:"0"}));await load()
  }catch(e){setError(errorText(e))}
  finally{setSaving(false)}
 }
 const viewAsset=async(asset:Asset)=>{
  setError(null)
  try{const detail=await api.get<Asset>("/accounting/fixed-assets/"+asset.id);setSelectedAsset(detail);setPeriodEnd(detail.depreciationSchedule?.length?nextMonthEnd(detail.depreciationSchedule[detail.depreciationSchedule.length-1].period_end):nextMonthEnd(detail.acquisition_date))}
  catch(e){setError(errorText(e))}
 }
 const runDepreciation=async()=>{
  if(!selectedAsset)return
  setSaving(true);setError(null)
  try{const detail=await api.post<Asset>("/accounting/fixed-assets/"+selectedAsset.id+"/depreciation",{periodEnd});setSelectedAsset(detail);await load()}
  catch(e){setError(errorText(e))}
  finally{setSaving(false)}
 }

 const assetAccounts=accounts.filter(a=>a.account_type==="asset"&&a.id!==form.accumulatedDepreciationAccountId&&a.id!==form.paymentAccountId)
 const accumulatedAccounts=accounts.filter(a=>a.account_type==="asset"&&a.normal_side==="credit"&&a.id!==form.assetAccountId&&a.id!==form.paymentAccountId)
 const expenseAccounts=accounts.filter(a=>a.account_type==="expense")
 const paymentAccounts=accounts.filter(a=>a.account_type==="asset"&&["cash","bank","mpesa"].includes(a.system_code??""))

 return <BaseLayout><div className="flex flex-col gap-6 px-4 lg:px-6">
  <PageHeader title="Fixed assets" description="Register capital assets, post acquisition journals and run monthly straight-line depreciation." action={<div className="flex gap-2"><Button variant="outline" onClick={()=>void load()} disabled={loading}><RefreshCw className="size-4"/>Refresh</Button><Button onClick={()=>setShowForm(v=>!v)}><Plus className="size-4"/>{showForm?"Close":"Register asset"}</Button></div>}/>
  {error&&<div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
  {showForm&&<Card><CardContent className="flex flex-col gap-4 p-4">
   <div><h2 className="font-semibold">Register capital asset</h2><p className="text-sm text-muted-foreground">This workflow records a direct cash, bank or M-Pesa acquisition. It posts debit to the asset account and credit to the selected payment account. Supplier-credit acquisitions need to be reclassified from the supplier bill instead.</p></div>
   <div className="grid gap-3 md:grid-cols-3">
    <div className="flex flex-col gap-1"><Label>Asset code</Label><Input value={form.assetCode} onChange={e=>setForm(v=>({...v,assetCode:e.target.value}))} maxLength={60}/></div>
    <div className="flex flex-col gap-1"><Label>Asset name</Label><Input value={form.name} onChange={e=>setForm(v=>({...v,name:e.target.value}))} maxLength={240}/></div>
    <div className="flex flex-col gap-1"><Label>Acquisition date</Label><Input type="date" value={form.acquisitionDate} onChange={e=>setForm(v=>({...v,acquisitionDate:e.target.value}))}/></div>
    <div className="flex flex-col gap-1"><Label>Acquisition cost (KES)</Label><Input type="number" min="0.01" step="0.01" value={form.cost} onChange={e=>setForm(v=>({...v,cost:e.target.value}))}/></div>
    <div className="flex flex-col gap-1"><Label>Residual value (KES)</Label><Input type="number" min="0" step="0.01" value={form.residualValue} onChange={e=>setForm(v=>({...v,residualValue:e.target.value}))}/></div>
    <div className="flex flex-col gap-1"><Label>Useful life (months)</Label><Input type="number" min="1" step="1" value={form.usefulLifeMonths} onChange={e=>setForm(v=>({...v,usefulLifeMonths:e.target.value}))}/></div>
    <div className="flex flex-col gap-1"><Label>Fixed asset account</Label><select className="h-9 rounded-md border bg-background px-3 text-sm" value={form.assetAccountId} onChange={e=>setForm(v=>({...v,assetAccountId:e.target.value}))}><option value="">Select account</option>{assetAccounts.map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></div>
    <div className="flex flex-col gap-1"><Label>Accumulated depreciation account</Label><select className="h-9 rounded-md border bg-background px-3 text-sm" value={form.accumulatedDepreciationAccountId} onChange={e=>setForm(v=>({...v,accumulatedDepreciationAccountId:e.target.value}))}><option value="">Select account</option>{accumulatedAccounts.map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></div>
    <div className="flex flex-col gap-1"><Label>Depreciation expense account</Label><select className="h-9 rounded-md border bg-background px-3 text-sm" value={form.depreciationExpenseAccountId} onChange={e=>setForm(v=>({...v,depreciationExpenseAccountId:e.target.value}))}><option value="">Select account</option>{expenseAccounts.map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></div>
    <div className="flex flex-col gap-1"><Label>Payment account</Label><select className="h-9 rounded-md border bg-background px-3 text-sm" value={form.paymentAccountId} onChange={e=>setForm(v=>({...v,paymentAccountId:e.target.value}))}><option value="">Select account</option>{paymentAccounts.map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></div>
    <div className="flex flex-col gap-1 md:col-span-2"><Label>Description</Label><Input value={form.description} onChange={e=>setForm(v=>({...v,description:e.target.value}))} maxLength={2000}/></div>
   </div>
   <div className="flex justify-end"><Button onClick={()=>void createAsset()} disabled={saving||loading}>{saving?<LoadingSpinner className="size-4"/>:<Plus className="size-4"/>}Post acquisition</Button></div>
  </CardContent></Card>}

  <Card><CardContent className="p-0">
   {loading?<div className="flex justify-center py-10"><LoadingSpinner/></div>:assets.length===0?<EmptyState icon={Archive} title="No fixed assets registered" description="Register a capital asset to start tracking cost, accumulated depreciation and net book value."/>:<div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Asset</TableHead><TableHead>Acquired</TableHead><TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Accumulated depreciation</TableHead><TableHead className="text-right">Net book value</TableHead><TableHead>Status</TableHead><TableHead/></TableRow></TableHeader><TableBody>{assets.map(asset=><TableRow key={asset.id}><TableCell><div className="font-medium">{asset.name}</div><div className="text-xs text-muted-foreground">{asset.asset_code}</div></TableCell><TableCell>{asset.acquisition_date}</TableCell><TableCell className="text-right tabular-nums">{formatKES(Number(asset.cost))}</TableCell><TableCell className="text-right tabular-nums">{formatKES(Number(asset.accumulated_depreciation))}</TableCell><TableCell className="text-right tabular-nums font-semibold">{formatKES(Number(asset.net_book_value))}</TableCell><TableCell className="capitalize">{asset.status.replace("_"," ")}</TableCell><TableCell><Button size="sm" variant="outline" onClick={()=>void viewAsset(asset)}>View / depreciate</Button></TableCell></TableRow>)}</TableBody></Table></div>}
  </CardContent></Card>

  {selectedAsset&&<Card><CardContent className="flex flex-col gap-4 p-4">
   <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="font-semibold">{selectedAsset.asset_code} · {selectedAsset.name}</h2><p className="text-sm text-muted-foreground">Cost {formatKES(Number(selectedAsset.cost))} · Residual {formatKES(Number(selectedAsset.residual_value))} · Life {selectedAsset.useful_life_months} months</p></div><Button variant="outline" size="sm" onClick={()=>setSelectedAsset(null)}>Close</Button></div>
   <div className="grid gap-3 sm:grid-cols-3"><Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Accumulated depreciation</p><p className="mt-1 font-semibold tabular-nums">{formatKES(Number(selectedAsset.accumulated_depreciation))}</p></CardContent></Card><Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Net book value</p><p className="mt-1 font-semibold tabular-nums">{formatKES(Number(selectedAsset.net_book_value))}</p></CardContent></Card><Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Status</p><p className="mt-1 font-semibold capitalize">{selectedAsset.status.replace("_"," ")}</p></CardContent></Card></div>
   {selectedAsset.status==="active"&&<div className="flex flex-wrap items-end gap-3 rounded-lg border p-3"><div className="flex flex-col gap-1"><Label>Depreciation period end (month end)</Label><Input type="date" value={periodEnd} onChange={e=>setPeriodEnd(e.target.value)}/></div><Button onClick={()=>void runDepreciation()} disabled={saving||!periodEnd}><Calculator className="size-4"/>Post monthly depreciation</Button></div>}
   <div><h3 className="mb-2 font-medium">Depreciation history</h3>{(selectedAsset.depreciationSchedule??[]).length===0?<p className="text-sm text-muted-foreground">No depreciation has been posted.</p>:<Table><TableHeader><TableRow><TableHead>Period end</TableHead><TableHead>Journal</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader><TableBody>{selectedAsset.depreciationSchedule!.map(row=><TableRow key={row.id}><TableCell>{row.period_end}</TableCell><TableCell className="font-mono">{row.entry_number}</TableCell><TableCell className="text-right tabular-nums">{formatKES(Number(row.depreciation_amount))}</TableCell></TableRow>)}</TableBody></Table>}</div>
  </CardContent></Card>}
 </div></BaseLayout>
}
