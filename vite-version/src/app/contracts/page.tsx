"use client"

import * as React from "react"
import { FileSignature, Plus, RefreshCw, Loader2, AlertCircle, CalendarClock, Package, CheckCircle2 } from "lucide-react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api } from "@/lib/api-client"

type ContractItemDetail = { id:string; description:string; item_type:string; product_id?:string|null; quantity:string|number; unit?:string; unit_price:string|number; frequency:string }
type Contract = { id:string; contract_number:string; title:string; contract_type:"customer"|"supplier"; status:string; start_date:string; end_date:string; contract_value:string|number; currency:string; counterparty_customer_id?:string|null; counterparty_supplier_id?:string|null; renewal_date?:string|null; monthly_budget?:string|number|null; description?:string|null; notes?:string|null; items?:ContractItemDetail[]; obligations?:Array<{id:string;title:string;due_date?:string|null;status:string}>; item_count?:number; open_obligations?:number }
type Party = { id:string; name:string; company_name?:string }
type Product = { id:string; name:string; sku?:string; is_active?:boolean }
type ContractItem = { description:string; itemType:string; productId:string; quantity:string; unit:string; unitPrice:string; frequency:string }
const statusLabels:Record<string,string>={draft:"Draft",pending_approval:"Pending approval",active:"Active",suspended:"Suspended",completed:"Completed",expired:"Expired",terminated:"Terminated"}
function message(e:unknown){return e&&typeof e==="object"&&"message" in e?String((e as {message:unknown}).message):"Something went wrong. Please try again."}
const today = new Date().toISOString().slice(0,10)
const future = new Date(Date.now()+365*86400000).toISOString().slice(0,10)
const sixtyDaysFromToday = new Date(Date.now()+60*86400000).toISOString().slice(0,10)
const blankItem = ():ContractItem=>({description:"",itemType:"material",productId:"",quantity:"1",unit:"unit",unitPrice:"0",frequency:"monthly"})
export default function ContractsPage(){
 const [contracts,setContracts]=React.useState<Contract[]>([])
 const [customers,setCustomers]=React.useState<Party[]>([])
 const [suppliers,setSuppliers]=React.useState<Party[]>([])
 const [products,setProducts]=React.useState<Product[]>([])
 const [loading,setLoading]=React.useState(true)
 const [saving,setSaving]=React.useState(false)
 const [error,setError]=React.useState("")
 const [notice,setNotice]=React.useState("")
 const [showForm,setShowForm]=React.useState(false)
 const [editingId,setEditingId]=React.useState<string|null>(null)
 const [type,setType]=React.useState<"customer"|"supplier">("customer")
 const [title,setTitle]=React.useState("")
 const [partyId,setPartyId]=React.useState("")
 const [startDate,setStartDate]=React.useState(today)
 const [endDate,setEndDate]=React.useState(future)
 const [renewalDate,setRenewalDate]=React.useState("")
 const [value,setValue]=React.useState("0")
 const [budget,setBudget]=React.useState("")
 const [description,setDescription]=React.useState("")
 const [notes,setNotes]=React.useState("")
 const [items,setItems]=React.useState<ContractItem[]>([blankItem()])
 const [busy,setBusy]=React.useState("")
 const [selected,setSelected]=React.useState<Contract|null>(null)
 const [obligationTitle,setObligationTitle]=React.useState("")
 const [obligationDue,setObligationDue]=React.useState("")
 const refresh=React.useCallback(async()=>{
   setLoading(true);setError("")
   try{
     const results=await Promise.all([api.get<Contract[]>("/contracts"),api.get<Party[]>("/customers"),api.get<Party[]>("/suppliers"),api.get<Product[]>("/products")])
     setContracts(results[0]);setCustomers(results[1]);setSuppliers(results[2]);setProducts(results[3].filter(p=>p.is_active!==false))
   }catch(e){setError(message(e))}finally{setLoading(false)}
 },[])
 React.useEffect(()=>{let active=true;void Promise.all([api.get<Contract[]>("/contracts"),api.get<Party[]>("/customers"),api.get<Party[]>("/suppliers"),api.get<Product[]>("/products")]).then(results=>{if(active){setContracts(results[0]);setCustomers(results[1]);setSuppliers(results[2]);setProducts(results[3].filter(p=>p.is_active!==false));}}).catch(e=>{if(active)setError(message(e));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[])
 React.useEffect(()=>{let active=true;void Promise.resolve().then(()=>{if(active)setPartyId("")});return()=>{active=false}},[type])
 const create=async()=>{
   if(!title.trim()||(!editingId&&!partyId)||!startDate||!endDate||endDate<startDate){setError("Enter a contract title, counterparty and valid dates.");return}
   const validItems=items.filter(i=>i.description.trim())
   if(items.some(i=>i.description.trim()&&(!(Number(i.quantity)>0)||Number(i.unitPrice)<0||!Number.isFinite(Number(i.unitPrice))))){setError("Check item quantities and unit prices.");return}
   setSaving(true);setError("")
   try{
     const payload={title:title.trim(),startDate,endDate,renewalDate:editingId?(renewalDate||null):(renewalDate||undefined),contractValue:Number(value),monthlyBudget:budget===""?(editingId?null:undefined):Number(budget),description:editingId?(description.trim()||null):(description.trim()||undefined),notes:editingId?(notes.trim()||null):(notes.trim()||undefined),items:validItems.map(i=>({description:i.description.trim(),itemType:i.itemType,productId:i.productId||undefined,quantity:Number(i.quantity),unit:i.unit||undefined,unitPrice:Number(i.unitPrice),frequency:i.frequency}))}
     if(editingId) await api.patch("/contracts/"+editingId,payload)
     else await api.post("/contracts",{...payload,contractType:type,customerId:type==="customer"?partyId:undefined,supplierId:type==="supplier"?partyId:undefined})
     setShowForm(false);setEditingId(null);setTitle("");setPartyId("");setValue("0");setBudget("");setDescription("");setNotes("");setRenewalDate("");setItems([blankItem()]);await refresh()
     if(selected?.id===editingId&&editingId){setSelected(await api.get("/contracts/"+editingId))}
   }catch(e){setError(message(e))}finally{setSaving(false)}
 }
 const changeStatus=async(c:Contract,action:"submit-for-approval"|"suspend")=>{
   setBusy(c.id);setError("")
   try{await api.post("/contracts/"+c.id+"/"+action);await refresh();if(selected?.id===c.id){const updated=await api.get<Contract & {items:unknown[];obligations:unknown[]}>("/contracts/"+c.id);setSelected(updated)}}catch(e){setError(message(e))}finally{setBusy("")}
 }
 const createRequisition=async()=>{
   if(!selected)return;setBusy(selected.id);setError("");setNotice("")
   try{const result=await api.post<{requestNumber:string;itemCount:number;message:string}>("/contracts/"+selected.id+"/requisitions");setNotice(result.message+" "+result.requestNumber+" ("+result.itemCount+" lines).");await refresh()}catch(e){setError(message(e))}finally{setBusy("")}
 }
 const addObligation=async()=>{
   if(!selected||!obligationTitle.trim())return
   setBusy(selected.id);setError("")
   try{await api.post("/contracts/"+selected.id+"/obligations",{title:obligationTitle.trim(),dueDate:obligationDue||undefined});const updated=await api.get<Contract & {items:unknown[];obligations:unknown[]}>("/contracts/"+selected.id);setSelected(updated);setObligationTitle("");setObligationDue("");await refresh()}catch(e){setError(message(e))}finally{setBusy("")}
 }
 const updateObligation=async(obligationId:string,status:string)=>{
   if(!selected)return;setBusy(selected.id);setError("")
   try{await api.patch("/contracts/"+selected.id+"/obligations/"+obligationId,{status});setSelected(await api.get("/contracts/"+selected.id))}catch(e){setError(message(e))}finally{setBusy("")}
 }
 const partyName=(c:Contract)=>{const id=c.contract_type==="customer"?c.counterparty_customer_id:c.counterparty_supplier_id;const parties=c.contract_type==="customer"?customers:suppliers;return parties.find(p=>p.id===id)?.name??parties.find(p=>p.id===id)?.company_name??"Counterparty"}
 const money=(amount:string|number,currency="KES")=>new Intl.NumberFormat("en-KE",{style:"currency",currency:String(currency||"KES").trim(),maximumFractionDigits:2}).format(Number(amount||0))
 const selectedDetail=selected
 return <BaseLayout><div className="flex flex-col gap-5 px-4 lg:px-6">
  <PageHeader title="Contract Management" description="Manage customer and supplier agreements, material requirements, obligations, and renewal dates." action={<div className="flex gap-2"><Button variant="outline" onClick={()=>void refresh()} disabled={loading}><RefreshCw className="mr-2 size-4"/>Refresh</Button><Button onClick={()=>{setShowForm(v=>!v);setSelected(null)}}><Plus className="mr-2 size-4"/>New contract</Button></div>}/>
  {notice&&<div role="status" className="rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-3 text-sm text-emerald-700">{notice}</div>}
  {error&&<div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"><AlertCircle className="mt-0.5 size-4 shrink-0"/><span>{error}</span></div>}
  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
   <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total contracts</CardTitle></CardHeader><CardContent><div className="text-2xl font-semibold">{contracts.length}</div></CardContent></Card>
   <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Active contracts</CardTitle></CardHeader><CardContent><div className="text-2xl font-semibold">{contracts.filter(c=>c.status==="active").length}</div></CardContent></Card>
   <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Ending in 60 days</CardTitle></CardHeader><CardContent><div className="text-2xl font-semibold">{contracts.filter(c=>c.status==="active"&&c.end_date>=today&&c.end_date<=sixtyDaysFromToday).length}</div></CardContent></Card>
   <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Open obligations</CardTitle></CardHeader><CardContent><div className="text-2xl font-semibold">{contracts.reduce((sum,c)=>sum+Number(c.open_obligations||0),0)}</div></CardContent></Card>
  </div>
  {showForm&&<Card><CardHeader><CardTitle>{editingId?"Edit draft contract":"Create a contract"}</CardTitle></CardHeader><CardContent className="space-y-5">
   <div className="grid gap-4 sm:grid-cols-2">
    <div className="space-y-2"><Label>Contract title *</Label><Input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Office cleaning services"/></div>
    {!editingId&&<><div className="space-y-2"><Label>Contract type *</Label><select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={type} onChange={e=>{setType(e.target.value as "customer"|"supplier");setPartyId("")}}><option value="customer">Customer contract — services we deliver</option><option value="supplier">Supplier contract — materials we buy</option></select></div>
    <div className="space-y-2"><Label>{type==="customer"?"Customer":"Supplier"} *</Label><select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={partyId} onChange={e=>setPartyId(e.target.value)}><option value="">Select {type==="customer"?"customer":"supplier"}</option>{(type==="customer"?customers:suppliers).map(p=><option key={p.id} value={p.id}>{p.name||p.company_name||p.id}</option>)}</select></div></>}
    <div className="space-y-2"><Label>Contract value (KES)</Label><Input type="number" min="0" value={value} onChange={e=>setValue(e.target.value)}/></div>
    <div className="space-y-2"><Label>Start date *</Label><Input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)}/></div>
    <div className="space-y-2"><Label>End date *</Label><Input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)}/></div>
    <div className="space-y-2"><Label>Renewal / notice date</Label><Input type="date" value={renewalDate} onChange={e=>setRenewalDate(e.target.value)}/></div>
    <div className="space-y-2"><Label>Monthly budget (KES)</Label><Input type="number" min="0" value={budget} onChange={e=>setBudget(e.target.value)} placeholder="Optional"/></div>
   </div>
   <div className="space-y-2"><Label>Scope and description</Label><textarea className="min-h-20 w-full rounded-md border bg-background p-3 text-sm" value={description} onChange={e=>setDescription(e.target.value)} placeholder="Services, locations, terms, and expected outcomes"/></div>
   <div className="space-y-3"><div className="flex items-center justify-between"><div><h3 className="font-medium">Materials and services</h3><p className="text-sm text-muted-foreground">Optional planned materials, service lines, labour, quantities and unit costs.</p></div><Button size="sm" variant="outline" onClick={()=>setItems(old=>[...old,blankItem()])}><Plus className="mr-1 size-4"/>Add line</Button></div>
    {items.map((item,index)=><div key={index} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2 xl:grid-cols-6">
     <div className="space-y-1 sm:col-span-2 xl:col-span-2"><Label>Description</Label><Input value={item.description} onChange={e=>setItems(old=>old.map((v,i)=>i===index?{...v,description:e.target.value}:v))} placeholder="Disinfectant, gloves, cleaning visit"/></div>
     <div className="space-y-1"><Label>Inventory product</Label><select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={item.productId} onChange={e=>{const p=products.find(p=>p.id===e.target.value);setItems(old=>old.map((v,i)=>i===index?{...v,productId:e.target.value,description:v.description||(p?.name??"")}:v))}}><option value="">No linked product</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}{p.sku?" · "+p.sku:""}</option>)}</select></div>
     <div className="space-y-1"><Label>Quantity</Label><Input type="number" min="0.001" step="0.001" value={item.quantity} onChange={e=>setItems(old=>old.map((v,i)=>i===index?{...v,quantity:e.target.value}:v))}/></div>
     <div className="space-y-1"><Label>Unit cost</Label><Input type="number" min="0" value={item.unitPrice} onChange={e=>setItems(old=>old.map((v,i)=>i===index?{...v,unitPrice:e.target.value}:v))}/></div>
     <div className="space-y-1"><Label>Frequency</Label><select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={item.frequency} onChange={e=>setItems(old=>old.map((v,i)=>i===index?{...v,frequency:e.target.value}:v))}>{["once","daily","weekly","monthly","quarterly","annually"].map(f=><option key={f} value={f}>{f}</option>)}</select></div>
     <div className="flex justify-end sm:col-span-2 xl:col-span-6"><Button size="sm" variant="ghost" disabled={items.length===1} onClick={()=>setItems(old=>old.filter((_,i)=>i!==index))}>Remove line</Button></div>
    </div>)}
   </div>
   <div className="space-y-2"><Label>Internal notes</Label><textarea className="min-h-16 w-full rounded-md border bg-background p-3 text-sm" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Internal instructions and notes"/></div>
   <div className="flex justify-end gap-2"><Button variant="outline" onClick={()=>{setShowForm(false);setEditingId(null)}} disabled={saving}>Cancel</Button><Button onClick={()=>void create()} disabled={saving}>{saving&&<Loader2 className="mr-2 size-4 animate-spin"/>}{editingId?"Save changes":"Save draft"}</Button></div>
  </CardContent></Card>}
  {selectedDetail&&<Card><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>{selectedDetail.title}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{selectedDetail.contract_number} · {selectedDetail.contract_type==="customer"?"Customer contract":"Supplier contract"} · {statusLabels[selectedDetail.status]||selectedDetail.status}</p></div><Button variant="outline" onClick={()=>setSelected(null)}>Close details</Button></div></CardHeader><CardContent className="space-y-5">
   <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-lg bg-muted/50 p-3"><p className="text-sm text-muted-foreground">Contract value</p><p className="text-lg font-semibold">{money(selectedDetail.contract_value,selectedDetail.currency)}</p></div><div className="rounded-lg bg-muted/50 p-3"><p className="text-sm text-muted-foreground">Period</p><p className="font-medium">{selectedDetail.start_date?.slice(0,10)} – {selectedDetail.end_date?.slice(0,10)}</p></div><div className="rounded-lg bg-muted/50 p-3"><p className="text-sm text-muted-foreground">Counterparty</p><p className="font-medium">{partyName(selectedDetail)}</p></div></div>
   <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Planned materials and services</h3><div className="flex gap-2">{selectedDetail.status==="draft"&&<Button size="sm" variant="outline" disabled={!!busy} onClick={()=>{setEditingId(selectedDetail.id);setTitle(selectedDetail.title);setType(selectedDetail.contract_type);setPartyId(selectedDetail.contract_type==="customer"?(selectedDetail.counterparty_customer_id||""):(selectedDetail.counterparty_supplier_id||""));setStartDate(selectedDetail.start_date?.slice(0,10)||today);setEndDate(selectedDetail.end_date?.slice(0,10)||future);setRenewalDate(selectedDetail.renewal_date?.slice(0,10)||"");setValue(String(selectedDetail.contract_value??0));setBudget(String(selectedDetail.monthly_budget??""));setDescription(selectedDetail.description||"");setNotes(selectedDetail.notes||"");setItems((selectedDetail.items||[]).map(i=>({description:i.description,itemType:i.item_type,productId:i.product_id||"",quantity:String(i.quantity),unit:i.unit||"unit",unitPrice:String(i.unit_price),frequency:i.frequency||"once"})));setShowForm(true);setSelected(null)}}>Edit draft</Button>}<Button size="sm" variant="outline" disabled={!!busy} onClick={()=>void createRequisition()}><Package className="mr-1 size-4"/>Create draft requisition</Button></div></div><div className="mt-2">{!selectedDetail.items?.length?<p className="text-sm text-muted-foreground">No line items added.</p>:<div className="space-y-2">{selectedDetail.items.map(i=><div key={i.id} className="flex flex-wrap justify-between gap-2 rounded-md border p-3 text-sm"><span>{i.description} <span className="text-muted-foreground">· {i.quantity} {i.unit||""} · {i.frequency}</span></span><span className="font-medium">{money(Number(i.quantity)*Number(i.unit_price),selectedDetail.currency)}</span></div>)}</div>}</div>
   <div className="space-y-3"><h3 className="font-semibold">Obligations and milestones</h3>{selectedDetail.obligations?.map(o=><div key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"><div><p className="font-medium">{o.title}</p><p className="text-xs text-muted-foreground">{o.due_date?.slice(0,10)||"No due date"} · {o.status.replace("_"," ")}</p></div>{o.status!=="completed"&&o.status!=="waived"&&<Button size="sm" variant="outline" disabled={!!busy} onClick={()=>void updateObligation(o.id,"completed")}><CheckCircle2 className="mr-1 size-4"/>Mark complete</Button>}</div>)}<div className="grid gap-2 sm:grid-cols-[1fr_180px_auto]"><Input value={obligationTitle} onChange={e=>setObligationTitle(e.target.value)} placeholder="Add obligation or milestone"/><Input type="date" value={obligationDue} onChange={e=>setObligationDue(e.target.value)}/><Button onClick={()=>void addObligation()} disabled={!obligationTitle.trim()||!!busy}>Add obligation</Button></div></div>
  </CardContent></Card>}
  <Card>
   <CardHeader><CardTitle>Contract register</CardTitle></CardHeader>
   <CardContent>
    {loading ? (
     <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin"/>Loading contracts…</div>
    ) : contracts.length === 0 ? (
     <div className="flex flex-col items-center gap-2 py-10 text-center">
      <FileSignature className="size-10 text-muted-foreground"/>
      <h3 className="font-medium">No contracts yet</h3>
      <p className="max-w-md text-sm text-muted-foreground">Create a customer agreement or supplier agreement. You can include planned cleaning materials, service lines and contract obligations.</p>
      <Button onClick={() => setShowForm(true)}><Plus className="mr-2 size-4"/>Create your first contract</Button>
     </div>
    ) : (
     <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
       <thead><tr className="border-b text-muted-foreground"><th className="p-3 font-medium">Contract</th><th className="p-3 font-medium">Type / counterparty</th><th className="p-3 font-medium">Period</th><th className="p-3 font-medium">Value</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium">Actions</th></tr></thead>
       <tbody>
        {contracts.map(c => (
         <tr key={c.id} className="border-b last:border-0">
          <td className="p-3">
           <button className="text-left font-medium text-primary hover:underline" onClick={async () => { setError(""); try { setSelected(await api.get("/contracts/" + c.id)); setShowForm(false); } catch (e) { setError(message(e)); } }}>{c.title}</button>
           <p className="text-xs text-muted-foreground">{c.contract_number}</p>
          </td>
          <td className="p-3"><span>{c.contract_type === "customer" ? "Customer" : "Supplier"}</span><p className="text-xs text-muted-foreground">{partyName(c)}</p></td>
          <td className="p-3">{c.start_date?.slice(0,10)}<p className="text-xs text-muted-foreground">to {c.end_date?.slice(0,10)}</p></td>
          <td className="p-3 whitespace-nowrap">{money(c.contract_value,c.currency)}</td>
          <td className="p-3"><span className="rounded-full border px-2 py-1 text-xs">{statusLabels[c.status] || c.status}</span></td>
          <td className="p-3">
           <div className="flex gap-2">
            {(c.status === "draft" || c.status === "suspended") && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void changeStatus(c,"submit-for-approval")}>Submit for approval</Button>}
            {c.status === "active" && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void changeStatus(c,"suspend")}>Suspend</Button>}
            <Button size="sm" variant="ghost" onClick={async () => { setError(""); try { setSelected(await api.get("/contracts/" + c.id)); setShowForm(false); } catch (e) { setError(message(e)); } }}>View</Button>
           </div>
          </td>
         </tr>
        ))}
       </tbody>
      </table>
     </div>
    )}
   </CardContent>
  </Card>
  <div className="grid gap-3 md:grid-cols-3"><div className="flex gap-3 rounded-lg border p-4"><Package className="size-5 shrink-0 text-muted-foreground"/><div><p className="font-medium">Materials planning</p><p className="text-sm text-muted-foreground">Link planned products and quantities to a contract.</p></div></div><div className="flex gap-3 rounded-lg border p-4"><CalendarClock className="size-5 shrink-0 text-muted-foreground"/><div><p className="font-medium">Obligations</p><p className="text-sm text-muted-foreground">Track milestones and due dates for each agreement.</p></div></div><div className="flex gap-3 rounded-lg border p-4"><FileSignature className="size-5 shrink-0 text-muted-foreground"/><div><p className="font-medium">Tenant-aware records</p><p className="text-sm text-muted-foreground">Contracts are scoped to the currently selected company.</p></div></div></div>
 </div></BaseLayout>
}
